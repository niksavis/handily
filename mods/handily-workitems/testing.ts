import type { MockClock } from 'claude-code/testing'

export const SETTLE_LIMIT = 1000

export async function settleUntil<T>(
  clock: MockClock,
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  condition: string,
): Promise<T> {
  let value = await read()
  for (let round = 0; !isDone(value); round += 1) {
    if (round >= SETTLE_LIMIT) {
      throw new Error(`still waiting after ${String(SETTLE_LIMIT)} settles for ${condition}`)
    }
    await clock.settle()
    value = await read()
  }
  return value
}

export async function advanceUntil<T>(
  clock: MockClock,
  ms: number,
  read: () => Promise<T>,
  isDone: (value: T) => boolean,
  condition: string,
): Promise<T> {
  await clock.advance(ms)
  return settleUntil(clock, read, isDone, condition)
}
