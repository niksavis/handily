import type { AskOptions } from 'claude-code'
import { FileProblem } from './config'
import type { TrackerFiles } from './readers/index'

export const APPROVE = 'Allow for this repo'
export const DECLINE = 'Not now'
export const ASK_HEADER = 'workitems'
const STORE_PREFIX = 'approval:'
const ABSOLUTE_PATH = /^([\\/]|[A-Za-z]:)/
const NAMES_A_FOLDER = /[\\/]/

export type ApprovalKey = {
  root: string
  argv: readonly string[]
  files: Readonly<Record<string, string>>
  argv0: string
}

export type ApprovalHost = {
  stored: (key: string) => Promise<unknown>
  store: (key: string, value: ApprovalKey) => Promise<void>
  ask: (question: string, options: AskOptions) => Promise<string>
  approved: () => void
  log: (text: string) => void
}

export type CoveredFolder = { path: string; suffix: string }

export type ApprovalRequest = {
  command: readonly string[]
  shown: readonly string[]
  folders?: readonly CoveredFolder[]
}

export type FileDigest = { sha256: string } | { size: number; mtimeMs: number }

type Coverage = {
  files: Readonly<Record<string, string>>
  folders: readonly CoveredFolder[]
  stamped: readonly string[]
}

export type Verdict = 'approved' | 'needed'

export type Approvals = {
  generation: () => number
  startSession: (isInteractive: boolean) => void
  check: (files: TrackerFiles, request: ApprovalRequest) => Promise<Verdict>
}

export type SearchPath = { path: string | undefined; extensions: string | undefined }

