const DISPATCHED = /^\(dispatched #(\d+)\)\s*$/
const NO_EVENTS = /^\(no pending events\)/
const NONCE_LINE = /authentic event nonces for this delivery:([^<\n]*)/
const EVENT = /<event\s([^>]*)>([\s\S]*?)<\/event>/g
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/g
const NONCE_WORD = /^[A-Za-z0-9_-]+$/

export type CodeModeNote = { text: string; isError: boolean }

type EventWord = { text: string; isError: boolean }

function attributesOf(source: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const match of source.matchAll(ATTRIBUTE)) found.set(match[1] ?? '', match[2] ?? '')
  return found
}

function textOfPart(part: unknown): string {
  if (typeof part === 'string') return part
  if (typeof part !== 'object' || part === null) return ''
  const text = (part as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

export function resultText(output: unknown): string | null {
  if (typeof output === 'string') return output
  if (Array.isArray(output)) return output.map(textOfPart).join('')
  if (typeof output !== 'object' || output === null) return null
  const { content, result } = output as { content?: unknown; result?: unknown }
  if (content !== undefined) return resultText(content)
  if (typeof result === 'string') return result
  const text = textOfPart(output)
  return text === '' ? null : text
}

function noncesOf(text: string): ReadonlySet<string> | null {
  const line = NONCE_LINE.exec(text)?.[1]
  if (line === undefined) return null
  const nonces = new Set<string>()
  for (const word of line.trim().split(/\s+/)) {
    if (!NONCE_WORD.test(word)) break
    nonces.add(word)
  }
  return nonces
}

function eventWord(attributes: Map<string, string>, body: string): EventWord | null {
  const kind = attributes.get('kind') ?? ''
  if (kind === 'repl-status') {
    const pending = attributes.get('pending') ?? ''
    return { text: pending === '' ? 'running' : `${pending} running`, isError: false }
  }
  if (kind !== 'repl-eval') return kind === '' ? null : { text: kind, isError: false }
  const number = attributes.get('eval')
  const name = number === undefined ? 'script' : `#${number}`
  const isError = body.trimStart().startsWith('<error>')
  return { text: `${name} ${isError ? 'error' : 'done'}`, isError }
}

export function pollNote(text: string): CodeModeNote | null {
  if (NO_EVENTS.test(text.trim())) return { text: 'no new events', isError: false }
  const nonces = noncesOf(text)
  if (nonces === null) return null
  const words: string[] = []
  let isError = false
  for (const match of text.matchAll(EVENT)) {
    const attributes = attributesOf(match[1] ?? '')
    const nonce = attributes.get('nonce')
    if (nonce === undefined || !nonces.has(nonce)) continue
    const word = eventWord(attributes, match[2] ?? '')
    if (word === null) continue
    words.push(word.text)
    isError ||= word.isError
  }
  return words.length === 0 ? null : { text: words.join(' · '), isError }
}

export function replNote(text: string): CodeModeNote | null {
  const number = DISPATCHED.exec(text)?.[1]
  return number === undefined ? null : { text: `dispatched #${number}`, isError: false }
}

function dispatchedEval(output: unknown): number | null {
  if (typeof output !== 'object' || output === null) return null
  const { asyncDispatched, evalId } = output as { asyncDispatched?: unknown; evalId?: unknown }
  return asyncDispatched === true && typeof evalId === 'number' ? evalId : null
}

export function codeModeNote(tool: string, output: unknown): CodeModeNote | null {
  const evalId = tool === 'REPL' ? dispatchedEval(output) : null
  if (evalId !== null) return { text: `dispatched #${String(evalId)}`, isError: false }
  const text = resultText(output)
  if (text === null) return null
  if (tool === 'REPL') return replNote(text)
  if (tool === 'Poll') return pollNote(text)
  return null
}
