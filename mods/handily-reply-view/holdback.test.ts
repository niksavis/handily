import type { On, RenderPropsOf, TurnStepChunk, TurnStepResult } from 'claude-code'
import { describe, expect, mock, test, type Engine, type MockClock } from 'claude-code/testing'
import { BLOCK_HELD_AT_MOST, blockCut, HOLD_BOUND_MS } from './hooks/holdback'

const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const STEP = { turnId: 'turn-1', index: 0, model: 'opus', messageCount: 1 }
const RESULT: TurnStepResult = {
  turnId: 'turn-1',
  index: 0,
  answer: 'Line one\nLine two\n',
  toolUses: [],
  stopReason: 'end_turn',
  usage: null,
}
const SPINNER: RenderPropsOf['Spinner'] = {
  word: 'Sauteing',
  message: null,
  suffix: '…',
  mode: 'responding',
}
const STOP: TurnStepChunk = { kind: 'stop', stopReason: 'end_turn', usage: null }
const SETTING_LOG =
  'handily-reply-view: userConfig streaming is "fast"; set it to held or live in /config. Streaming stays held.'

type Gate = { reached: Promise<void>; open: () => void; wait: () => Promise<void> }

type World = {
  clock: MockClock
  mounts: number
  messages: (string | null)[]
  debugLogs: string[]
  pulled: number
  gates: Gate[]
  chunks: (TurnStepChunk | 'gate' | 'throw')[]
}

function gate(): Gate {
  let reach = (): void => undefined
  let open = (): void => undefined
  const reached = new Promise<void>((resolve) => {
    reach = resolve
  })
  const opened = new Promise<void>((resolve) => {
    open = resolve
  })
  return {
    reached,
    open,
    wait: async () => {
      reach()
      await opened
    },
  }
}

function text(value: string, index = 0): TurnStepChunk {
  return { kind: 'text', index, text: value }
}

