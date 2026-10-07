import type { Register, Timer } from 'claude-code'
import { readers, writeVerbs } from './readers/index'
import { createProvider, POLL_INTERVAL_MS } from './snapshot'
import { stateLines } from './states'

export const register: Register = (on) => {
  let poll: Timer | undefined

  on('engine.create', async (_$, e, next) => {
    const built = await next(e)
    const provider = createProvider(
      {
        root: () => built.session.root(),
        now: () => built.clock.now(),
        exists: (path) => built.fs.exists(path),
        stat: (path) => built.fs.stat(path),
        read: (path) => built.fs.read(path),
        publish: async (snapshot) => {
          await built.state.set({ plugin: 'workitems', key: 'snapshot' }, snapshot)
        },
      },
      readers,
    )
    return {
      ...built,
      workitems: {
        refresh: () => provider.refresh(),
        writeVerbs: () => Promise.resolve(writeVerbs),
        lines: (args) => Promise.resolve(stateLines(args)),
      },
    }
  })

  on('session.start', async ($, e, next) => {
    await $.workitems.refresh()
    poll?.cancel()
    poll = $.clock.every(POLL_INTERVAL_MS, () => {
      $.workitems.refresh().catch((error: unknown) => {
        $.ui.log(`workitems: the poll refresh failed: ${String(error)}`)
      })
    })
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
