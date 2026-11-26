import type { On } from 'claude-code'

export const TEST_CAPABILITIES_DIR = '/test/state/capabilities'
export const TEST_CAPABILITY_PATH = `${TEST_CAPABILITIES_DIR}/handily-reply-view.json`
export const TEST_WRITER_VERSION = '9.8.7'
export const CAPABILITY_NOW = Date.UTC(2026, 10, 26, 12, 0, 0)

const CAPABILITY_VARIABLES: ReadonlySet<string> = new Set([
  'BASICLY_CAPABILITIES_DIR',
  'LOCALAPPDATA',
  'XDG_STATE_HOME',
  'HOME',
])
const CAPABILITY_FILE = '/handily-reply-view.json'
const MANIFEST_FILE = '/.claude-plugin/plugin.json'

export type CapabilityOptions = {
  now?: number
  env?: Readonly<Partial<Record<string, string>>>
  platform?: 'macos' | 'windows' | 'wsl' | 'linux'
  files?: Readonly<Record<string, string>>
  manifest?: string
  writeDenial?: string
}

export type CapabilityWorld = {
  files: Map<string, string>
  writes: { path: string; text: string }[]
  reads: string[]
  infos: number
}

function isCapabilityPath(path: string): boolean {
  return path.endsWith(CAPABILITY_FILE)
}

export function capabilityWorld(on: On, options: CapabilityOptions = {}): CapabilityWorld {
  const world: CapabilityWorld = {
    files: new Map(Object.entries(options.files ?? {})),
    writes: [],
    reads: [],
    infos: 0,
  }
  const env = options.env ?? { BASICLY_CAPABILITIES_DIR: TEST_CAPABILITIES_DIR }
  const manifest =
    options.manifest ?? JSON.stringify({ name: 'handily-reply-view', version: TEST_WRITER_VERSION })
  const { now } = options
  if (now !== undefined) on('clock.now', () => ({ value: now }))
  on('env.get', (_$, e, next) =>
    CAPABILITY_VARIABLES.has(e.name) ? { value: env[e.name] } : next(e),
  )
  on('session.info', () => {
    world.infos += 1
    return { value: { transcriptPath: '', platform: options.platform ?? 'linux' } }
  })
  on('fs.read', (_$, e, next) => {
    if (e.path.endsWith(MANIFEST_FILE)) return { value: manifest }
    if (!isCapabilityPath(e.path)) return next(e)
    world.reads.push(e.path)
    const text = world.files.get(e.path)
    return text === undefined
      ? { deny: `ENOENT: no such file or directory, open '${e.path}'` }
      : { value: text }
  })
  on('fs.write', (_$, e, next) => {
    if (!isCapabilityPath(e.path)) return next(e)
    if (options.writeDenial !== undefined) return { deny: options.writeDenial }
    world.writes.push({ path: e.path, text: e.text })
    world.files.set(e.path, e.text)
    return { value: undefined }
  })
  return world
}
