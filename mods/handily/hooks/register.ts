import type { EngineInterface, Register } from 'claude-code'
import { drawReport } from './draw'
import { bundledMods, manifestVersion, replyText, statusesOf } from './status'

const COMMAND = 'handily'
const NO_ARGUMENT_TEXT =
  '/handily takes no argument; it lists the handily mods and whether each loaded.'

type Ready = { root: string } | undefined

async function readyOf($: EngineInterface, name: string): Promise<Ready> {
  switch (name) {
    case 'workitems':
      return (await $.state.get({ plugin: 'workitems', key: 'ready' })).value
    case 'quiet-items':
      return (await $.state.get({ plugin: 'quiet-items', key: 'ready' })).value
    case 'task-pane':
      return (await $.state.get({ plugin: 'task-pane', key: 'ready' })).value
    case 'session-board':
      return (await $.state.get({ plugin: 'session-board', key: 'ready' })).value
    case 'item-toasts':
      return (await $.state.get({ plugin: 'item-toasts', key: 'ready' })).value
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

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show which handily mods are installed and loaded',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
    const mods = bundledMods(await $.fs.read(manifestPath($.plugin.root)))
    const versions = await loadedVersions($, mods)
    const { enabledPlugins } = await $.settings.read()
    const statuses = statusesOf(mods, versions, enabledPlugins)
    const text = replyText(statuses)
    await $.state.set(
      { plugin: 'handily', key: 'reports', id: shownUnderPluginName($.plugin.name, text) },
      statuses,
    )
    return { text }
  })

  on(
    'ui.render',
    { component: 'CommandOutput', props: { command: COMMAND } },
    async ($, e, next) => {
      if (e.props.isErrored) return next(e)
      const { value: statuses } = await $.state.get({
        plugin: 'handily',
        key: 'reports',
        id: e.props.text,
      })
      if (statuses === undefined) return next(e)
      return drawReport($.ui.resolve(e), statuses)
    },
  )
}
