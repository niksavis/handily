import type { ConfigRow, EngineInterface, Register } from 'claude-code'
import type { HandilyDefaultMode, HandilyModMode, HandilyOldIdScope } from '../types'
import { drawReport } from './draw'
import { DEFAULT_GLYPHS, glyphRowOf, glyphSettingOf, withoutMarketplace } from './glyphs'
import {
  argumentRefusal,
  GLYPHS_ARGUMENT,
  glyphsReplyText,
  refusedGlyphsOf,
  storedGlyphsOf,
  type GlyphsReport,
} from './glyphs-reply'
import {
  bundledMods,
  manifestDescription,
  manifestVersion,
  OLD_ID_SCOPES,
  oldIdsOf,
  replyText,
  statusesOf,
  type LoadedMod,
} from './status'

const COMMAND = 'handily'
const MODE_FIELD_SUFFIX = '.mode'

type Ready = { root: string } | undefined

async function readyOf($: EngineInterface, name: string): Promise<Ready> {
  switch (name) {
    case 'handily-workitems':
      return (await $.state.get({ plugin: 'handily-workitems', key: 'ready' })).value
    case 'handily-quiet-items':
      return (await $.state.get({ plugin: 'handily-quiet-items', key: 'ready' })).value
    case 'handily-board':
      return (await $.state.get({ plugin: 'handily-board', key: 'ready' })).value
    case 'handily-item-toasts':
      return (await $.state.get({ plugin: 'handily-item-toasts', key: 'ready' })).value
    case 'handily-simple-view':
      return (await $.state.get({ plugin: 'handily-simple-view', key: 'ready' })).value
    case 'handily-reply-view':
      return (await $.state.get({ plugin: 'handily-reply-view', key: 'ready' })).value
    case 'handily-filetree':
      return (await $.state.get({ plugin: 'handily-filetree', key: 'ready' })).value
    default:
      throw new Error(
        `handily: plugin.json lists "${name}", but /handily has no ready value to read for it`,
      )
  }
}

function onOrOff(stored: unknown): HandilyModMode {
  if (stored === undefined) return '-'
  if (stored === 'on' || stored === 'off') return stored
  throw new Error(`the stored mode ${JSON.stringify(stored)} is neither on nor off`)
}

async function storedMode($: EngineInterface, name: string): Promise<HandilyModMode> {
  switch (name) {
    case 'handily-workitems': {
      const { value } = await $.state.get({ plugin: 'handily-workitems', key: 'snapshot' })
      if (value === undefined) return '-'
      return value.state === 'paused' ? 'paused' : 'polling'
    }
    case 'handily-quiet-items':
      return onOrOff((await $.state.get({ plugin: 'handily-quiet-items', key: 'mode' })).value)
    case 'handily-item-toasts':
      return onOrOff((await $.state.get({ plugin: 'handily-item-toasts', key: 'mode' })).value)
    case 'handily-simple-view':
      return onOrOff((await $.state.get({ plugin: 'handily-simple-view', key: 'mode' })).value)
    case 'handily-reply-view':
      return onOrOff((await $.state.get({ plugin: 'handily-reply-view', key: 'mode' })).value)
    case 'handily-board':
    case 'handily-filetree':
      return '-'
    default:
      throw new Error(
        `handily: plugin.json lists "${name}", but /handily has no mode to read for it`,
      )
  }
}

async function modeOf($: EngineInterface, name: string): Promise<HandilyModMode> {
  try {
    return await storedMode($, name)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`handily: cannot read the mode of ${name}: ${reason}`, { to: 'debug' })
    return '?'
  }
}

function configuredMode(rows: readonly ConfigRow[], name: string): HandilyDefaultMode | null {
  const row = rows.find(
    (candidate) =>
      withoutMarketplace(candidate.provider.plugin) === name &&
      candidate.key.endsWith(MODE_FIELD_SUFFIX),
  )
  if (row === undefined) return null
  if (row.value === 'on' || row.value === 'off') return row.value
  throw new Error(`the mode setting ${JSON.stringify(row.value)} is neither on nor off`)
}

function defaultModeOf(
  $: EngineInterface,
  rows: readonly ConfigRow[],
  name: string,
  mode: HandilyModMode,
): HandilyDefaultMode | null {
  if (mode !== 'on' && mode !== 'off') return null
  try {
    return configuredMode(rows, name)
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(`handily: cannot read the default mode of ${name}: ${reason}`, { to: 'debug' })
    return null
  }
}

function manifestPath(root: string): string {
  return `${root}/.claude-plugin/plugin.json`
}

function shownUnderPluginName(pluginName: string, text: string): string {
  return `${pluginName}: ${text}`
}

async function loadedMods(
  $: EngineInterface,
  mods: readonly string[],
): Promise<Map<string, LoadedMod>> {
  const loaded = new Map<string, LoadedMod>()
  const configRows = await $.config.list()
  for (const name of mods) {
    const ready = await readyOf($, name)
    if (ready === undefined) continue
    const manifest = await $.fs.read(manifestPath(ready.root))
    const mode = await modeOf($, name)
    loaded.set(name, {
      version: manifestVersion(manifest, name),
      description: manifestDescription(manifest, name),
      mode,
      defaultMode: defaultModeOf($, configRows, name, mode),
    })
  }
  return loaded
}

async function enabledByScope($: EngineInterface): Promise<Map<HandilyOldIdScope, unknown>> {
  const found = new Map<HandilyOldIdScope, unknown>()
  for (const scope of OLD_ID_SCOPES) {
    const { enabledPlugins } = await $.settings.read({ source: scope })
    found.set(scope, enabledPlugins)
  }
  return found
}

async function glyphsReportOf($: EngineInterface): Promise<GlyphsReport> {
  const rows = await $.config.list()
  const pluginConfigs = await $.settings.read({ key: 'pluginConfigs' })
  const storedRefusal = refusedGlyphsOf(storedGlyphsOf(pluginConfigs))
  try {
    return { setting: glyphSettingOf(rows), refused: storedRefusal }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    $.ui.log(reason, { to: 'debug' })
    return { setting: DEFAULT_GLYPHS, refused: storedRefusal ?? glyphRowOf(rows)?.value }
  }
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'handily · Show the version, state, mode and purpose of each handily mod',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const args = e.args.trim()
    if (args === GLYPHS_ARGUMENT) return { text: glyphsReplyText(await glyphsReportOf($)) }
    if (args !== '') return { text: argumentRefusal(args) }
    const mods = bundledMods(await $.fs.read(manifestPath($.plugin.root)))
    const loaded = await loadedMods($, mods)
    const { enabledPlugins } = await $.settings.read()
    const report = {
      mods: statusesOf(mods, loaded, enabledPlugins),
      oldIds: oldIdsOf([$.plugin.name, ...mods], await enabledByScope($)),
    }
    const text = replyText(report)
    await $.state.set(
      { plugin: 'handily', key: 'reports', id: shownUnderPluginName($.plugin.name, text) },
      report,
    )
    return { text }
  })

  on(
    'ui.render',
    { component: 'CommandOutput', props: { command: COMMAND } },
    async ($, e, next) => {
      if (e.props.isErrored) return next(e)
      const { value: report } = await $.state.get({
        plugin: 'handily',
        key: 'reports',
        id: e.props.text,
      })
      if (report === undefined) return next(e)
      return drawReport($.ui.resolve(e), report)
    },
  )
}
