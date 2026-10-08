export type Admission = { version: string | undefined; refusal: string | undefined }

export type ModState = 'loaded' | 'refused' | 'disabled' | 'not installed' | 'not loaded'

export type ModStatus = {
  name: string
  version: string | undefined
  state: ModState
  detail: string
}

const MARKETPLACE = 'handily'

export function bundledMods(manifestText: string): string[] {
  const manifest: unknown = JSON.parse(manifestText)
  const dependencies: unknown =
    typeof manifest === 'object' && manifest !== null && 'dependencies' in manifest
      ? manifest.dependencies
      : undefined
  if (
    !Array.isArray(dependencies) ||
    dependencies.length === 0 ||
    !dependencies.every((name) => typeof name === 'string')
  ) {
    throw new Error('handily: plugin.json "dependencies" must list the handily mods by name')
  }
  return dependencies
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
  admission: Admission | undefined,
  enabled: unknown,
): Pick<ModStatus, 'state' | 'detail'> {
  if (admission?.refusal !== undefined) {
    return { state: 'refused', detail: `did not load: ${admission.refusal}` }
  }
  if (admission !== undefined) return { state: 'loaded', detail: 'loaded' }
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
  admissions: ReadonlyMap<string, Admission>,
  enabledPlugins: unknown,
): ModStatus[] {
  return mods.map((name) => {
    const admission = admissions.get(name)
    return {
      name,
      version: admission?.version,
      ...stateOf(name, admission, enabledEntry(enabledPlugins, name)),
    }
  })
}

export function summaryOf(statuses: readonly ModStatus[]): string {
  const loaded = statuses.filter((status) => status.state === 'loaded').length
  return `handily: ${String(loaded)} of ${String(statuses.length)} mods loaded`
}

export function replyText(statuses: readonly ModStatus[]): string {
  const rows = statuses.map((status) => {
    const version = status.version === undefined ? '' : ` ${status.version}`
    return `- ${status.name}${version}: ${status.detail}`
  })
  return [...rows, '', summaryOf(statuses)].join('\n')
}
