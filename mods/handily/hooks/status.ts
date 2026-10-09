import type { HandilyModStatus, HandilyOldId, HandilyOldIdScope, HandilyReport } from '../types'

const MARKETPLACE = 'handily'

const RENAMED_MODS: ReadonlyMap<string, string> = new Map([
  ['workitems', 'handily-workitems'],
  ['quiet-items', 'handily-quiet-items'],
  ['task-pane', 'handily-task-pane'],
  ['session-board', 'handily-session-board'],
  ['item-toasts', 'handily-item-toasts'],
  ['agent-board', 'handily-agent-board'],
  ['simple-view', 'handily-simple-view'],
  ['reply-view', 'handily-reply-view'],
])

export const OLD_ID_SCOPES: readonly HandilyOldIdScope[] = ['user', 'project', 'local']

type Manifest = { version: unknown; dependencies: unknown }

function manifestOf(manifestText: string): Manifest {
  const manifest: unknown = JSON.parse(manifestText)
  if (typeof manifest !== 'object' || manifest === null)
    return { version: undefined, dependencies: undefined }
  return {
    version: 'version' in manifest ? manifest.version : undefined,
    dependencies: 'dependencies' in manifest ? manifest.dependencies : undefined,
  }
}

export function bundledMods(manifestText: string): string[] {
  const { dependencies } = manifestOf(manifestText)
  if (
    !Array.isArray(dependencies) ||
    dependencies.length === 0 ||
    !dependencies.every((name) => typeof name === 'string')
  ) {
    throw new Error('handily: plugin.json "dependencies" must list the handily mods by name')
  }
  return dependencies
}

export function manifestVersion(manifestText: string, name: string): string {
  const { version } = manifestOf(manifestText)
  if (typeof version !== 'string' || version === '') {
    throw new Error(`handily: the plugin.json of ${name} has no "version"`)
  }
  return version
}

function pluginId(name: string): string {
  return `${name}@${MARKETPLACE}`
}

function enabledEntry(enabledPlugins: unknown, name: string): unknown {
  if (typeof enabledPlugins !== 'object' || enabledPlugins === null) return undefined
  return (enabledPlugins as Record<string, unknown>)[pluginId(name)]
}

function stateOf(
  name: string,
  version: string | undefined,
  enabled: unknown,
): Pick<HandilyModStatus, 'state' | 'detail'> {
  if (version !== undefined) return { state: 'loaded', detail: 'loaded' }
  if (enabled === false) {
    return { state: 'disabled', detail: `disabled. Run /plugin enable ${pluginId(name)}` }
  }
  if (enabled === undefined) {
    return {
      state: 'not installed',
      detail: `not installed. Run /plugin install ${pluginId(name)}`,
    }
  }
  return {
    state: 'not loaded',
    detail: 'enabled, but it did not load. Run claude --debug to see why',
  }
}

export function statusesOf(
  mods: readonly string[],
  loadedVersions: ReadonlyMap<string, string>,
  enabledPlugins: unknown,
): HandilyModStatus[] {
  return mods.map((name) => {
    const version = loadedVersions.get(name)
    return {
      name,
      version: version ?? null,
      ...stateOf(name, version, enabledEntry(enabledPlugins, name)),
    }
  })
}

export function oldIdsOf(enabledByScope: ReadonlyMap<HandilyOldIdScope, unknown>): HandilyOldId[] {
  const found: HandilyOldId[] = []
  for (const [oldName, renamedTo] of RENAMED_MODS) {
    for (const scope of OLD_ID_SCOPES) {
      if (enabledEntry(enabledByScope.get(scope), oldName) === undefined) continue
      const id = pluginId(oldName)
      found.push({
        id,
        scope,
        detail: `old id of ${renamedTo}, in the ${scope} settings. Run claude plugin uninstall ${id} --scope ${scope}`,
      })
    }
  }
  return found
}

export function isAllWell(report: HandilyReport): boolean {
  return report.oldIds.length === 0 && report.mods.every((status) => status.state === 'loaded')
}

export function summaryOf(report: HandilyReport): string {
  const loaded = report.mods.filter((status) => status.state === 'loaded').length
  const counted = `handily: ${String(loaded)} of ${String(report.mods.length)} mods loaded`
  if (report.oldIds.length === 0) return counted
  return `${counted}. Run each uninstall command above, then restart Claude Code`
}

export function replyText(report: HandilyReport): string {
  const modRows = report.mods.map((status) => {
    const version = status.version === null ? '' : ` ${status.version}`
    return `- ${status.name}${version}: ${status.detail}`
  })
  const oldIdRows = report.oldIds.map((oldId) => `- ${oldId.id}: ${oldId.detail}`)
  return [...modRows, ...oldIdRows, '', summaryOf(report)].join('\n')
}
