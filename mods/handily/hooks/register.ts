import type { EngineInterface, Register } from 'claude-code'
import type { HandilyModMode, HandilyOldIdScope } from '../types'
import { drawReport } from './draw'
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
const NO_ARGUMENT_TEXT =
  '/handily takes no argument; it lists each handily mod with its version, state and mode.'

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
  for (const name of mods) {
    const ready = await readyOf($, name)
    if (ready === undefined) continue
    const manifest = await $.fs.read(manifestPath(ready.root))
    loaded.set(name, {
      version: manifestVersion(manifest, name),
      description: manifestDescription(manifest, name),
      mode: await modeOf($, name),
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

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'handily · Show the version, state, mode and purpose of each handily mod',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
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
