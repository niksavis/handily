import { sha256Hex } from './approval'

export const SHARED_READ_SCHEMA = 'handily.workitems.shared-read.v1'
export const SHARED_LOCK_SCHEMA = 'handily.workitems.shared-lock.v1'
export const LOCK_STALE_MS = 30_000
export const LOCK_WAIT_MS = 30_000
export const LOCK_RECHECK_MS = 250
export const SHARED_FOLDER = 'handily/workitems'
const MAX_SHARED_BYTES = 4 * 1024 * 1024
const ABSOLUTE_FOLDER = /^([\\/]|[A-Za-z]:[\\/])/

export type SharedHost = {
  folder: () => Promise<string | undefined>
  now: () => Promise<number>
  read: (path: string) => Promise<string>
  size: (path: string) => Promise<number>
  write: (path: string, text: string) => Promise<void>
  sleep: (ms: number) => Promise<void>
  token: () => string
}

export type SharedRequest = {
  place: string
  mark: string
  freshMs: number
  run: () => Promise<unknown>
}

export type SharedRead = (request: SharedRequest) => Promise<unknown>

function withoutTrailingSeparator(folder: string): string {
  return folder.replace(/[\\/]+$/, '')
}

export function sharedFolderOf(
  cacheHome: string | undefined,
  home: string | undefined,
): string | undefined {
  if (cacheHome !== undefined && ABSOLUTE_FOLDER.test(cacheHome)) {
    return `${withoutTrailingSeparator(cacheHome)}/${SHARED_FOLDER}`
  }
  if (home === undefined || !ABSOLUTE_FOLDER.test(home)) return undefined
  return `${withoutTrailingSeparator(home)}/.cache/${SHARED_FOLDER}`
}

type Paths = { cache: string; lock: string }

type Lock = 'free' | 'held'

type Take = 'mine' | 'theirs' | 'refused'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function digestOf(text: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(text))
}

async function parsedFile(host: SharedHost, path: string): Promise<unknown> {
  try {
    if ((await host.size(path)) > MAX_SHARED_BYTES) return undefined
    return JSON.parse(await host.read(path)) as unknown
  } catch {
    return undefined
  }
}

type Cached = { found: true; output: unknown } | { found: false }

function isFresh(at: unknown, now: number, freshMs: number): boolean {
  return typeof at === 'number' && Math.abs(now - at) < freshMs
}

async function cachedOutput(
  host: SharedHost,
  path: string,
  { place, mark, freshMs }: SharedRequest,
): Promise<Cached> {
  const parsed = await parsedFile(host, path)
  if (!isRecord(parsed) || parsed.schema !== SHARED_READ_SCHEMA) return { found: false }
  if (parsed.place !== place || parsed.mark !== mark) return { found: false }
  if (!isFresh(parsed.at, await host.now(), freshMs)) return { found: false }
  const { output, digest } = parsed
  if (typeof output !== 'string' || digest !== (await digestOf(output))) return { found: false }
  try {
    return { found: true, output: JSON.parse(output) as unknown }
  } catch {
    return { found: false }
  }
}

async function keepOutput(
  host: SharedHost,
  path: string,
  { place, mark }: SharedRequest,
  output: unknown,
): Promise<void> {
  const text = JSON.stringify(output)
  const kept = {
    schema: SHARED_READ_SCHEMA,
    place,
    mark,
    at: await host.now(),
    digest: await digestOf(text),
    output: text,
  }
  try {
    await host.write(path, JSON.stringify(kept))
  } catch {
    return
  }
}

type LockFile = { isMissing: true } | { isMissing: false; held: unknown }

async function lockFile(host: SharedHost, path: string): Promise<LockFile> {
  try {
    await host.size(path)
  } catch {
    return { isMissing: true }
  }
  return { isMissing: false, held: await parsedFile(host, path) }
}

function lockState(lock: LockFile, now: number): Lock {
  if (lock.isMissing) return 'free'
  const { held } = lock
  if (!isRecord(held) || held.schema !== SHARED_LOCK_SCHEMA) return 'held'
  if (held.token === null) return 'free'
  const { at } = held
  if (typeof at !== 'number' || !Number.isFinite(at)) return 'held'
  return now - at >= LOCK_STALE_MS ? 'free' : 'held'
}

async function holderToken(host: SharedHost, path: string): Promise<unknown> {
  const held = await parsedFile(host, path)
  return isRecord(held) ? held.token : undefined
}

async function takeLock(host: SharedHost, path: string, token: string, now: number): Promise<Take> {
  try {
    await host.write(path, JSON.stringify({ schema: SHARED_LOCK_SCHEMA, token, at: now }))
  } catch {
    return 'refused'
  }
  return (await holderToken(host, path)) === token ? 'mine' : 'theirs'
}

async function dropLock(host: SharedHost, path: string, token: string): Promise<void> {
  if ((await holderToken(host, path)) !== token) return
  try {
    await host.write(
      path,
      JSON.stringify({ schema: SHARED_LOCK_SCHEMA, token: null, at: await host.now() }),
    )
  } catch {
    return
  }
}

async function runHolding(
  host: SharedHost,
  paths: Paths,
  token: string,
  request: SharedRequest,
): Promise<unknown> {
  try {
    const cached = await cachedOutput(host, paths.cache, request)
    if (cached.found) return cached.output
    const output = await request.run()
    await keepOutput(host, paths.cache, request, output)
    return output
  } finally {
    await dropLock(host, paths.lock, token)
  }
}

async function pathsOf(folder: string, place: string): Promise<Paths> {
  const base = `${withoutTrailingSeparator(folder)}/${await digestOf(place)}`
  return { cache: `${base}.json`, lock: `${base}.lock` }
}

export function createSharedRead(host: SharedHost): SharedRead {
  return async (request) => {
    const folder = await host.folder()
    if (folder === undefined) return request.run()
    const paths = await pathsOf(folder, request.place)
    const deadline = (await host.now()) + LOCK_WAIT_MS
    for (;;) {
      const cached = await cachedOutput(host, paths.cache, request)
      if (cached.found) return cached.output
      const now = await host.now()
      const isLate = now >= deadline
      if (isLate || lockState(await lockFile(host, paths.lock), now) === 'free') {
        const token = host.token()
        const taken = await takeLock(host, paths.lock, token, now)
        if (taken === 'mine') return runHolding(host, paths, token, request)
        if (taken === 'refused' || isLate) return request.run()
      }
      await host.sleep(LOCK_RECHECK_MS)
    }
  }
}
