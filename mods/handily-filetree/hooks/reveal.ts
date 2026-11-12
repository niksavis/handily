import type { EngineInterface, FsStat, PromptSubmitInput } from 'claude-code'
import { insidePath, resolvedPath } from './paths'

export type Reveal = { path: string | undefined }

type Mention = { absolute: string; inside: string }

const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])
const MENTION = /(?<=^|\s)@(?:"([^"]+)"|(\S+))/g
const LINE_RANGE = /#L\d+(?:-\d+)?$/
const TRAILING_MARKS = /[.,;:!?)]+$/

export function newReveal(): Reveal {
  return { path: undefined }
}

export function clearReveal(reveal: Reveal): void {
  reveal.path = undefined
}

export function isPersonPrompt(
  e: Pick<PromptSubmitInput, 'origin' | 'command' | 'isMeta'>,
): boolean {
  return e.command === undefined && e.isMeta !== true && PERSON_ORIGINS.has(e.origin.kind)
}

export function mentionedPaths(text: string): string[][] {
  return [...text.matchAll(MENTION)].flatMap((match) => {
    const typed = match[1] ?? match[2] ?? ''
    const spellings = [typed, typed.replace(TRAILING_MARKS, '')].map((path) =>
      path.replace(LINE_RANGE, ''),
    )
    const tried = [...new Set(spellings)].filter((path) => path !== '')
    return tried.length === 0 ? [] : [tried]
  })
}

function mentionIn(cwd: string, path: string): Mention | undefined {
  const absolute = resolvedPath(cwd, path)
  const inside = insidePath(cwd, absolute)
  return inside === undefined || inside === '' ? undefined : { absolute, inside }
}

export function ancestorsOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1)
  return parts.map((_, at) => parts.slice(0, at + 1).join('/'))
}

function landing($: EngineInterface, path: string): Promise<FsStat | undefined> {
  return $.fs.stat(path, { resolve: true }).catch(() => undefined)
}

function landsInside(stat: FsStat | undefined, root: string): boolean {
  if (stat?.kind !== 'file' || stat.realPath === undefined) return false
  return insidePath(root, resolvedPath(root, stat.realPath)) !== undefined
}

export async function revealedPath(
  $: EngineInterface,
  site: { cwd: string; text: string },
): Promise<string | undefined> {
  const { cwd, text } = site
  const mentions = mentionedPaths(text)
    .map((spellings) => spellings.flatMap((path) => mentionIn(cwd, path) ?? []))
    .filter((spellings) => spellings.length > 0)
  if (mentions.length === 0) return undefined
  const root = (await landing($, cwd))?.realPath
  if (root === undefined) return undefined
  for (const spellings of mentions.reverse()) {
    for (const mention of spellings) {
      if (landsInside(await landing($, mention.absolute), root)) return mention.inside
    }
  }
  return undefined
}
