import type { AskOptions, FsEntry } from 'claude-code'
import { argumentProblem, FileProblem, isInside } from './config'
import type { TrackerFiles } from './readers/index'

export const APPROVE = 'Allow for this repo'
export const DECLINE = 'Not now'
export const ASK_HEADER = 'workitems'
const STORE_PREFIX = 'approval:'
const ABSOLUTE_PATH = /^([\\/]|[A-Za-z]:)/
const ABSOLUTE_FOLDER = /^([\\/]|[A-Za-z]:[\\/])/
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

export type CoveredFolder = { path: string; suffix: string; recursive?: true }

export type ApprovalRequest = {
  command: readonly string[]
  shown: readonly string[]
  folders: readonly CoveredFolder[]
}

export type FileDigest = { sha256: string } | { size: number; mtimeMs: number }

type Coverage = {
  files: Readonly<Record<string, string>>
  folders: readonly CoveredFolder[]
  stamped: readonly string[]
}

export type Verdict = { approved: true; argv0: string } | { approved: false }

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
    .filter((directory) => ABSOLUTE_FOLDER.test(directory))
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

export function refuseUnsafeArguments(argv: readonly string[]): void {
  for (const argument of argv) {
    const problem = argumentProblem(argument)
    if (problem !== null) {
      throw new FileProblem(`the command has an argument ${problem}, so it could not be read.`)
    }
  }
}

export async function programOutsideRoot(
  files: TrackerFiles,
  argv: readonly string[],
): Promise<string> {
  refuseUnsafeArguments(argv)
  const program = argv[0] ?? ''
  const argv0 = await files.commands.which(program)
  if (argv0 === undefined) {
    throw new FileProblem(`${program} could not be found, so ${argv.join(' ')} could not be read.`)
  }
  const rootReal = await files.realPath('.')
  if (rootReal === undefined) throw new FileProblem('the repo root could not be read.')
  if (isInside(rootReal, argv0)) {
    throw new FileProblem(`${program} resolves inside the repo root, so it could not be read.`)
  }
  refuseUnsafeArguments([argv0])
  return argv0
}

export function quotedCommand(argv: readonly string[]): string {
  return argv.map((argument) => JSON.stringify(argument)).join(' ')
}

function joinedPath(folder: string, name: string): string {
  return folder === '.' ? name : `${folder}/${name}`
}

function digestText(digest: FileDigest): string {
  if ('sha256' in digest) return digest.sha256
  return `size ${String(digest.size)}, modified ${String(digest.mtimeMs)}`
}

type FolderEntry = { path: string; entry: FsEntry }

async function folderEntries(files: TrackerFiles, folder: CoveredFolder): Promise<FolderEntry[]> {
  if (!(await files.exists(folder.path))) return []
  const found: FolderEntry[] = []
  for (const entry of await files.list(folder.path)) {
    const path = joinedPath(folder.path, entry.name)
    if (folder.recursive === true && entry.isLink) {
      throw new FileProblem(
        `${path} is a link, which the approval cannot cover, so it could not be read.`,
      )
    }
    if (entry.kind === 'dir' && folder.recursive === true) {
      found.push(...(await folderEntries(files, { ...folder, path })))
      continue
    }
    const isFile = entry.kind === 'file' || entry.isLink
    if (isFile && entry.name.endsWith(folder.suffix)) found.push({ path, entry })
  }
  return found
}

async function coverageOf(
  files: TrackerFiles,
  folders: readonly CoveredFolder[],
): Promise<Coverage> {
  const digests = new Map<string, FileDigest>()
  for (const folder of folders) {
    for (const { path } of await folderEntries(files, folder)) {
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
  folders: readonly CoveredFolder[],
): Promise<string> {
  const lines: string[] = []
  for (const folder of folders) {
    for (const { path, entry } of await folderEntries(files, folder)) {
      lines.push(`${path} ${String(entry.size)} ${String(entry.mtimeMs)}`)
    }
  }
  return lines.sort().join('\n')
}

function folderName(folder: CoveredFolder): string {
  return folder.path === '.' ? 'the repo root' : folder.path
}

function coverageNote(folders: readonly CoveredFolder[]): string {
  const [first] = folders
  if (first === undefined) return '(asked again if the command changes)'
  const kind = first.suffix === '' ? 'a file' : `a ${first.suffix} file`
  return `(it runs the repo code in ${folders.map(folderName).join(', ')}; asked again if the command or ${kind} there changes)`
}

function approvalQuestion(shown: readonly string[], coverage: Coverage): string {
  const lines = [
    "Allow handily to run this repo's tracker CLI to read work items?",
    quotedCommand(shown),
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
      refuseUnsafeArguments(request.shown)
      const coverage = await coverageOf(files, request.folders)
      const argv0 = await programOutsideRoot(files, request.command)
      const key = { root: files.root, argv: [...request.command], files: coverage.files, argv0 }
      const storeKey = await storeKeyOf(key)
      if ((await host.stored(storeKey)) !== undefined) return { approved: true, argv0 }
      const mayAsk = isInteractive && !declined.has(storeKey) && !asking.has(storeKey)
      const shown = [argv0, ...request.shown.slice(1)]
      if (mayAsk) askPerson(storeKey, key, approvalQuestion(shown, coverage))
      return { approved: false }
    },
  }
}
