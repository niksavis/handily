import type {
  HandilyDefaultMode,
  HandilyModMode,
  HandilyModState,
  HandilyModStatus,
  HandilyOldId,
  HandilyOldIdScope,
  HandilyReport,
} from '../types'

const MARKETPLACE = 'niksavis'

const OLD_MARKETPLACE = 'handily'

const REPLY_COLUMNS = 80

const COLUMN_GAP = '  '

const ACTION_INDENT = '  '

const SHORTEST_ABOUT = 12

const REPLACED_MODS: ReadonlyMap<string, string> = new Map([
  ['workitems', 'handily-workitems'],
  ['quiet-items', 'handily-quiet-items'],
  ['task-pane', 'handily-board'],
  ['session-board', 'handily-board'],
  ['item-toasts', 'handily-item-toasts'],
  ['agent-board', 'handily-board'],
  ['simple-view', 'handily-simple-view'],
  ['reply-view', 'handily-reply-view'],
  ['handily-task-pane', 'handily-board'],
  ['handily-session-board', 'handily-board'],
  ['handily-agent-board', 'handily-board'],
])

export const OLD_ID_SCOPES: readonly HandilyOldIdScope[] = ['user', 'project', 'local']

export type LoadedMod = {
  version: string
  description: string
  mode: HandilyModMode
  defaultMode: HandilyDefaultMode | null
}

export type ModRow = {
  key: string
  state: HandilyModState
  name: string
  version: string
  stateText: string
  mode: string
  about: string
  action: string | null
}

export type OldRow = { key: string; name: string; detail: string; action: string }

type Manifest = { version: unknown; description: unknown; dependencies: unknown }