export type ProgramSearch = {
  searchPath: () => Promise<SearchPath>
  exists: (path: string) => Promise<boolean>
  realPath: (path: string) => Promise<string | undefined>
  realPathAtRoot: (relativePath: string) => Promise<string | undefined>
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function candidatesOn(search: SearchPath, program: string): string[] {
  if (search.path === undefined || search.path === '') return []
  const isWindows = search.extensions !== undefined
  const suffixes = ['', ...(search.extensions ?? '').split(';').filter((suffix) => suffix !== '')]
  return search.path
    .split(isWindows ? ';' : ':')
    .filter((directory) => directory !== '')
    .flatMap((directory) =>
      suffixes.map((suffix) => `${directory.replace(/[\\/]+$/, '')}/${program}${suffix}`),
    )
}

export async function resolveProgram(
  program: string,
  search: ProgramSearch,
): Promise<string | undefined> {
  if (ABSOLUTE_PATH.test(program)) return search.realPath(program)
  if (NAMES_A_FOLDER.test(program)) return search.realPathAtRoot(program)
  for (const candidate of candidatesOn(await search.searchPath(), program)) {
    if (await search.exists(candidate)) return (await search.realPath(candidate)) ?? candidate
  }
  return undefined
}

function folderOf(relativePath: string): string {
  const cut = Math.max(relativePath.lastIndexOf('/'), relativePath.lastIndexOf('\\'))
  return cut <= 0 ? '.' : relativePath.slice(0, cut)
}

function joinedPath(folder: string, name: string): string {
  return folder === '.' ? name : `${folder}/${name}`
}

function relativeToRoot(root: string, argument: string): string | undefined {
  if (argument.startsWith('-')) return undefined
  if (!ABSOLUTE_PATH.test(argument)) return argument
  const base = root.replace(/[\\/]+$/, '')
  const isUnderRoot = argument.startsWith(`${base}/`) || argument.startsWith(`${base}\\`)
  return isUnderRoot ? argument.slice(base.length + 1) : undefined
}

function digestText(digest: FileDigest): string {
  if ('sha256' in digest) return digest.sha256
  return `size ${String(digest.size)}, modified ${String(digest.mtimeMs)}`
}

async function namedRepoFiles(
  files: TrackerFiles,
  argv: readonly string[],
): Promise<Map<string, FileDigest>> {
  const named = new Map<string, FileDigest>()
  for (const argument of argv) {
    const relative = relativeToRoot(files.root, argument)
    if (relative === undefined) continue
    const digest = await files.hash(relative)
    if (digest !== undefined) named.set(relative, digest)
  }
  return named
}

async function folderFiles(files: TrackerFiles, folder: CoveredFolder): Promise<string[]> {
  if (!(await files.exists(folder.path))) return []
  return (await files.list(folder.path))
    .filter((entry) => entry.kind === 'file' || entry.isLink)
    .filter((entry) => entry.name.endsWith(folder.suffix))
    .map((entry) => joinedPath(folder.path, entry.name))
}

async function isRepoFile(files: TrackerFiles, relativePath: string): Promise<boolean> {
  try {
    return (await files.stat(relativePath)).kind !== 'dir'
  } catch {
    return false
  }
}

async function coveredFoldersOf(
  files: TrackerFiles,
  request: Pick<ApprovalRequest, 'command' | 'folders'>,
): Promise<readonly CoveredFolder[]> {
  if (request.folders) return request.folders
  const paths = new Set<string>()
  for (const argument of request.command) {
    const relative = relativeToRoot(files.root, argument)
    if (relative !== undefined && (await isRepoFile(files, relative))) {
      paths.add(folderOf(relative))
    }
  }
  return [...paths].map((path) => ({ path, suffix: '' }))
}

async function coverageOf(files: TrackerFiles, request: ApprovalRequest): Promise<Coverage> {
  const digests = await namedRepoFiles(files, request.command)
  const folders = await coveredFoldersOf(files, request)
  for (const folder of folders) {
    for (const path of await folderFiles(files, folder)) {
      if (digests.has(path)) continue
      const digest = await files.hash(path)
      if (digest !== undefined) digests.set(path, digest)
    }
  }
  const entries = [...digests.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return {
    files: Object.fromEntries(entries.map(([path, digest]) => [path, digestText(digest)])),
    folders,
    stamped: entries.filter(([, digest]) => !('sha256' in digest)).map(([path]) => path),
  }
}

export async function coverStamp(
  files: TrackerFiles,
  request: Pick<ApprovalRequest, 'command' | 'folders'>,
): Promise<string> {
  const lines: string[] = []
  for (const folder of await coveredFoldersOf(files, request)) {
    if (!(await files.exists(folder.path))) continue
    for (const entry of await files.list(folder.path)) {
      if (!entry.name.endsWith(folder.suffix)) continue
      const path = joinedPath(folder.path, entry.name)
      lines.push(`${path} ${String(entry.size)} ${String(entry.mtimeMs)}`)
    }
  }
  return lines.sort().join('\n')
}

async function approvalKey(
  files: TrackerFiles,
  argv: readonly string[],
  coverage: Coverage,
): Promise<ApprovalKey> {
  const program = argv[0] ?? ''
  const argv0 = await files.commands.which(program)
  if (argv0 === undefined) {
    throw new FileProblem(`${program} could not be found, so ${argv.join(' ')} could not be read.`)
  }
  return { root: files.root, argv: [...argv], files: coverage.files, argv0 }
}

function folderName(folder: CoveredFolder): string {
  return folder.path === '.' ? 'the repo root' : folder.path
}

function coverageNote(folders: readonly CoveredFolder[]): string {
  const [first] = folders
  if (first === undefined) return '(read-only; asked again if the command changes)'
  const kind = first.suffix === '' ? 'a file' : `a ${first.suffix} file`
  return `(read-only; it runs the repo code in ${folders.map(folderName).join(', ')}; asked again if the command or ${kind} there changes)`
}

function approvalQuestion(shown: readonly string[], coverage: Coverage): string {
  const lines = [
    "Allow handily to run this repo's tracker CLI to read work items?",
    shown.join(' '),
    coverageNote(coverage.folders),
  ]
  if (coverage.stamped.length > 0) {
    lines.push(
      `(a file over 4 MiB is checked by its size and time only: ${coverage.stamped.join(', ')})`,
    )
  }
  return lines.join('\n')
}

async function storeKeyOf(key: ApprovalKey): Promise<string> {
  return `${STORE_PREFIX}${await sha256Hex(new TextEncoder().encode(JSON.stringify(key)))}`
}

export function createApprovals(host: ApprovalHost): Approvals {
  let isInteractive = false
  let generation = 0
  const declined = new Set<string>()
  const asking = new Set<string>()

  function askPerson(storeKey: string, key: ApprovalKey, question: string): void {
    asking.add(storeKey)
    host
      .ask(question, { options: [APPROVE, DECLINE], header: ASK_HEADER })
      .then(
        async (answer) => {
          if (answer !== APPROVE) {
            declined.add(storeKey)
            return
          }
          await host.store(storeKey, key)
          generation += 1
          host.approved()
        },
        () => {
          declined.add(storeKey)
        },
      )
      .finally(() => {
        asking.delete(storeKey)
      })
      .catch((error: unknown) => {
        host.log(`workitems: the approval could not be kept: ${String(error)}`)
      })
  }

  return {
    generation: () => generation,
    startSession: (interactive) => {
      isInteractive = interactive
      declined.clear()
      generation += 1
    },
    check: async (files, request) => {
      const coverage = await coverageOf(files, request)
      const key = await approvalKey(files, request.command, coverage)
      const storeKey = await storeKeyOf(key)
      if ((await host.stored(storeKey)) !== undefined) return 'approved'
      const mayAsk = isInteractive && !declined.has(storeKey) && !asking.has(storeKey)
      if (mayAsk) askPerson(storeKey, key, approvalQuestion(request.shown, coverage))
      return 'needed'
    },
  }
}
