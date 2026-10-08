import type { HandilyModStatus } from '../types'

const MARKETPLACE = 'handily'

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

export function summaryOf(statuses: readonly HandilyModStatus[]): string {
  const loaded = statuses.filter((status) => status.state === 'loaded').length
  return `handily: ${String(loaded)} of ${String(statuses.length)} mods loaded`
}

export function replyText(statuses: readonly HandilyModStatus[]): string {
  const rows = statuses.map((status) => {
    const version = status.version === null ? '' : ` ${status.version}`
    return `- ${status.name}${version}: ${status.detail}`
  })
  return [...rows, '', summaryOf(statuses)].join('\n')
}
