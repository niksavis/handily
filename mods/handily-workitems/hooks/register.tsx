import type { EngineInterface, RenderSurface, Register, Timer } from 'claude-code'
import { createApprovals, type Approvals } from './approval'
import { classify, trackerFileOf } from './commands'
import { createReaders, writeVerbs } from './readers/index'
import { sharedFolderOf } from './shared'
import { createProvider, POLL_INTERVAL_MS, type Provider } from './snapshot'
import { stateLines } from './states'

const COMMAND = 'workitems'
const SNAPSHOT = { plugin: 'handily-workitems', key: 'snapshot' } as const
const PAUSED_TEXT =
  'workitems paused for this session. It reads no tracker, so the other mods show no new items until /workitems resume.'
const IS_PAUSED_TEXT = 'workitems is paused. /workitems resume reads the tracker again.'
const RESUMED_TEXT = 'workitems resumed. It polls the tracker again and has read it once.'
const RESUMED_UNREAD_TEXT =
  'workitems resumed and polls the tracker again, but its first read failed. The debug log names the cause.'
const IS_POLLING_TEXT = 'workitems polls the tracker. /workitems pause stops every tracker read.'

export function unknownReply(word: string): string {
  return `Unknown argument ${JSON.stringify(word)}. Use /workitems, /workitems pause or /workitems resume.`
}

function canRunCommandsOn(surfaces: readonly RenderSurface[]): boolean {
  return surfaces.length === 0 || surfaces.includes('terminal')
}

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export const IDLE_AFTER_MS = 5 * 60_000
const IDLE_TICKS = IDLE_AFTER_MS / POLL_INTERVAL_MS
const OWN_PLUGIN = 'handily-workitems'

type PollHost = {
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  log: (text: string) => void
}

type Reads = {
  host: PollHost | undefined
  poll: Timer | undefined
  provider: Provider | undefined
  idleTicks: number
  isConsumerSeen: boolean
  isIdle: boolean
  lastPollFailure: string | null
}

function providerOf(reads: Reads): Provider {
  if (reads.provider === undefined) throw new Error('workitems: the engine created no provider')
  return reads.provider
}

function pollHostOf(reads: Reads): PollHost {
  if (reads.host === undefined) throw new Error('workitems: the engine created no poll host')
  return reads.host
}

function pollRead(reads: Reads): void {
  providerOf(reads)
    .refresh()
    .then(
      () => {
        reads.lastPollFailure = null
      },
      (error: unknown) => {
        const text = `workitems: the poll refresh failed: ${String(error)}`
        if (text === reads.lastPollFailure) return
        reads.lastPollFailure = text
        pollHostOf(reads).log(text)
      },
    )
}

function stopPoll(reads: Reads): void {
  reads.poll?.cancel()
  reads.poll = undefined
}

function startPoll(reads: Reads): void {
  stopPoll(reads)
  reads.idleTicks = 0
  reads.isConsumerSeen = false
  reads.isIdle = false
  reads.lastPollFailure = null
  reads.poll = pollHostOf(reads).every(POLL_INTERVAL_MS, () => {
    reads.idleTicks = reads.isConsumerSeen ? 0 : reads.idleTicks + 1
    reads.isConsumerSeen = false
    if (reads.idleTicks >= IDLE_TICKS) {
      stopPoll(reads)
      reads.isIdle = true
      return
    }
    pollRead(reads)
  })
}

function noteConsumer(reads: Reads): void {
  reads.isConsumerSeen = true
  if (!reads.isIdle || reads.provider === undefined || reads.provider.isPaused()) return
  startPoll(reads)
  pollHostOf(reads).after(0, () => {
    pollRead(reads)
  })
}

async function pause($: EngineInterface, reads: Reads): Promise<void> {
  stopPoll(reads)
  reads.isIdle = false
  const { value: last } = await $.state.get(SNAPSHOT)
  await providerOf(reads).pause(last)
}

async function resume($: EngineInterface, reads: Reads): Promise<string> {
  providerOf(reads).resume()
  startPoll(reads)
  try {
    await providerOf(reads).refresh()
  } catch (error) {
    $.ui.log(`workitems: the refresh after a resume failed: ${String(error)}`)
    return RESUMED_UNREAD_TEXT
  }
  return RESUMED_TEXT
}

