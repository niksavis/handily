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

export type ApprovalRequest = { command: readonly string[]; shown: readonly string[] }

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

export async function approvalKey(
  files: TrackerFiles,
  argv: readonly string[],
): Promise<ApprovalKey> {
  const program = argv[0] ?? ''
  const argv0 = await files.commands.which(program)
  if (argv0 === undefined) {
    throw new FileProblem(`${program} could not be found, so ${argv.join(' ')} could not be read.`)
  }
  const hashes: Record<string, string> = {}
  for (const argument of argv) {
    if (ABSOLUTE_PATH.test(argument) || argument.startsWith('-')) continue
    const digest = await files.hash(argument)
    if (digest !== undefined) hashes[argument] = digest
  }
  return { root: files.root, argv: [...argv], files: hashes, argv0 }
}

export function approvalQuestion(shown: readonly string[]): string {
  return [
    "Allow handily to run this repo's tracker CLI to read work items?",
    shown.join(' '),
    '(read-only; asked again if this file or the command changes)',
  ].join('\n')
}

async function storeKeyOf(key: ApprovalKey): Promise<string> {
  return `${STORE_PREFIX}${await sha256Hex(new TextEncoder().encode(JSON.stringify(key)))}`
}

export function createApprovals(host: ApprovalHost): Approvals {
  let isInteractive = false
  let generation = 0
  const declined = new Set<string>()
  const asking = new Set<string>()

  function askPerson(storeKey: string, key: ApprovalKey, shown: readonly string[]): void {
    asking.add(storeKey)
    host
      .ask(approvalQuestion(shown), { options: [APPROVE, DECLINE], header: ASK_HEADER })
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
      const key = await approvalKey(files, request.command)
      const storeKey = await storeKeyOf(key)
      if ((await host.stored(storeKey)) !== undefined) return 'approved'
      const mayAsk = isInteractive && !declined.has(storeKey) && !asking.has(storeKey)
      if (mayAsk) askPerson(storeKey, key, request.shown)
      return 'needed'
    },
  }
}
