export const CAPABILITY_FORMAT = 'basicly.capabilities'
export const CAPABILITY_VERSION = 1
export const CAPABILITY_WRITER = 'handily-reply-view'
export const CAPABILITY_FILE = `${CAPABILITY_WRITER}.json`
export const CAPABILITY_FOLDER = 'basicly/capabilities'
export const XDG_FALLBACK = '.local/state'
export const WINDOWS_FALLBACK = 'AppData/Local'
export const FRESH_S = 12 * 60 * 60
export const FUTURE_S = 300

export type CapabilityVariable =
  'BASICLY_CAPABILITIES_DIR' | 'LOCALAPPDATA' | 'XDG_STATE_HOME' | 'HOME'

export type CapabilityEnv = {
  capabilitiesDir?: string | undefined
  localAppData?: string | undefined
  stateHome?: string | undefined
  home?: string | undefined
  isWindows?: boolean
}

export type FolderRule = { folder: string } | { refusal: string }

export type Capability = { writerVersion: string; kinds: readonly string[] }

export type CapabilityHost = {
  now: () => Promise<number>
  variable: (name: CapabilityVariable) => Promise<string | undefined>
  isWindows: () => Promise<boolean>
  manifest: () => Promise<string>
  read: (path: string) => Promise<string>
  write: (path: string, text: string) => Promise<void>
  log: (reason: string) => void
}

const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/])/u

function given(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

export function isAbsolutePath(path: string, isWindows: boolean): boolean {
  return path.startsWith('/') || (isWindows && WINDOWS_ABSOLUTE.test(path))
}

function absolute(value: string | undefined, isWindows: boolean): string | undefined {
  const path = given(value)
  return path !== undefined && isAbsolutePath(path, isWindows) ? path : undefined
}

function under(base: string, rest: string): string {
  return `${base.replace(/[\\/]+$/u, '')}/${rest}`
}

function homeFolder(home: string | undefined, rest: string, refusal: string): FolderRule {
  return home === undefined ? { refusal } : { folder: under(home, `${rest}/${CAPABILITY_FOLDER}`) }
}

export function folderRule(env: CapabilityEnv): FolderRule {
  const isWindows = env.isWindows === true
  const capabilitiesDir = absolute(env.capabilitiesDir, isWindows)
  if (capabilitiesDir !== undefined) {
    return { folder: capabilitiesDir.replace(/(?<=.)[\\/]+$/u, '') }
  }
  const home = absolute(env.home, isWindows)
  if (isWindows) {
    const localAppData = absolute(env.localAppData, isWindows)
    return localAppData === undefined
      ? homeFolder(home, WINDOWS_FALLBACK, 'no absolute LOCALAPPDATA and no absolute HOME')
      : { folder: under(localAppData, CAPABILITY_FOLDER) }
  }
  const stateHome = absolute(env.stateHome, isWindows)
  return stateHome === undefined
    ? homeFolder(home, XDG_FALLBACK, 'no absolute XDG_STATE_HOME and no absolute HOME')
    : { folder: under(stateHome, CAPABILITY_FOLDER) }
}

export function capabilityPath(folder: string): string {
  return under(folder, CAPABILITY_FILE)
}

export function epochSeconds(ms: number): number {
  return Math.floor(ms / 1000)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsed(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

export function manifestVersion(text: string): string | undefined {
  const manifest = parsed(text)
  if (!isRecord(manifest)) return undefined
  const { version } = manifest
  return typeof version === 'string' && version !== '' ? version : undefined
}

export function capabilityText(capability: Capability, writtenAt: number): string {
  const file = {
    format: CAPABILITY_FORMAT,
    version: CAPABILITY_VERSION,
    writer: CAPABILITY_WRITER,
    writer_version: capability.writerVersion,
    written_at: writtenAt,
    renders: { mermaid: [...capability.kinds] },
  }
  return `${JSON.stringify(file)}\n`
}

function writtenAtOf(text: string): number | undefined {
  const file = parsed(text)
  if (!isRecord(file)) return undefined
  const writtenAt = file.written_at
  return typeof writtenAt === 'number' && Number.isFinite(writtenAt) ? writtenAt : undefined
}

export function isKept(stored: string | undefined, capability: Capability, nowS: number): boolean {
  if (stored === undefined) return false
  const writtenAt = writtenAtOf(stored)
  if (writtenAt === undefined) return false
  const age = nowS - writtenAt
  const isFresh = age <= FRESH_S && age >= -FUTURE_S
  return isFresh && capabilityText(capability, writtenAt) === stored
}

export async function capabilityEnv(host: CapabilityHost): Promise<CapabilityEnv> {
  const capabilitiesDir = given(await host.variable('BASICLY_CAPABILITIES_DIR'))
  if (capabilitiesDir?.startsWith('/') === true) return { capabilitiesDir }
  const isWindows = await host.isWindows()
  const home = await host.variable('HOME')
  if (isWindows) {
    return { capabilitiesDir, isWindows, localAppData: await host.variable('LOCALAPPDATA'), home }
  }
  return { capabilitiesDir, isWindows, stateHome: await host.variable('XDG_STATE_HOME'), home }
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function storedOf(host: CapabilityHost, path: string): Promise<string | undefined> {
  try {
    return await host.read(path)
  } catch {
    return undefined
  }
}

async function keepCapability(host: CapabilityHost, kinds: readonly string[]): Promise<void> {
  const rule = folderRule(await capabilityEnv(host))
  if ('refusal' in rule) {
    host.log(rule.refusal)
    return
  }
  const writerVersion = manifestVersion(await host.manifest())
  if (writerVersion === undefined) {
    host.log('plugin.json has no "version"')
    return
  }
  const nowS = epochSeconds(await host.now())
  const path = capabilityPath(rule.folder)
  const capability = { writerVersion, kinds }
  if (isKept(await storedOf(host, path), capability, nowS)) return
  await host.write(path, capabilityText(capability, nowS))
}

export async function writeCapability(
  host: CapabilityHost,
  kinds: readonly string[],
): Promise<void> {
  try {
    await keepCapability(host, kinds)
  } catch (error) {
    host.log(reasonOf(error))
  }
}
