import type {
  EngineInterface,
  PromptSubmitCommand,
  Register,
  RenderElement,
  RenderSurface,
} from 'claude-code'
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
import { jumpTo, PROMPTS_PANE, railCommandOf, runRailCommand, type RailPort } from './jump'
import { blocksOf } from './markdown'
import { framedPrompt } from './prompt'
import {
  addPrompt,
  clearRail,
  endTurn,
  isTurnRunning,
  newRail,
  noteCompaction,
  noteTool,
  promptsOf,
  promptTextOf,
  type Rail,
} from './rail'
import { drawRail } from './rail-pane'
import { DEFAULT_TABLE_STYLE, isTableStyle, TABLE_STYLES, type TableStyle } from './table'
import { keepChangedGlyphSetting, keepGlyphSetting, paneGlyphs, showGlyphToast } from './toasting'

const COMMAND = 'replies'
const MODE = { plugin: 'handily-reply-view', key: 'mode' } as const
const RAIL_VERSION = { plugin: 'handily-reply-view', key: 'railVersion' } as const
const HINTS = { plugin: 'handily-reply-view', key: 'hints' } as const
const HINTS_ARGUMENT = 'hints'
const COPY_ARGUMENT = 'copy'
const REPLY_WORD = 'reply'
const COPY_REPLY_COMMAND = `/replies ${COPY_ARGUMENT} ${REPLY_WORD}`
const DRAWN_CHARACTERS_AT_MOST = 60_000
const TABLE_STYLE_KEY = 'tableStyle'
const MARKETPLACE_SUFFIX = /@.*$/

const ON_TEXT =
  'on for this session. A reply longer than 30 lines folds to its first lines. Tables draw with rules between their columns, or in a full box when the Table style setting is box. Tables and code blocks get copy buttons. Each prompt that you type opens under a rule labelled you.'
const OFF_TEXT = 'off for this session. Replies and prompts draw as Claude Code draws them.'
const HINTS_ON_TEXT =
  'diagram hints on for this session. Each prompt that you type carries one hint about mermaid diagrams, about 140 tokens.'
const HINTS_OFF_TEXT = 'diagram hints off for this session. A prompt that you type carries no hint.'
const USAGE_TEXT =
  '/replies turns the reply view off or on for this session. /replies hints turns the diagram hints off or on. /replies copy diagram, table, code or reply copies that block of the last reply. /replies prompts opens or closes the prompts tab, /replies next and /replies prev move to the next or the previous prompt, and /replies prompt and a number moves to that prompt. Set the defaults with the plugin\'s "mode" and "diagramHints" settings.'
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

function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return Object.hasOwn(value, field) ? (value as Record<string, unknown>)[field] : undefined
}

function refusedTableStyles(pluginConfigs: unknown, plugin: string): unknown[] {
  if (typeof pluginConfigs !== 'object' || pluginConfigs === null) return []
  return Object.keys(pluginConfigs)
    .filter((id) => id.replace(MARKETPLACE_SUFFIX, '') === plugin)
    .map((id) => fieldOf(fieldOf(fieldOf(pluginConfigs, id), 'options'), TABLE_STYLE_KEY))
    .filter((stored) => stored !== undefined && !isTableStyle(stored))
}

function tableStyleRefusal(stored: unknown): string {
  return `reply-view: the setting ${TABLE_STYLE_KEY} holds ${JSON.stringify(stored)}, which is not ${TABLE_STYLES.join(' or ')}, so tables draw as ${DEFAULT_TABLE_STYLE}. Set Table style in /config.`
}

