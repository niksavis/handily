import type { EngineInterface, FsStat, PromptSubmitInput } from 'claude-code'
import { insidePath, resolvedPath } from './paths'

export type Reveal = { path: string | undefined }

type Mention = { absolute: string; inside: string }

const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge'])
const MENTION = /(?<=^|\s)@(?:"([^"]+)"|(\S+))/g
const LINE_RANGE = /#L\d+(?:-\d+)?$/

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

export function mentionedPaths(text: string): string[] {
  return [...text.matchAll(MENTION)].flatMap((match) => {
    const path = (match[1] ?? match[2] ?? '').replace(LINE_RANGE, '')
    return path === '' ? [] : [path]
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
  const mentions = mentionedPaths(text).flatMap((path) => mentionIn(cwd, path) ?? [])
  if (mentions.length === 0) return undefined
  const root = (await landing($, cwd))?.realPath
  if (root === undefined) return undefined
  for (const mention of mentions.reverse()) {
    if (landsInside(await landing($, mention.absolute), root)) return mention.inside
  }
  return undefined
}