function manifestOf(manifestText: string): Manifest {
  const manifest: unknown = JSON.parse(manifestText)
  if (typeof manifest !== 'object' || manifest === null)
    return { version: undefined, description: undefined, dependencies: undefined }
  return {
    version: 'version' in manifest ? manifest.version : undefined,
    description: 'description' in manifest ? manifest.description : undefined,
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

export function manifestDescription(manifestText: string, name: string): string {
  const { description } = manifestOf(manifestText)
  if (typeof description !== 'string' || description === '') {
    throw new Error(`handily: the plugin.json of ${name} has no "description"`)
  }
  return description
}

function pluginId(name: string, marketplace = MARKETPLACE): string {
  return `${name}@${marketplace}`
}

function enabledEntry(enabledPlugins: unknown, id: string): unknown {
  if (typeof enabledPlugins !== 'object' || enabledPlugins === null) return undefined
  return (enabledPlugins as Record<string, unknown>)[id]
}

function missingStatus(name: string, enabled: unknown): HandilyModStatus {
  const missing = { name, version: null, mode: '-' as const, defaultMode: null, about: null }
  if (enabled === false) {
    return { ...missing, state: 'disabled', action: `Run /plugin enable ${pluginId(name)}` }
  }
  if (enabled === undefined) {
    return { ...missing, state: 'not installed', action: `Run /plugin install ${pluginId(name)}` }
  }
  return { ...missing, state: 'not loaded', action: 'Run claude --debug to see why' }
}

export function statusesOf(
  mods: readonly string[],
  loaded: ReadonlyMap<string, LoadedMod>,
  enabledPlugins: unknown,
): HandilyModStatus[] {
  return mods.map((name) => {
    const mod = loaded.get(name)
    if (mod === undefined) return missingStatus(name, enabledEntry(enabledPlugins, pluginId(name)))
    return {
      name,
      version: mod.version,
      state: 'loaded',
      mode: mod.mode,
      defaultMode: mod.defaultMode,
      about: mod.description,
      action: null,
    }
  })
}

export function oldIdsOf(
  current: readonly string[],
  enabledByScope: ReadonlyMap<HandilyOldIdScope, unknown>,
): HandilyOldId[] {
  const found: HandilyOldId[] = []
  const names = [...REPLACED_MODS, ...current.map((name) => [name, name] as const)]
  for (const [oldName, replacedBy] of names) {
    const id = pluginId(oldName, OLD_MARKETPLACE)
    for (const scope of OLD_ID_SCOPES) {
      if (enabledEntry(enabledByScope.get(scope), id) === undefined) continue
      found.push({
        id,
        scope,
        detail: `old id of ${replacedBy}, ${scope} settings`,
        action: `Run claude plugin uninstall ${id} --scope ${scope}`,
      })
    }
  }
  return found
}

function widest(texts: readonly string[]): number {
  return Math.max(0, ...texts.map((text) => text.length))
}

export function shortened(text: string, width: number): string {
  const sentence = (text.split(/[.:] /, 1)[0] ?? text).replace(/\.$/, '')
  if (sentence.length <= width) return sentence
  const room = sentence.slice(0, width - 1)
  const lastSpace = room.lastIndexOf(' ')
  const cut = lastSpace > 0 ? room.slice(0, lastSpace) : room
  return `${cut.replace(/[\s,.;:]+$/, '')}…`
}

function modeText({ mode, defaultMode }: HandilyModStatus): string {
  if (defaultMode === null || defaultMode === mode) return mode
  return `${mode} (default ${defaultMode})`
}

export function modRowsOf(report: HandilyReport): ModRow[] {
  const cells = report.mods.map((status) => ({
    status,
    name: status.name,
    version: status.version ?? '-',
    stateText: status.state,
    mode: modeText(status),
  }))
  const nameWidth = widest(cells.map((cell) => cell.name))
  const versionWidth = widest(cells.map((cell) => cell.version))
  const stateWidth = widest(cells.map((cell) => cell.stateText))
  const modeWidth = widest(cells.map((cell) => cell.mode))
  const aboutWidth = Math.max(
    SHORTEST_ABOUT,
    REPLY_COLUMNS - nameWidth - versionWidth - stateWidth - modeWidth - 4 * COLUMN_GAP.length,
  )
  return cells.map((cell) => ({
    key: cell.name,
    state: cell.status.state,
    name: cell.name.padEnd(nameWidth),
    version: cell.version.padEnd(versionWidth),
    stateText: cell.stateText.padEnd(stateWidth),
    mode: cell.mode.padEnd(modeWidth),
    about: shortened(cell.status.about ?? '', aboutWidth),
    action: cell.status.action,
  }))
}

export function oldRowsOf(report: HandilyReport): OldRow[] {
  if (report.oldIds.length === 0) return []
  const rows = [
    ...report.oldIds.map((oldId) => ({
      key: `${oldId.id} ${oldId.scope}`,
      name: oldId.id,
      detail: oldId.detail,
      action: oldId.action,
    })),
    {
      key: `${OLD_MARKETPLACE} marketplace`,
      name: `${OLD_MARKETPLACE} marketplace`,
      detail: 'old marketplace of these ids',
      action: `Run claude plugin marketplace remove ${OLD_MARKETPLACE}`,
    },
  ]
  const nameWidth = widest(rows.map((row) => row.name))
  return rows.map((row) => ({ ...row, name: row.name.padEnd(nameWidth) }))
}

export function isAllWell(report: HandilyReport): boolean {
  return report.oldIds.length === 0 && report.mods.every((status) => status.state === 'loaded')
}

function isOffOrPaused(status: HandilyModStatus): boolean {
  return status.mode === 'off' || status.mode === 'paused'
}

export function summaryOf(report: HandilyReport): string[] {
  const loaded = report.mods.filter((status) => status.state === 'loaded').length
  const off = report.mods.filter(isOffOrPaused).length
  const counted = `handily: ${String(loaded)} of ${String(report.mods.length)} mods loaded, ${String(off)} off or paused`
  if (report.oldIds.length === 0) return [counted]
  return [counted, 'Run each command above, then type /reload-plugins']
}

export function modLine(row: ModRow): string {
  return [row.name, row.version, row.stateText, row.mode, row.about].join(COLUMN_GAP).trimEnd()
}

export function oldLine(row: OldRow): string {
  return [row.name, row.detail].join(COLUMN_GAP)
}

export function actionLine(action: string): string {
  return `${ACTION_INDENT}${action}`
}

export function replyText(report: HandilyReport): string {
  const modLines = modRowsOf(report).flatMap((row) =>
    row.action === null ? [modLine(row)] : [modLine(row), actionLine(row.action)],
  )
  const oldLines = oldRowsOf(report).flatMap((row) => [oldLine(row), actionLine(row.action)])
  return [...modLines, ...oldLines, '', ...summaryOf(report)].join('\n')
}