async function logRefusedTableStyle($: EngineInterface): Promise<void> {
  try {
    const pluginConfigs = await $.settings.read({ key: 'pluginConfigs' })
    for (const stored of refusedTableStyles(pluginConfigs, $.plugin.name)) {
      $.ui.log(tableStyleRefusal(stored), { to: 'debug' })
    }
  } catch (error) {
    logFailure($, `the setting ${TABLE_STYLE_KEY} was not read`, error)
  }
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
    showGlyphToast(
      $,
      result.isCopied
        ? copiedParts(what, plural(lineCount(text), 'line'))
        : copyRefusalParts(result.reason),
    )
  } catch (error) {
    logFailure($, `${what} was not copied`, error)
    showGlyphToast($, COPY_FAILED)
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

type RailSite = { rail: Rail; version: number; command: string | undefined }

async function hasEarlierPrompts($: EngineInterface, current?: string): Promise<boolean> {
  try {
    const messages = await $.session.messages()
    return messages.some(
      (message) =>
        message.role === 'user' && message.text.trim() !== '' && message.text !== current,
    )
  } catch (error) {
    logFailure($, 'the transcript was not read for earlier prompts', error)
    return false
  }
}

async function redrawRail($: EngineInterface, site: RailSite): Promise<void> {
  site.version += 1
  try {
    await $.state.set(RAIL_VERSION, site.version)
  } catch (error) {
    logFailure($, 'the prompts tab did not draw again', error)
  }
}

function railPortOf($: EngineInterface, site: RailSite): RailPort {
  return {
    scroll: (requestId) => $.ui.scroll({ to: { requestId }, block: 'start' }),
    pane: async () => (await $.ui.panes()).find((pane) => pane.id === PROMPTS_PANE.id),
    open: () => $.ui.open({ ...PROMPTS_PANE, focus: true }),
    close: () => $.ui.close({ id: PROMPTS_PANE.id }),
    hasEarlierPrompts: () => hasEarlierPrompts($),
    showToast: (parts) => {
      showGlyphToast($, parts)
    },
    log: (text) => {
      $.ui.log(text, { to: 'debug' })
    },
    redraw: () => redrawRail($, site),
  }
}

function slashLine(command: PromptSubmitCommand): string {
  return `/${command.name} ${command.args}`.trim()
}

type KeptPrompt = { requestId: string; text: string; at?: number }

async function keepPrompt($: EngineInterface, site: RailSite, kept: KeptPrompt): Promise<void> {
  const isFirst = promptsOf(site.rail).length === 0
  const at = kept.at ?? (await $.clock.now())
  if (!addPrompt(site.rail, kept.requestId, kept.text, at)) return
  if (isFirst) site.rail.hasEarlier = await hasEarlierPrompts($, kept.text)
  await redrawRail($, site)
}

async function foldOf($: EngineInterface, id: string): Promise<ReplyViewFold> {
  const { value = 'folded' } = await $.state.get({ plugin: 'handily-reply-view', key: 'folds', id })
  return value
}

export const register: Register = (on, options) => {
  const defaultMode: ReplyViewMode = options.mode === 'off' ? 'off' : 'on'
  const drawsDiagrams = options.diagrams !== 'off'
  const defaultHints: ReplyViewMode = options.diagramHints === 'on' ? 'on' : 'off'
  const tableStyle: TableStyle = isTableStyle(options.tableStyle)
    ? options.tableStyle
    : DEFAULT_TABLE_STYLE
  let lastReply: string | undefined
  const railSite: RailSite = { rail: newRail(), version: 0, command: undefined }
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description:
        'handily · Turn the folded view of long replies, tables, code blocks and prompt rules off or on, and move between your prompts',
    })
    await $.state.set({ plugin: 'handily-reply-view', key: 'ready' }, { root: $.plugin.root })
    const { value: mode, version } = await $.state.get(MODE)
    if (mode === undefined) await $.state.set(MODE, defaultMode, { ifVersion: version })
    await logRefusedTableStyle($)
    await keepGlyphSetting($)
    return next(e)
  })

  on('config.set', async ($, e, next) => {
    const result = await next(e)
    if (result.deny !== undefined) return result
    await keepChangedGlyphSetting($, e)
    return result
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const words = e.args
      .trim()
      .split(/\s+/)
      .filter((word) => word !== '')
    const railCommand = railCommandOf(words)
    if (railCommand !== undefined) {
      return {
        text: await runRailCommand(
          railSite.rail,
          railPortOf($, railSite),
          railCommand,
          e.presentation.isFullscreen,
        ),
      }
    }
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

  on('session.end', async ($, e, next) => {
    lastReply = undefined
    clearRail(railSite.rail)
    railSite.command = undefined
    await redrawRail($, railSite)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && e.answer !== '') lastReply = e.answer
    if (e.agentId === undefined && isTurnRunning(railSite.rail)) {
      endTurn(railSite.rail, await $.clock.now())
      await redrawRail($, railSite)
    }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    const hasRun = e.agentId === undefined && result.deny === undefined
    if (hasRun && noteTool(railSite.rail, e.tool)) await redrawRail($, railSite)
    return result
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && result.skip === undefined) {
      noteCompaction(railSite.rail, await $.clock.now())
      await redrawRail($, railSite)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: PROMPTS_PANE.id }, async ($, e) => {
    await $.state.get(RAIL_VERSION)
    const { Box, Text, Button } = $.ui.resolve(e)
    const glyphs = await paneGlyphs($, e.surface)
    const port = railPortOf($, railSite)
    const isFullscreen = e.viewport?.isFullscreen
    return drawRail(
      { Box, Text, Button },
      railSite.rail,
      {
        bodyColumns: e.props.bodyColumns,
        placement: e.props.placement,
        now: await $.clock.now(),
        doing: glyphs.doing,
        blocked: glyphs.blocked,
      },
      {
        jump: (number, requestId) => {
          void jumpTo(railSite.rail, port, number, isFullscreen, requestId)
        },
        showEarlier: () => {
          railSite.rail.showsEarlier = true
          void port.redraw()
        },
        copy: (prompt) => {
          void copyText($, prompt.text, 'the prompt', e.surface)
        },
      },
    )
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'composer') {
      const isListed = e.command !== undefined && e.command.name !== COMMAND
      railSite.command = isListed ? slashLine(e.command) : undefined
    }
    const isTypedProse = e.origin.kind === 'composer' && e.command === undefined
    if (!isTypedProse || !drawsDiagrams) return next(e)
    const { value: hints = defaultHints } = await $.state.get(HINTS)
    const { value: mode = defaultMode } = await $.state.get(MODE)
    if (hints === 'off' || mode === 'off') return next(e)
    return next({ ...e, context: [...(e.context ?? []), DIAGRAM_HINT] })
  })

  on('session.append', { door: 'command' }, async ($, e, next) => {
    const stored = await next(e)
    const { command } = railSite
    const isTyped = e.origin.kind === 'composer' && e.agentId === undefined
    if (isTyped && command !== undefined && stored.uuid !== undefined) {
      railSite.command = undefined
      await keepPrompt($, railSite, { requestId: stored.uuid, text: command })
    }
    return stored
  })

  on('session.append', { door: ['prompt', 'delivery'] }, async ($, e, next) => {
    const isTyped = e.origin.kind === 'composer' && e.agentId === undefined
    const appendedAt = await $.clock.now()
    const stored = await next(e)
    if (isTyped && stored.uuid !== undefined) {
      if (stored.message.isMeta !== true) {
        const text = promptTextOf(stored.message.content)
        await keepPrompt($, railSite, { requestId: stored.uuid, text, at: appendedAt })
      }
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
            tableStyle,
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
