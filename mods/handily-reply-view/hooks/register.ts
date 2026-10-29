import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'
import type { ReplyViewFold, ReplyViewMode } from '../types'
import { COPY_FAILED, copiedParts, copyRefusalParts } from './copy-toast'
import {
  blockCopyOf,
  DEFAULT_COLUMNS,
  plural,
  replyCopy,
  replyTree,
  replyWidth,
  type BlockCopy,
  type BlockKind,
  type CopyLayout,
  type ReplyActions,
} from './draw'
import { blocksOf } from './markdown'
import { framedPrompt } from './prompt'
import { showToast } from './toast'

const COMMAND = 'replies'
const MODE = { plugin: 'handily-reply-view', key: 'mode' } as const
const HINTS = { plugin: 'handily-reply-view', key: 'hints' } as const
const HINTS_ARGUMENT = 'hints'
const COPY_ARGUMENT = 'copy'
const REPLY_WORD = 'reply'
const COPY_REPLY_COMMAND = `/replies ${COPY_ARGUMENT} ${REPLY_WORD}`
const DRAWN_CHARACTERS_AT_MOST = 60_000

const ON_TEXT =
  'on for this session. A reply longer than 30 lines folds to its first lines. Tables draw without box lines, and tables and code blocks get copy buttons. Each prompt that you type opens under a rule labelled you.'
const OFF_TEXT = 'off for this session. Replies and prompts draw as Claude Code draws them.'
const HINTS_ON_TEXT =
  'diagram hints on for this session. Each prompt that you type carries one hint about mermaid diagrams, about 140 tokens.'
const HINTS_OFF_TEXT = 'diagram hints off for this session. A prompt that you type carries no hint.'
const USAGE_TEXT =
  '/replies turns the reply view off or on for this session. /replies hints turns the diagram hints off or on. /replies copy diagram, table, code or reply copies that block of the last reply. Set the defaults with the plugin\'s "mode" and "diagramHints" settings.'
const NO_REPLY_TEXT = 'No reply to copy yet. /replies copy reads the last reply of this session.'
const DIAGRAM_HINT =
  'The terminal draws a mermaid block in a reply as a diagram. When a flow or an exchange reads better as a diagram, add one fenced mermaid block: flowchart TD or LR, or sequenceDiagram. Keep each label short. Use at most 40 boxes and 12 participants. Do not use subgraph, direction, box, create or destroy. The reply must read well without the diagram.'

const BLOCK_NAMES: Readonly<Record<BlockKind, string>> = {
  diagram: 'diagram',
  table: 'table',
  code: 'code block',
}

function isBlockKind(word: string): word is BlockKind {
  return Object.hasOwn(BLOCK_NAMES, word)
}

function hasBulletOn(surface: RenderSurface): boolean {
  return surface === 'terminal'
}

function lastCopyOf(reply: string, kind: BlockKind, layout: CopyLayout): BlockCopy | null {
  const copies = blocksOf(reply).map((block) => blockCopyOf(block, layout))
  return copies.findLast((copy) => copy?.kind === kind)?.copy ?? null
}

function noBlockText(kind: BlockKind): string {
  return `The last reply has no ${BLOCK_NAMES[kind]}. ${COPY_REPLY_COMMAND} copies the whole reply.`
}

function lineCount(text: string): number {
  const kept = text.replace(/\r?\n$/, '')
  return kept === '' ? 0 : kept.split(/\r?\n/).length
}

function logFailure($: EngineInterface, what: string, error: unknown): void {
  $.ui.log(`reply-view: ${what}: ${String(error)}`)
}

async function toggle($: EngineInterface, defaultMode: ReplyViewMode): Promise<string> {
  const { value: current = defaultMode } = await $.state.get(MODE)
  const mode: ReplyViewMode = current === 'on' ? 'off' : 'on'
  await $.state.set(MODE, mode)
  return mode === 'on' ? ON_TEXT : OFF_TEXT
}

async function toggleHints($: EngineInterface, defaultHints: ReplyViewMode): Promise<string> {
  const { value: current = defaultHints } = await $.state.get(HINTS)
  const hints: ReplyViewMode = current === 'on' ? 'off' : 'on'
  await $.state.set(HINTS, hints)
  return hints === 'on' ? HINTS_ON_TEXT : HINTS_OFF_TEXT
}

async function copyText(
  $: EngineInterface,
  text: string,
  what: string,
  surface: RenderSurface,
): Promise<void> {
  try {
    const result = await $.ui.copy({ text, surface })
    showToast(
      $,
      result.isCopied
        ? copiedParts(what, plural(lineCount(text), 'line'))
        : copyRefusalParts(result.reason),
    )
  } catch (error) {
    logFailure($, `${what} was not copied`, error)
    showToast($, COPY_FAILED)
  }
}

function replyActions($: EngineInterface, id: string): ReplyActions {
  return {
    copy: (text, what, surface) => {
      void copyText($, text, what, surface)
    },
    fold: (next) => {
      void $.state
        .set({ plugin: 'handily-reply-view', key: 'folds', id }, next)
        .catch((error: unknown) => {
          logFailure($, `the reply did not ${next === 'folded' ? 'fold' : 'open'}`, error)
        })
    },
  }
}

