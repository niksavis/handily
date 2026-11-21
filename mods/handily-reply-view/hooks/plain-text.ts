const MARKDOWN_LINE = /^\s{0,3}(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|~~~|\|.*\|)/
const MARKDOWN_INLINE = /\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\([^)\s]+\)/
const LOG_LINE =
  /^\s*(?:\d{4}-\d\d-\d\d[T ]\d|\[\d|at \S+ \(|\/[\w.-]+\/[\w.-]|\$ |[A-Z]{3,}:|\w+:\d+:)/
const INLINE_ITEM = /(?:^|\s)\(?(\d{1,2})\)\s+/g
const SENTENCE_END = /(?<=[.!?;])\s+(?=[A-Z(])/
const LABEL = /^([A-Z][\w-]*(?:,? [\w-]+){0,3}):\s+(?=\S)/
const LEAD = /^[A-Z][\w ,-]{0,40}:$/
const ITEM_END = /[,;]$/
const ITEM_JOIN = /^and\s+/
const LEAD_WORDS =
  /^(?:Then|Next|Also|Report|Recommended|Decision|Note|Cause|Fix|Proof|Condition|Owner)\b/
const WARNING = /\b(?:never|do not|don't|stop|refuse[sd]?|blocked|on any red)\b/i
const RECOMMENDED = /^Recommended\b/
const TOKEN =
  /https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]|\b[\w.-]+--v\d+\.\d+\.\d+\b|(?<![\w/.])\.?[\w-]+(?:\/[\w.-]+)+(?<![.,;:])|(?<![\w.])_?[\w-]+\.(?:json|jsonl|py|ts|tsx|js|mjs|md|yml|yaml|toml|sh|txt|lock|cfg|ini)\b|\b[a-z]{2,}-(?=[a-z0-9]*\d)[a-z0-9]{4,6}(?:\.\d+)*\b|\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b|\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b|(?<![\w.])_?[a-z][a-z0-9]*_[a-z0-9_]+\b|\^\S+\$/g
const ESCAPED = /[\\`*_[\]<>#|~]/g

export function looksLikeMarkdown(lines: readonly string[]): boolean {
  return lines.some((line) => MARKDOWN_LINE.test(line)) || MARKDOWN_INLINE.test(lines.join('\n'))
}

export function looksLikeLog(lines: readonly string[]): boolean {
  const filled = lines.filter((line) => line.trim() !== '')
  if (filled.length < 3) return false
  return filled.filter((line) => LOG_LINE.test(line)).length * 2 > filled.length
}

function escaped(text: string): string {
  return text.replace(ESCAPED, (mark) => `\\${mark}`)
}

export function markedTokens(text: string): string {
  let out = ''
  let at = 0
  for (const match of text.matchAll(TOKEN)) {
    const token = match[0]
    const start = match.index
    out += escaped(text.slice(at, start))
    out += token.startsWith('http') ? `[${escaped(token)}](${token})` : `\`${token}\``
    at = start + token.length
  }
  return out + escaped(text.slice(at))
}

function labelled(sentence: string): string {
  if (LEAD.test(sentence)) return `**${escaped(sentence)}**`
  const label = LABEL.exec(sentence)
  if (label === null) return markedTokens(sentence)
  const name = label[1] ?? ''
  return `**${escaped(name)}:** ${markedTokens(sentence.slice(label[0].length))}`
}

type Item = { lead: string; items: string[] }

export function inlineItems(text: string): Item | null {
  const marks = [...text.matchAll(INLINE_ITEM)]
  if (marks.length < 2) return null
  if (!marks.every((mark, index) => Number(mark[1]) === index + 1)) return null
  const first = marks[0]
  if (first === undefined) return null
  const lead = text.slice(0, first.index).trim()
  const items = marks.map((mark, index) => {
    const start = mark.index + mark[0].length
    const end = marks[index + 1]?.index ?? text.length
    return text.slice(start, end).trim().replace(ITEM_END, '').replace(ITEM_JOIN, '')
  })
  return { lead, items }
}

export function groupsOf(paragraph: string): string[] {
  const groups: string[][] = []
  for (const sentence of paragraph.split(SENTENCE_END)) {
    const last = groups.at(-1)
    const starts = LABEL.test(sentence) || LEAD_WORDS.test(sentence) || WARNING.test(sentence)
    const lastWarns = last !== undefined && WARNING.test(last.join(' '))
    if (last === undefined || starts || lastWarns) groups.push([sentence])
    else last.push(sentence)
  }
  return groups.map((group) => group.join(' '))
}

function blockOf(group: string): string {
  const items = inlineItems(group)
  if (items !== null) {
    const head = items.lead === '' ? [] : [labelled(items.lead), '']
    return [
      ...head,
      ...items.items.map((item, index) => `${String(index + 1)}. ${markedTokens(item)}`),
    ].join('\n')
  }
  const line = labelled(group)
  if (RECOMMENDED.test(group)) return `> [!NOTE]\n> ${line}`
  if (WARNING.test(group)) return `> [!WARNING]\n> ${line}`
  return line
}

const FENCE = /^\s{0,3}(?:```|~~~)/
const KEPT_LINE = /^\s{0,3}(?:#{1,6}\s|>|\|.*\|)/
const LIST_LINE = /^(\s*)(\d+[.)]|[-*+])\s+(.*)$/

export function enrichedSentences(text: string): string {
  return text
    .split(SENTENCE_END)
    .map((sentence) => labelled(sentence))
    .join(' ')
}

type Piece = { kind: 'kept' | 'list' | 'plain'; text: string }

function piecesOf(lines: readonly string[]): Piece[] {
  const pieces: Piece[] = []
  let isFenced = false
  for (const line of lines) {
    if (FENCE.test(line)) {
      isFenced = !isFenced
      pieces.push({ kind: 'kept', text: line })
      continue
    }
    const item = isFenced ? null : LIST_LINE.exec(line)
    if (item !== null && MARKDOWN_INLINE.test(line)) {
      pieces.push({ kind: 'list', text: line })
      continue
    }
    if (isFenced || KEPT_LINE.test(line) || MARKDOWN_INLINE.test(line)) {
      pieces.push({ kind: 'kept', text: line })
      continue
    }
    if (item !== null) {
      pieces.push({
        kind: 'list',
        text: `${item[1] ?? ''}${item[2] ?? ''} ${enrichedSentences(item[3] ?? '')}`,
      })
      continue
    }
    if (line.trim() === '') continue
    for (const block of groupsOf(line.trim()).map(blockOf))
      pieces.push({ kind: 'plain', text: block })
  }
  return pieces
}

const CLOSING_ASK = /\bwhen you say\b|\bwhen you want\b|\bshall I\b|\bmay I\b|\?\s*$/

export function isAsk(lines: readonly string[]): boolean {
  const last = [...lines].reverse().find((line) => line.trim() !== '')
  return last !== undefined && CLOSING_ASK.test(last)
}

export function structuredMarkdown(lines: readonly string[]): string | null {
  if (lines.every((line) => line.trim() === '')) return null
  if (looksLikeLog(lines)) return null
  const pieces = piecesOf(lines)
  const closing = pieces.at(-1)
  if (closing?.kind === 'plain' && !closing.text.startsWith('>') && isAsk(lines)) {
    closing.text = `> [!NOTE]\n> ${closing.text}`
  }
  let out = ''
  let last: Piece | undefined
  for (const piece of pieces) {
    if (last !== undefined) {
      const joined =
        (last.kind === piece.kind && piece.kind !== 'plain') ||
        (last.kind === 'kept' && piece.kind === 'kept')
      out += joined ? '\n' : '\n\n'
    }
    out += piece.text
    last = piece
  }
  return out
}
