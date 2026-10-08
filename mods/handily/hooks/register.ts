import type { Register } from 'claude-code'
import { drawReport } from './draw'
import { bundledMods, replyText, statusesOf, type Admission, type ModStatus } from './status'

const COMMAND = 'handily'
const NO_ARGUMENT_TEXT =
  '/handily takes no argument; it lists the handily mods and whether each loaded.'

const admissions = new Map<string, Admission>()
const reports = new Map<string, readonly ModStatus[]>()

function shownUnderPluginName(pluginName: string, text: string): string {
  return `${pluginName}: ${text}`
}

export const register: Register = (on) => {
  on('plugin.register', async (_$, e, next) => {
    const result = await next(e)
    admissions.set(e.name, { version: e.version, refusal: result.refuse })
    return result
  }).catch((_$, e, next) => next(e))

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show which handily mods are installed and loaded',
    })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    if (e.args.trim() !== '') return { text: NO_ARGUMENT_TEXT }
    const mods = bundledMods(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    const { enabledPlugins } = await $.settings.read()
    const statuses = statusesOf(mods, admissions, enabledPlugins)
    const text = replyText(statuses)
    reports.set(shownUnderPluginName($.plugin.name, text), statuses)
    return { text }
  })

  on('ui.render', { component: 'CommandOutput', props: { command: COMMAND } }, ($, e, next) => {
    if (e.props.isErrored) return next(e)
    const statuses = reports.get(e.props.text)
    if (statuses === undefined) return next(e)
    return drawReport($.ui.resolve(e), statuses)
  })
}