type CopyRequest = {
  reply: string | undefined
  word: string
  columns: number
  drawsDiagrams: boolean
}

async function copied(
  $: EngineInterface,
  copy: BlockCopy,
  surface: RenderSurface,
): Promise<undefined> {
  await copyText($, copy.text, copy.what, surface)
  return undefined
}

async function copyFromReply(
  $: EngineInterface,
  request: CopyRequest,
): Promise<string | undefined> {
  const { reply, word } = request
  if (word !== REPLY_WORD && !isBlockKind(word)) return USAGE_TEXT
  if (reply === undefined) return NO_REPLY_TEXT
  const [surface = 'terminal'] = await $.session.surfaces()
  if (!isBlockKind(word)) return copied($, replyCopy(reply), surface)
  const copy = lastCopyOf(reply, word, {
    width: replyWidth(request.columns, hasBulletOn(surface)),
    surface,
    drawsDiagrams: request.drawsDiagrams,
  })
  return copy === null ? noBlockText(word) : copied($, copy, surface)
}

async function foldOf($: EngineInterface, id: string): Promise<ReplyViewFold> {
  const { value = 'folded' } = await $.state.get({ plugin: 'handily-reply-view', key: 'folds', id })
  return value
}

export const register: Register = (on, options) => {
  const defaultMode: ReplyViewMode = options.mode === 'off' ? 'off' : 'on'
  const drawsDiagrams = options.diagrams !== 'off'
  const defaultHints: ReplyViewMode = options.diagramHints === 'on' ? 'on' : 'off'
  let lastReply: string | undefined
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'handily · Turn the folded view of long replies, tables, code blocks and prompt rules off or on',
    })
    await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
    const { value: mode, version } = await $.state.get(MODE)
    if (mode === undefined) await $.state.set(MODE, defaultMode, { ifVersion: version })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const words = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
    const [first, second, ...rest] = words
    if (first === undefined) return { text: await toggle($, defaultMode) }
    if (first === HINTS_ARGUMENT && second === undefined) {
      return { text: await toggleHints($, defaultHints) }
    }
    if (first === COPY_ARGUMENT && second !== undefined && rest.length === 0) {
      return {
        text: await copyFromReply($, {
          reply: lastReply,
          word: second,
          columns: e.presentation.columns,
          drawsDiagrams,
        }),
      }
    }
    return { text: USAGE_TEXT }
  })

  on('session.end', async (_$, e, next) => {
    lastReply = undefined
    return next(e)
  })

  on('turn.complete', async (_$, e, next) => {
    if (e.agentId === undefined && e.answer !== '') lastReply = e.answer
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    const isTypedProse = e.origin.kind === 'composer' && e.command === undefined
    if (!isTypedProse || !drawsDiagrams) return next(e)
    const { value: hints = defaultHints } = await $.state.get(HINTS)
    const { value: mode = defaultMode } = await $.state.get(MODE)
    if (hints === 'off' || mode === 'off') return next(e)
    return next({ ...e, context: [...(e.context ?? []), DIAGRAM_HINT] })
  })

  on('session.append', { door: ['prompt', 'delivery'] }, async ($, e, next) => {
    const isTyped = e.origin.kind === 'composer' && e.agentId === undefined
    const appendedAt = await $.clock.now()
    const stored = await next(e)
    if (isTyped && stored.uuid !== undefined) {
      try {
        await $.state.set(
          { plugin: 'handily-reply-view', key: 'submittedAt', id: stored.uuid },
          appendedAt,
        )
      } catch (error) {
        logFailure($, `the time of prompt ${stored.uuid} was not kept`, error)
      }
    }
    return stored
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const isFramed =
      e.surface === 'terminal' &&
      e.props.origin.kind === 'composer' &&
      e.props.from === undefined &&
      e.props.task === undefined &&
      !e.props.isExpanded
    if (!isFramed) return next(e)
    const engineRow = await next(e)
    try {
      const { value: mode = defaultMode } = await $.state.get(MODE)
      if (mode === 'off') return engineRow
      const { value: submittedAt } = await $.state.get({
        plugin: 'handily-reply-view',
        key: 'submittedAt',
        id: e.requestId,
      })
      return framedPrompt(
        $.ui.resolve(e),
        engineRow,
        e.viewport?.columns ?? DEFAULT_COLUMNS,
        submittedAt,
      )
    } catch (error) {
      logFailure($, `the engine draws prompt ${e.requestId} without its rule`, error)
      return engineRow
    }
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true || e.props.text.length > DRAWN_CHARACTERS_AT_MOST) return next(e)
    let drawn: RenderElement | null = null
    try {
      const { value: mode = defaultMode } = await $.state.get(MODE)
      if (mode === 'on') {
        drawn = replyTree(
          $.ui.resolve(e),
          e.props.text,
          blocksOf(e.props.text),
          {
            columns: e.viewport?.columns ?? DEFAULT_COLUMNS,
            hasBullet: hasBulletOn(e.surface),
            isFirstOfReply: e.props.isFirstOfReply,
            surface: e.surface,
            drawsDiagrams,
          },
          await foldOf($, e.requestId),
          replyActions($, e.requestId),
        )
      }
    } catch (error) {
      logFailure($, `the engine draws reply ${e.requestId}`, error)
    }
    return drawn ?? next(e)
  })
}
