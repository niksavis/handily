import type { RenderSurface, Register, Timer } from 'claude-code'
import { createApprovals, type Approvals } from './approval'
import { createReaders, writeVerbs } from './readers/index'
import { createProvider, POLL_INTERVAL_MS } from './snapshot'
import { stateLines } from './states'

function canRunCommandsOn(surfaces: readonly RenderSurface[]): boolean {
  return surfaces.length === 0 || surfaces.includes('terminal')
}

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0))
}

export const register: Register = (on) => {
  let poll: Timer | undefined
  let approvals: Approvals | undefined

  on('engine.create', async (_$, e, next) => {
    const built = await next(e)
    const engineApprovals = createApprovals({
      stored: (key) => built.store.get(key),
      store: (key, value) => built.store.set(key, value),
      ask: (question, options) => built.ui.ask(question, options),
      approved: () => {
        provider.refresh().catch((error: unknown) => {
          built.ui.log(`workitems: the refresh after an approval failed: ${String(error)}`)
        })
      },
      log: (text) => {
        built.ui.log(text)
      },
    })
    approvals = engineApprovals
    const provider = createProvider(
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
          searchPath: async () => ({
            path: await built.env.get('PATH'),
            extensions: await built.env.get('PATHEXT'),
          }),
          approvals: engineApprovals,
        },
        publish: async (snapshot) => {
          await built.state.set({ plugin: 'workitems', key: 'snapshot' }, snapshot)
        },
      },
      createReaders(),
    )
    return {
      ...built,
      workitems: {
        refresh: (args) => provider.refresh(args),
        writeVerbs: () => Promise.resolve(writeVerbs),
        lines: (args) => Promise.resolve(stateLines(args)),
      },
    }
  })

  on('session.start', async ($, e, next) => {
    approvals?.startSession(e.isInteractive)
    poll?.cancel()
    poll = $.clock.every(POLL_INTERVAL_MS, () => {
      $.workitems.refresh().catch((error: unknown) => {
        $.ui.log(`workitems: the poll refresh failed: ${String(error)}`)
      })
    })
    await $.workitems.refresh().catch((error: unknown) => {
      $.ui.log(`workitems: the first refresh failed: ${String(error)}`)
    })
    await $.state.set({ plugin: 'workitems', key: 'ready' }, { root: $.plugin.root })
    return next(e)
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
