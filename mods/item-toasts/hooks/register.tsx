import type { EngineInterface, Register, Timer } from 'claude-code'
import { createToaster, type ToastHost, type Toaster } from './toasts'

const TICK_MS = 2000

type Toasts = { toaster: Toaster | undefined; ticks: Timer | undefined }

function hostOf($: EngineInterface): ToastHost {
  return {
    snapshot: async () => (await $.state.get({ plugin: 'workitems', key: 'snapshot' })).value,
    refresh: (since) => $.workitems.refresh({ since }),
    lines: async (snapshot) => $.workitems.lines({ snapshot, now: await $.clock.now() }),
    now: () => $.clock.now(),
    toast: (text) => {
      $.ui.toast(text)
    },
    log: (text) => {
      $.ui.log(text)
    },
  }
}

function stopToasts(toasts: Toasts): void {
  toasts.ticks?.cancel()
  toasts.ticks = undefined
  toasts.toaster = undefined
}

function startToasts($: EngineInterface, toasts: Toasts): Toaster {
  stopToasts(toasts)
  const toaster = createToaster(hostOf($))
  toasts.toaster = toaster
  toasts.ticks = $.clock.every(TICK_MS, () => {
    toaster.tick().catch((error: unknown) => {
      $.ui.log(`item-toasts: the tick failed: ${String(error)}`)
    })
  })
  return toaster
}

export const register: Register = (on) => {
  const toasts: Toasts = { toaster: undefined, ticks: undefined }

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await startToasts($, toasts).tick()
    return started
  })

  on('session.end', (_$, e, next) => {
    stopToasts(toasts)
    return next(e)
  })

  on('tool.call', { tool: ['Bash', 'Write', 'Edit'] }, async ($, e, next) => {
    const toaster = toasts.toaster ?? startToasts($, toasts)
    await toaster.enterCall()
    try {
      return await next(e)
    } finally {
      await toaster.leaveCall()
    }
  })
}
