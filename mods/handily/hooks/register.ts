import type { EngineInterface, Register } from 'claude-code'
import type { HandilyOldIdScope } from '../types'
import { drawReport } from './draw'
import {
  bundledMods,
  manifestVersion,
  OLD_ID_SCOPES,
  oldIdsOf,
  replyText,
  statusesOf,
} from './status'

const COMMAND = 'handily'
const NO_ARGUMENT_TEXT =
  '/handily takes no argument; it lists the handily mods and whether each loaded.'

type Ready = { root: string } | undefined

async function readyOf($: EngineInterface, name: string): Promise<Ready> {
  switch (name) {
    case 'handily-workitems':
      return (await $.state.get({ plugin: 'handily-workitems', key: 'ready' })).value
    case 'handily-quiet-items':
      return (await $.state.get({ plugin: 'handily-quiet-items', key: 'ready' })).value
    case 'handily-task-pane':
      return (await $.state.get({ plugin: 'handily-task-pane', key: 'ready' })).value
    case 'handily-session-board':
      return (await $.state.get({ plugin: 'handily-session-board', key: 'ready' })).value
    case 'handily-item-toasts':
      return (await $.state.get({ plugin: 'handily-item-toasts', key: 'ready' })).value
    case 'handily-agent-board':
      return (await $.state.get({ plugin: 'handily-agent-board', key: 'ready' })).value
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

function manifestPath(root: string): string {
  return `${root}/.claude-plugin/plugin.json`
}

function shownUnderPluginName(pluginName: string, text: string): string {
  return `${pluginName}: ${text}`
}

async function loadedVersions(
  $: EngineInterface,
  mods: readonly string[],
): Promise<Map<string, string>> {
  const versions = new Map<string, string>()
  for (const name of mods) {
    const ready = await readyOf($, name)
    if (ready === undefined) continue
    versions.set(name, manifestVersion(await $.fs.read(manifestPath(ready.root)), name))
  }
  return versions
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
      description: 'handily · Show which handily mods are installed and loaded',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
    const mods = bundledMods(await $.fs.read(manifestPath($.plugin.root)))
    const versions = await loadedVersions($, mods)
    const { enabledPlugins } = await $.settings.read()
    const report = {
      mods: statusesOf(mods, versions, enabledPlugins),
      oldIds: oldIdsOf(await enabledByScope($)),
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