function engineBeneath(on: On, surface: 'terminal' | 'desktop', pluginConfigs?: unknown): World {
  const world: World = {
    clock: mock.clock(on, { now: 1_000 }),
    mounts: 0,
    messages: [],
    debugLogs: [],
    pulled: 0,
    gates: [],
    chunks: [],
  }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.surfaces', () => ({ value: [surface] }))
  on('settings.read', () => ({ value: pluginConfigs === undefined ? {} : { pluginConfigs } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', (_$, e) => {
    if (e.component === 'Spinner') world.messages.push(e.props.message)
    return ENGINE_ROW
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  on('turn.step', async function* () {
    let gates = 0
    for (const chunk of world.chunks) {
      if (chunk === 'gate') {
        await world.gates[gates]?.wait()
        gates += 1
      } else if (chunk === 'throw') {
        throw new Error('the request ended')
      } else {
        world.pulled += 1
        yield chunk
      }
    }
    return RESULT
  })
  return world
}

async function started(
  $: Engine,
  on: On,
  surface: 'terminal' | 'desktop' = 'terminal',
  pluginConfigs?: unknown,
): Promise<World> {
  const world = engineBeneath(on, surface, pluginConfigs)
  await $.session.start({ cwd: '/work/app', surface, isInteractive: true })
  return world
}

async function spinnerMessage($: Engine, world: World): Promise<string | null | undefined> {
  world.mounts += 1
  await $.ui.mount({
    plugin: 'handily-reply-view',
    surface: 'terminal',
    component: 'Spinner',
    props: SPINNER,
    requestId: `spinner-${String(world.mounts)}`,
    viewport: { columns: 80, rows: 40 },
  })
  return world.messages.at(-1)
}

type Watched = { isSettled: () => boolean; first: Promise<IteratorResult<TurnStepChunk, unknown>> }

function watched(stream: AsyncGenerator<TurnStepChunk, unknown>): Watched {
  let isSettled = false
  const first = stream.next().then((read) => {
    isSettled = true
    return read
  })
  return { isSettled: () => isSettled, first }
}

type Rest = { chunks: TurnStepChunk[]; result: unknown }

async function rest(stream: AsyncGenerator<TurnStepChunk, unknown>): Promise<Rest> {
  const chunks: TurnStepChunk[] = []
  let read = await stream.next()
  while (read.done !== true) {
    chunks.push(read.value)
    read = await stream.next()
  }
  return { chunks, result: read.value }
}

function texts(chunks: readonly TurnStepChunk[]): string[] {
  return chunks.map((chunk) => (chunk.kind === 'text' ? chunk.text : chunk.kind))
}

describe('a streaming reply is held back', () => {
  test('the text of a block waits while it streams and arrives whole in order when the block ends', async ($, on) => {
    const world = await started($, on)
    const wait = gate()
    world.gates.push(wait)
    world.chunks = [
      text('Line one\n'),
      text('| a | b |\n|---|---|\n'),
      'gate',
      text('Line two\n'),
      STOP,
    ]
    const stream = $.turn.step(STEP)
    const read = watched(stream)
    await wait.reached
    expect(world.pulled).toBe(2)
    expect(read.isSettled()).toBe(false)
    expect(await spinnerMessage($, world)).toBe('writing reply · 3 lines · 1 table')
    wait.open()
    const first = await read.first
    expect(first.value).toEqual(text('Line one\n'))
    const after = await rest(stream)
    expect(texts(after.chunks)).toEqual(['| a | b |\n|---|---|\n', 'Line two\n', 'stop'])
    expect(after.result).toEqual(RESULT)
    expect(await spinnerMessage($, world)).toBeNull()
  })

  test('a new block releases the text of the block before it', async ($, on) => {
    const world = await started($, on)
    const wait = gate()
    world.gates.push(wait)
    world.chunks = [text('First\n', 0), 'gate', text('Second\n', 1), STOP]
    const stream = $.turn.step(STEP)
    const read = watched(stream)
    await wait.reached
    expect(read.isSettled()).toBe(false)
    wait.open()
    expect((await read.first).value).toEqual(text('First\n', 0))
    expect(texts((await rest(stream)).chunks)).toEqual(['Second\n', 'stop'])
    expect(world.debugLogs.some((line) => line.includes('block 0 released by block end'))).toBe(
      true,
    )
  })

  test('text that streams past the bound draws by complete markdown block and never a part of one', async ($, on) => {
    const world = await started($, on)
    const [late, live] = [gate(), gate()]
    world.gates.push(late, live)
    world.chunks = [
      text('Para one.\n'),
      'gate',
      text('\nPara two'),
      text('.\n\n'),
      text('Tail'),
      'gate',
      text(' end.'),
      STOP,
    ]
    const stream = $.turn.step(STEP)
    const read = watched(stream)
    await late.reached
    expect(read.isSettled()).toBe(false)
    await world.clock.advance(HOLD_BOUND_MS)
    late.open()
    expect((await read.first).value).toEqual(text('Para one.\n'))
    expect(texts([(await stream.next()).value as TurnStepChunk])).toEqual(['\nPara two'])
    expect(texts([(await stream.next()).value as TurnStepChunk])).toEqual(['.\n\n'])
    const last = watched(stream)
    await live.reached
    expect(last.isSettled()).toBe(false)
    live.open()
    expect((await last.first).value).toEqual(text('Tail'))
    expect(texts((await rest(stream)).chunks)).toEqual([' end.', 'stop'])
    expect(
      world.debugLogs.some((line) => line.includes('streams by markdown block after 8000 ms')),
    ).toBe(true)
  })

  test('past the bound a fenced block draws at its closing fence and a block over the cap draws at once', () => {
    const fence = [text('```mermaid\n'), text('a\n\n'), text('b\n'), text('```\n'), text('after')]
    expect(blockCut(fence, false)).toEqual({ count: 4, isFenced: false })
    expect(blockCut(fence.slice(0, 3), false)).toEqual({ count: 0, isFenced: false })
    expect(blockCut([text('| a |\n|---|\n| 1 |\n'), text('\n')], false)).toEqual({
      count: 2,
      isFenced: false,
    })
    expect(BLOCK_HELD_AT_MOST).toBeLessThan(10_000)
  })

  test('past the bound an unclosed block longer than the cap streams as it comes', async ($, on) => {
    const world = await started($, on)
    const late = gate()
    world.gates.push(late)
    const long = 'x'.repeat(BLOCK_HELD_AT_MOST)
    world.chunks = [text('```\n'), 'gate', text(long), text('y'), text('z'), STOP]
    const stream = $.turn.step(STEP)
    const read = watched(stream)
    await late.reached
    await world.clock.advance(HOLD_BOUND_MS)
    late.open()
    expect((await read.first).value).toEqual(text('```\n'))
    expect(texts([(await stream.next()).value as TurnStepChunk])).toEqual([long])
    expect(texts([(await stream.next()).value as TurnStepChunk])).toEqual(['y'])
    expect(texts((await rest(stream)).chunks)).toEqual(['z', 'stop'])
  })

  test('held text still reaches the transcript when the stream beneath stops mid block', async ($, on) => {
    const world = await started($, on)
    world.chunks = [text('Line one\n'), text('Line two'), 'throw']
    const stream = $.turn.step(STEP)
    const out: TurnStepChunk[] = []
    await expect(
      (async () => {
        for await (const chunk of stream) out.push(chunk)
      })(),
    ).rejects.toThrow()
    expect(texts(out)).toEqual(['Line one\n', 'Line two'])
    expect(world.debugLogs.some((line) => line.includes('released by stream end'))).toBe(true)
    expect(await spinnerMessage($, world)).toBeNull()
  })
})

describe('a streaming reply streams live', () => {
  test(
    'text streams as it arrives when the streaming setting is live',
    { options: { streaming: 'live' } },
    async ($, on) => {
      const world = await started($, on)
      const wait = gate()
      world.gates.push(wait)
      world.chunks = [text('Line one\n'), 'gate', STOP]
      const stream = $.turn.step(STEP)
      const read = watched(stream)
      expect((await read.first).value).toEqual(text('Line one\n'))
      expect(await spinnerMessage($, world)).toBeNull()
      wait.open()
      expect(texts((await rest(stream)).chunks)).toEqual(['stop'])
    },
  )

  test(
    'text streams as it arrives when the reply view is off for the session',
    { options: { mode: 'off' } },
    async ($, on) => {
      const world = await started($, on)
      const wait = gate()
      world.gates.push(wait)
      world.chunks = [text('Line one\n'), 'gate', STOP]
      const stream = $.turn.step(STEP)
      const read = watched(stream)
      expect((await read.first).value).toEqual(text('Line one\n'))
      wait.open()
      expect(texts((await rest(stream)).chunks)).toEqual(['stop'])
    },
  )

  test('text streams as it arrives when the session draws on the desktop', async ($, on) => {
    const world = await started($, on, 'desktop')
    const wait = gate()
    world.gates.push(wait)
    world.chunks = [text('Line one\n'), 'gate', STOP]
    const stream = $.turn.step(STEP)
    const read = watched(stream)
    expect((await read.first).value).toEqual(text('Line one\n'))
    wait.open()
    expect(texts((await rest(stream)).chunks)).toEqual(['stop'])
  })

  test('a streaming value that is not an option is logged', async ($, on) => {
    const world = await started($, on, 'terminal', {
      'handily-reply-view': { options: { streaming: 'fast' } },
    })
    expect(world.debugLogs).toContain(SETTING_LOG)
  })
})
