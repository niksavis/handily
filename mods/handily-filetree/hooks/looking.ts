import type { EngineInterface } from 'claude-code'
import {
  type DiffResult,
  type Look,
  type LookSite,
  type PreviewResult,
  loadDiff,
  loadPreview,
} from './look'
import type { PaneActions } from './pane'
import { marked } from './toast'
import { showGlyphToast } from './toasting'

export type Looking = { opened: string | undefined; look: Look | undefined; generation: number }

export type LookActions = Pick<
  PaneActions,
  'openFile' | 'preview' | 'diff' | 'back' | 'copy' | 'mention'
>

const WHITESPACE = /\s/
const NOT_COPIED: Readonly<Record<'no-surface' | 'no-clipboard' | 'refused', string>> = {
  'no-surface': 'no surface takes it',
  'no-clipboard': 'no clipboard took it',
  refused: 'a hook kept it out',
}
const NOT_FILLED = { no_composer: 'no prompt box here', dialog: 'a dialog holds the keys' }

export function newLooking(): Looking {
  return { opened: undefined, look: undefined, generation: 0 }
}

export function resetLooking(looking: Looking): void {
  looking.opened = undefined
  looking.look = undefined
  looking.generation += 1
}

export function mentionOf(path: string): string {
  return WHITESPACE.test(path) ? `@"${path}"` : `@${path}`
}

function log($: EngineInterface, text: string): void {
  $.ui.log(`handily-filetree: ${text}`)
}

function redraw($: EngineInterface): void {
  $.ui.invalidate('ui.render')
}

function begin($: EngineInterface, looking: Looking, look: Look): number {
  looking.generation += 1
  looking.look = look
  redraw($)
  return looking.generation
}

function settled($: EngineInterface, looking: Looking, generation: number, look: Look): void {
  if (looking.generation !== generation) return
  looking.look = look
  redraw($)
}

function previewOf(
  $: EngineInterface,
  looking: Looking,
  site: LookSite,
  path: string,
): Promise<void> {
  const generation = begin($, looking, { kind: 'preview', path, result: undefined })
  return loadPreview($, site, path)
    .catch((error: unknown): PreviewResult => {
      log($, `the preview of ${path} failed: ${String(error)}`)
      return { kind: 'unreadable', reason: 'see the transcript log' }
    })
    .then((result) => {
      settled($, looking, generation, { kind: 'preview', path, result })
    })
}

function diffOf(
  $: EngineInterface,
  looking: Looking,
  site: LookSite,
  target: { path: string; isFolder: boolean },
): Promise<void> {
  const { path, isFolder } = target
  const generation = begin($, looking, { kind: 'diff', path, isFolder, result: undefined })
  return loadDiff($, site, target)
    .catch((error: unknown): DiffResult => {
      log($, `the diff of ${path} failed: ${String(error)}`)
      return { kind: 'failed', reason: 'see the transcript log' }
    })
    .then((result) => {
      settled($, looking, generation, { kind: 'diff', path, isFolder, result })
    })
}

function failedToast($: EngineInterface, what: string): (error: unknown) => void {
  return (error) => {
    log($, `${what} failed: ${String(error)}`)
    showGlyphToast($, [marked('blocked', `${what} failed`), 'the transcript shows why'])
  }
}

export function lookActionsOf(
  $: EngineInterface,
  looking: Looking,
  siteOf: () => LookSite,
): LookActions {
  return {
    openFile: (path) => {
      looking.opened = looking.opened === path ? undefined : path
      redraw($)
    },
    preview: (path) => {
      previewOf($, looking, siteOf(), path).catch(failedToast($, 'Preview'))
    },
    diff: (path, isFolder) => {
      diffOf($, looking, siteOf(), { path, isFolder }).catch(failedToast($, 'Diff'))
    },
    back: () => {
      looking.look = undefined
      looking.generation += 1
      redraw($)
    },
    copy: (text, surface) => {
      $.ui
        .copy({ text, surface })
        .then((result) => {
          if (result.isCopied) {
            showGlyphToast($, [marked('done', 'Copied'), { quoted: text }])
            return
          }
          log($, `the copy of ${text} did not take: ${result.reason}`)
          showGlyphToast($, [marked('blocked', 'Not copied'), NOT_COPIED[result.reason]])
        })
        .catch(failedToast($, 'Copy'))
    },
    mention: (path) => {
      $.prompt
        .fill({ text: mentionOf(path), mode: 'insert' })
        .then((filled) => {
          if (filled.isFilled) return
          const why =
            filled.refusal === undefined ? 'a hook kept it out' : NOT_FILLED[filled.refusal]
          showGlyphToast($, [marked('blocked', 'Not in the prompt'), why])
        })
        .catch(failedToast($, 'Prompt fill'))
    },
  }
}
