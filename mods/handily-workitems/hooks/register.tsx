import type { EngineInterface, RenderSurface, Register, Timer } from 'claude-code'
import { createApprovals, type Approvals } from './approval'
import { classify, trackerFileOf } from './commands'
import { createReaders, writeVerbs } from './readers/index'
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

type Reads = {
  poll: Timer | undefined
  provider: Provider | undefined
}

function providerOf(reads: Reads): Provider {
  if (reads.provider === undefined) throw new Error('workitems: the engine created no provider')
  return reads.provider
}

function startPoll($: EngineInterface, reads: Reads): void {
  reads.poll?.cancel()
  let lastPollFailure: string | null = null
  reads.poll = $.clock.every(POLL_INTERVAL_MS, () => {
    $.workitems.refresh().then(
      () => {
        lastPollFailure = null
      },
      (error: unknown) => {
        const text = `workitems: the poll refresh failed: ${String(error)}`
        if (text === lastPollFailure) return
        lastPollFailure = text
        $.ui.log(text)
      },
    )
  })
}

async function pause($: EngineInterface, reads: Reads): Promise<void> {
  reads.poll?.cancel()
  reads.poll = undefined
  const { value: last } = await $.state.get(SNAPSHOT)
  await providerOf(reads).pause(last)
}

async function resume($: EngineInterface, reads: Reads): Promise<string> {
  providerOf(reads).resume()
  startPoll($, reads)
  try {
    await $.workitems.refresh()
  } catch (error) {
    $.ui.log(`workitems: the refresh after a resume failed: ${String(error)}`)
    return RESUMED_UNREAD_TEXT
  }
  return RESUMED_TEXT
}

export const register: Register = (on) => {
  const reads: Reads = { poll: undefined, provider: undefined }
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
    const created = createProvider(
      {
        root: () => built.session.root(),
        now: () => built.clock.now(),
        exists: (path) => built.fs.exists(path),
        stat: (path, options) => built.fs.stat(path, options),
        list: (path) => built.fs.list(path),
        read: (path) => built.fs.read(path),
        readBytes: async (path) => bytesOf((await built.fs.read(path, { as: 'bytes' })).base64),
        homeFolder: async () => {
          const home = await built.env.get('HOME')
          return home === undefined || home === '' ? built.env.get('USERPROFILE') : home
        },
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
    return {
      ...built,
      workitems: {
        refresh: (args) => created.refresh(args),
        writeVerbs: () => Promise.resolve(writeVerbs),
        classify: (command) => Promise.resolve(classify(command)),
        trackerFile: (args) => Promise.resolve(trackerFileOf(args)),
        lines: (args) => Promise.resolve(stateLines(args, created.checked())),
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
      startPoll($, reads)
      await $.workitems.refresh().catch((error: unknown) => {
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

  on('classic.CwdChanged', async ($, e, next) => {
    await $.workitems.refresh()
    return next(e)
  }).catch(($, e, next) => {
    $.ui.log(
      `workitems: the refresh after a directory change failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return next(e)
  })
}