export const register: Register = (on) => {
  const reads: Reads = {
    host: undefined,
    poll: undefined,
    provider: undefined,
    idleTicks: 0,
    isConsumerSeen: false,
    isIdle: true,
    lastPollFailure: null,
  }
  let approvals: Approvals | undefined

  on('engine.create', async (_$, e, next) => {
    const built = await next(e)
    const engineApprovals = createApprovals({
      stored: (key) => built.store.get(key),
      store: (key, value) => built.store.set(key, value),
      ask: (question, options) => built.ui.ask(question, options),
      approved: () => {
        created.refresh().catch((error: unknown) => {
          built.ui.log(`workitems: the refresh after an approval failed: ${String(error)}`)
        })
      },
      log: (text) => {
        built.ui.log(text)
      },
    })
    approvals = engineApprovals
    async function homeFolder(): Promise<string | undefined> {
      const home = await built.env.get('HOME')
      return home === undefined || home === '' ? built.env.get('USERPROFILE') : home
    }
    const created = createProvider(
      {
        root: () => built.session.root(),
        now: () => built.clock.now(),
        exists: (path) => built.fs.exists(path),
        stat: (path, options) => built.fs.stat(path, options),
        list: (path) => built.fs.list(path),
        read: (path) => built.fs.read(path),
        readBytes: async (path) => bytesOf((await built.fs.read(path, { as: 'bytes' })).base64),
        homeFolder,
        sharedFolder: async () =>
          sharedFolderOf(await built.env.get('XDG_CACHE_HOME'), await homeFolder()),
        write: (path, text) => built.fs.write(path, text),
        sleep: (ms) => built.clock.sleep(ms),
        commands: {
          canRun: async () => canRunCommandsOn(await built.session.surfaces()),
          run: (argv, cwd, env) =>
            built.process.run(argv, env === undefined ? { cwd } : { cwd, env: { ...env } }),
          spawn: (argv, cwd) => built.process.spawn({ argv, cwd }),
          systemRoot: () => built.env.get('SystemRoot'),
          searchPath: async () => ({
            path: await built.env.get('PATH'),
            extensions: await built.env.get('PATHEXT'),
          }),
          approvals: engineApprovals,
        },
        publish: async (snapshot) => {
          await built.state.set({ plugin: 'handily-workitems', key: 'snapshot' }, snapshot)
        },
        publishChecked: async (checked) => {
          await built.state.set({ plugin: 'handily-workitems', key: 'checked' }, checked)
        },
      },
      createReaders(),
    )
    reads.provider = created
    reads.host = {
      every: (ms, fn) => built.clock.every(ms, fn),
      after: (ms, fn) => built.clock.after(ms, fn),
      log: (text) => {
        built.ui.log(text)
      },
    }
    return {
      ...built,
      workitems: {
        refresh: (args) => {
          noteConsumer(reads)
          return created.refresh(args)
        },
        create: (args) => {
          noteConsumer(reads)
          return created.create(args)
        },
        writeVerbs: () => Promise.resolve(writeVerbs),
        classify: (command) => Promise.resolve(classify(command)),
        trackerFile: (args) => Promise.resolve(trackerFileOf(args)),
        lines: (args) => {
          noteConsumer(reads)
          return Promise.resolve(stateLines(args, created.checked()))
        },
      },
    }
  })

  on('session.start', async ($, e, next) => {
    approvals?.startSession(e.isInteractive)
    await $.command.register({
      name: COMMAND,
      description: 'handily · Pause or resume every tracker read of workitems',
      argumentHint: 'pause|resume',
    })
    const { value: last } = await $.state.get(SNAPSHOT)
    if (last?.state === 'paused') {
      await pause($, reads)
    } else {
      if (reads.poll === undefined) reads.isIdle = true
      await providerOf(reads)
        .refresh()
        .catch((error: unknown) => {
          $.ui.log(`workitems: the first refresh failed: ${String(error)}`)
        })
    }
    await $.state.set({ plugin: 'handily-workitems', key: 'ready' }, { root: $.plugin.root })
    return next(e)
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const word = e.args.trim()
    const isPaused = providerOf(reads).isPaused()
    if (word === '') return { text: isPaused ? IS_PAUSED_TEXT : IS_POLLING_TEXT }
    if (word === 'pause') {
      if (isPaused) return { text: IS_PAUSED_TEXT }
      await pause($, reads)
      return { text: PAUSED_TEXT }
    }
    if (word === 'resume') {
      if (!isPaused) return { text: IS_POLLING_TEXT }
      return { text: await resume($, reads) }
    }
    return { text: unknownReply(word) }
  })

  on('state.get', { plugin: OWN_PLUGIN }, ($, e, next) => {
    if (next.origin.plugin !== OWN_PLUGIN) noteConsumer(reads)
    return next(e)
  })

  on('classic.CwdChanged', async ($, e, next) => {
    await providerOf(reads).refresh()
    return next(e)
  }).catch(($, e, next) => {
    $.ui.log(
      `workitems: the refresh after a directory change failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return next(e)
  })
}
