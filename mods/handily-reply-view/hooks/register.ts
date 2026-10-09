import type { EngineInterface, Register, RenderElement, RenderSurface } from 'claude-code'
import type { ReplyViewFold, ReplyViewMode } from '../types'
import { DEFAULT_COLUMNS, replyTree, type ReplyActions } from './draw'
import { blocksOf } from './markdown'
import { promptTree } from './prompt'

const COMMAND = 'replies'
const DEFAULT_MODE: ReplyViewMode = 'on'
const MODE = { plugin: 'handily-reply-view', key: 'mode' } as const
const DRAWN_CHARACTERS_AT_MOST = 60_000

const ON_TEXT =
  'on for this session. A reply longer than 30 lines folds to its first lines. Tables draw without box lines, and tables and code blocks get copy buttons. Each prompt that you type opens under a dim rule.'
const OFF_TEXT = 'off for this session. Replies and prompts draw as Claude Code draws them.'
const USAGE_TEXT = '/replies takes no argument. It turns the reply view off or on for this session.'

const COPY_REFUSALS: Readonly<Record<'no-surface' | 'no-clipboard' | 'refused', string>> = {
  'no-surface': 'no screen is attached to this session',
  'no-clipboard': 'the clipboard took nothing. The text may be too long for this terminal',
  refused: 'another plugin refused the copy',
}

function logFailure($: EngineInterface, what: string, error: unknown): void {
  $.ui.log(`reply-view: ${what}: ${String(error)}`)
}

async function toggle($: EngineInterface): Promise<string> {
  const { value: current = DEFAULT_MODE } = await $.state.get(MODE)
  const mode: ReplyViewMode = current === 'on' ? 'off' : 'on'
  await $.state.set(MODE, mode)
  return mode === 'on' ? ON_TEXT : OFF_TEXT
}

async function copyText(
  $: EngineInterface,
  text: string,
  what: string,
  surface: RenderSurface,
): Promise<void> {
  try {
    const result = await $.ui.copy({ text, surface })
    $.ui.toast(result.isCopied ? `Copied ${what}.` : `Not copied: ${COPY_REFUSALS[result.reason]}.`)
  } catch (error) {
    logFailure($, `${what} was not copied`, error)
    $.ui.toast('Not copied. The debug log says why.')
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

async function foldOf($: EngineInterface, id: string): Promise<ReplyViewFold> {
  const { value = 'folded' } = await $.state.get({ plugin: 'handily-reply-view', key: 'folds', id })
  return value
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'handily · Turn the folded view of long replies, tables, code blocks and prompt rules off or on',
    })
    await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: USAGE_TEXT }
    return { text: await toggle($) }
  })

  on('session.append', { door: 'prompt' }, async ($, e, next) => {
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
    const isRuled =
      e.surface === 'terminal' &&
      e.props.origin.kind === 'composer' &&
      e.props.from === undefined &&
      e.props.task === undefined &&
      !e.props.isExpanded &&
      e.props.text.length <= DRAWN_CHARACTERS_AT_MOST
    if (!isRuled) return next(e)
    let drawn: RenderElement | null = null
    try {
      const { value: mode = DEFAULT_MODE } = await $.state.get(MODE)
      if (mode === 'on') {
        const { value: submittedAt } = await $.state.get({
          plugin: 'handily-reply-view',
          key: 'submittedAt',
          id: e.requestId,
        })
        drawn = promptTree(
          $.ui.resolve(e),
          e.props.text,
          e.viewport?.columns ?? DEFAULT_COLUMNS,
          submittedAt,
        )
      }
    } catch (error) {
      logFailure($, `the engine draws prompt ${e.requestId}`, error)
    }
    return drawn ?? next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary === true || e.props.text.length > DRAWN_CHARACTERS_AT_MOST) return next(e)
    let drawn: RenderElement | null = null
    try {
      const { value: mode = DEFAULT_MODE } = await $.state.get(MODE)
      if (mode === 'on') {
        drawn = replyTree(
          $.ui.resolve(e),
          e.props.text,
          blocksOf(e.props.text),
          {
            columns: e.viewport?.columns ?? DEFAULT_COLUMNS,
            hasBullet: e.surface === 'terminal',
            isFirstOfReply: e.props.isFirstOfReply,
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
