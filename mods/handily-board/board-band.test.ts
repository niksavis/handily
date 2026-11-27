import type { On, RenderPropsOf } from 'claude-code'
import { describe, expect, test, type Engine, type Mounted } from 'claude-code/testing'
import { NEEDS_YOU_AFTER_MS } from './hooks/agents'
import { displayWidth } from './hooks/width'
import type { TaskHost } from './hooks/commands'
import { type PlanHost, addPlanAsTasks, newPlan } from './hooks/plan'
import type { BoardList, BoardPlan } from './types'
import { bandSetting } from './hooks/band'
import {
  isEngineRow,
  expectEngineRow,
  ROOT,
  PANE,
  PLUGIN,
  TOOL_ADD,
  TOOL_UPDATE,
  TOOL_LIST,
  TOOL_MOVE,
  fakeWorkitems,
  type World,
  GLYPHS_KEY,
  glyphsRow,
  world,
  start,
  board,
  modelTool,
  paneProps,
  withWorkitems,
  composeFor,
  MACHINE,
  OWN_SESSION_ID,
  WAITS_TOAST,
  drawnOf,
  texts,
  readExpanded,
  expandedState,
  MINUTE,
  START,
  screenOf,
  screen,
  unframed,
  bySurface,
  fromTasks,
  lineWith,
  readsOf,
  SURFACES,
  type Surface,
  withToolIds,
  engineRows,
  type Called,
  called,
  useOf,
  lineOf,
  callRow,
  mockWork,
  mountTab,
  HOUR,
  spawnFrom,
  stepped,
  stepWorld,
  step,
  SCOUT,
  LANE,
  EXPLORE,
  SCOUT_WAITS,
  personDialog,
  runningAgent,
  startOn,
  askAs,
  scoutWaits,
  HELD_COMMAND,
  holdCommand,
  SCOUT_USAGE,
  LANE_EXTRAS,
  EXPLORE_USAGE,
  APPROVED_PLAN,
  planOf,
  approve,
  mountTasks,
  planLine,
  TOOL_ASSIGN,
  TOOL_CLOSE,
  ANSWERED,
  OPEN_LINE,
  openTasksNote,
  assignFour,
  notesAtNextPrompt,
  OWN_PROMPT,
  enteredPrompts,
  forYouLines,
  joinedWords,
  ASKED_TITLE,
  ASKED_OPTIONS,
} from './fixtures/board-kit'

function expectNoEngineRow(value: unknown, message?: string): void {
  expect(isEngineRow(value), message ?? 'a row that is not the engine row').toBe(false)
}

const NERD_WAITS_TOAST = ['\u{EAA2} Board waits for a wider terminal', 'run /board to open it here']

function ownSession(on: On): void {
  const store = new Map<string, unknown>()
  on('session.id', () => ({ value: OWN_SESSION_ID }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.delete', (_$, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
}

function bandProps(bodyColumns = 75, hasSurvey = false): RenderPropsOf['AbovePrompt'] {
  return {
    hasSurvey,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  }
}

async function mountBand($: Engine, surface: Surface, bodyColumns = 75, hasSurvey = false) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: bandProps(bodyColumns, hasSurvey),
  })
}

async function bandLine(
  $: Engine,
  surface: Surface,
  bodyColumns = 75,
  hasSurvey = false,
): Promise<string | undefined> {
  const ui = await mountBand($, surface, bodyColumns, hasSurvey)
  const band = drawnOf(await ui.find({ key: 'band' }))
  await ui.unmount()
  return band === null ? undefined : (screenOf(band, bodyColumns)[0] ?? '').trimEnd()
}

async function bandFour($: Engine, seen: World): Promise<void> {
  await seen.clock.set(START)
  await $.tool.call({
    tool: TOOL_ADD,
    titles: [
      'Read the design',
      'Write the tab mocks',
      'Review the mocks with Codex',
      'Ask the person about tabs',
    ],
  })
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'in_progress' })
  await seen.clock.set(START + 4 * MINUTE)
}

describe('the task band above the prompt (handily-9uj3n.9)', () => {
  for (const surface of SURFACES) {
    test(
      `while the this session tab is not shown, the band shows the current task, done of total and a board button on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await bandFour($, seen)
        expect(await bandLine($, surface)).toBe(
          '▶ 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ]',
        )
        const ui = await mountBand($, surface)
        const button = await ui.find({ key: 'band-board' })
        expect(button?.text).toBe('board')
        expect(button?.props.hotkey).toBeUndefined()
        await ui.press({ key: 'band-board' })
        expect(seen.opens[0]).toEqual({ id: PANE, title: 'this session', focus: true })
        expect(await ui.find({ key: 'band' })).toBeUndefined()
        expectEngineRow(await ui.drawn())
        await ui.unmount()
        expect(seen.toasts).toEqual([])
      },
    )

    test(
      `the band names the next pending task, a second task in progress, a stalled time and the tasks for you on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await bandFour($, seen)
        await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'pending' })
        await $.tool.call({ tool: TOOL_MOVE, id: 3, before: 2 })
        expect(await bandLine($, surface)).toBe(
          '○ 3 Review the mocks with Codex                     next ▰▱▱▱ 1/4 [ board ]',
        )
        await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'in_progress' })
        await $.tool.call({ tool: TOOL_MOVE, id: 2, before: 3 })
        await $.tool.call({ tool: TOOL_UPDATE, id: 3, status: 'in_progress' })
        expect(await bandLine($, surface)).toBe(
          '▶ 2 Write the tab mocks · +1 in progress              4m ▰▰▰▱ 1/4 [ board ]',
        )
        await $.tool.call({ tool: TOOL_UPDATE, id: 3, status: 'pending' })
        await seen.clock.advance(16 * MINUTE)
        const ui = await mountBand($, surface)
        expect((await ui.find({ type: 'Text', text: 'stalled 20m' }))?.props.color).toBe('warning')
        await ui.unmount()
        for (const title of ['Rotate the key', 'Pick a port', 'Restart the probe']) {
          await $.tool.call({ tool: 'mcp__handily-board__task_assign', kind: 'do', title })
        }
        expect(await bandLine($, surface)).toBe(
          '◆ 3 for you: Rotate the key · ▶ 2 Write the… stalled 20m ▰▰▱▱ 1/4 [ board ]',
        )
      },
    )

    test(
      `the band shows nothing while the this session tab is shown, with no open task, or under a survey on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        const drawn = async (hasSurvey = false) => {
          const ui = await mountBand($, surface, 75, hasSurvey)
          const tree = await ui.drawn()
          await ui.unmount()
          return tree
        }
        expectEngineRow(await drawn())
        await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
        expect(await bandLine($, surface)).toBeDefined()
        expectEngineRow(await drawn(true))
        expect(await board($, '')).toBe('Board opened: this session.')
        expectEngineRow(await drawn())
        expect(await board($, '')).toBe('Board closed.')
        expect(await bandLine($, surface)).toBeDefined()
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
        expectEngineRow(await drawn())
        expect(seen.toasts).toEqual([])
      },
    )

    test(
      `while an approved plan waits, the band shows the plan offer and its add button on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        engineRows(on)
        await start($)
        await approve($, seen)
        expect(await bandLine($, surface)).toBe(
          'Plan  approved · 3 steps  [ add 3 as tasks ]                      [ board ]',
        )
        const ui = await mountBand($, surface)
        expect((await ui.find({ key: 'band-plan-add' }))?.props.hotkey).toBeUndefined()
        await ui.press({ key: 'band-plan-add' })
        await ui.unmount()
        expect(await modelTool($, {})).toBe(
          'Tasks (0 of 3 done)\n  1  pending      claude   "Create a.txt"\n  2  pending      claude   "Create b.txt"\n  3  pending      claude   "Create c.txt"',
        )
        expect(await bandLine($, surface)).toBe(
          '○ 1 Create a.txt                                     next ▱▱▱ 0/3 [ board ]',
        )
      },
    )

    test(
      `with the band setting off, the band shows nothing on ${surface}`,
      { ...withToolIds, options: { band: 'off' } },
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        engineRows(on)
        await start($)
        await bandFour($, seen)
        await approve($, seen)
        const ui = await mountBand($, surface)
        expectEngineRow(await ui.drawn())
        await ui.unmount()
      },
    )

    test(
      `the band yields to a band drawing beneath it and never wraps it on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        on('ui.render', { component: 'AbovePrompt', plugin: PLUGIN }, ($, e) =>
          $.ui.resolve(e).Text({ children: 'a survey of another mod' }),
        )
        on('ui.render', { component: 'AbovePrompt' }, ($, e, next) =>
          'plugin' in e ? next(e) : $.ui.resolve(e).Text({ children: 'a survey of another mod' }),
        )
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
        const ui = await mountBand($, surface)
        expect(drawnOf(await ui.drawn())?.text).toBe('a survey of another mod')
        expect(await ui.find({ key: 'band' })).toBeUndefined()
        await ui.unmount()
      },
    )
  }

  test(
    'the band fits 35 and 25 columns: the bar drops first, then the time',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      engineRows(on)
      await start($)
      await bandFour($, seen)
      expect(await bandLine($, 'terminal', 35)).toBe('▶ 2 Write the tab… 4m 1/4 [ board ]')
      expect(await bandLine($, 'terminal', 25)).toBe('▶ 2 Write…  1/4 [ board ]')
    },
  )

  test(
    'a press on board that the engine refuses shows one toast and logs why',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, { unplacedReason: 'the terminal is too narrow' })
      engineRows(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
      const ui = await mountBand($, 'terminal')
      await ui.press({ key: 'band-board' })
      await ui.unmount()
      expect(seen.toasts).toEqual([
        ['■ The board did not open', 'the transcript shows why', '/board list prints the tasks'],
      ])
      expect(seen.logs).toContain(
        'handily-board: the board did not open from the band: the terminal is too narrow',
      )
    },
  )
})

const STRIP_CRITERION =
  'When subagents run and no board tab is shown, the band shows at most 3 agent rows, needs you first, then failed, then done, then running, each with its state word, its plan step or tool, and an open button, and a fold button names the rest.'
const STRIP_NO_TASK_CRITERION =
  'When agents run and no task is open, the band still shows the agent rows.'
const STRIP_WIDTH_CRITERION =
  'When the band body is narrower than 100 columns, the ctx column is left out and every row fits the body at 80 and 40 columns.'
const STRIP_REDRAW_CRITERION =
  'When an agent changes state, the band draws at once, and tool details and times change only on the 10 s tick.'

const STRIP_PLAN = 'a0000008plan'
const STRIP_GHOST = 'a0000009ghost'
const STRIP_TESTER = 'a0000010tester'
const STRIP_IMPLEMENTER = 'a0000011implementer'
const STRIP_GATE_TITLES = [
  'Read the gates',
  'Fix the lint',
  'Fix the types',
  'Run the gates',
  'Commit the fix',
]
const STRIP_ANSWER =
  'Found 3 callers of drawBand; .npmrc holds token=s3cr3tvalue and the CI file reads it'
const STRIP_PLAN_TITLES = [
  'Read the design',
  'Map the hooks',
  'Draw the plan',
  'Test the fold',
  'Bump the version',
  'Write the notes',
  'Ask for review',
]
const SESSION_OPEN_FOCUS = { id: PANE, title: 'this session', focus: true }
const PLAN_USAGE = { fresh: 1_000, written: 3_000, read: 18_000, output: 500 }
const withStripExpanded = { plugins: [fakeWorkitems, readExpanded] }

async function agentEnds(
  $: Engine,
  agentId: string,
  answer: string,
  durationMs: number,
): Promise<void> {
  await $.turn.complete({
    turnId: `turn-${agentId}`,
    reason: 'answer',
    answer,
    durationMs,
    isAborted: false,
    agentId,
  })
}

function tasksRuns(on: On): string[] {
  const runs: string[] = []
  on('command.run', { command: 'tasks' }, (_$, e) => {
    runs.push(e.command)
    return { text: '' }
  })
  return runs
}

async function stripScene($: Engine, on: On, surface: Surface) {
  const seen = world(on)
  engineRows(on)
  const dialog = personDialog(on)
  const steps = stepWorld(on)
  const runs = tasksRuns(on)
  await startOn($, surface)
  await seen.clock.set(START)
  await spawnFrom($, LANE)
  seen.agents.push(runningAgent(LANE, 'lane-b'))
  await $.tool.call({ tool: 'Bash', command: 'npm run build', agentId: LANE })
  await seen.clock.advance(4 * MINUTE)
  seen.agents.splice(0, 1, { ...runningAgent(LANE, 'lane-b'), status: 'failed' })
  await agentEnds($, LANE, '', 4 * MINUTE)
  await spawnFrom($, STRIP_PLAN)
  seen.agents.push(runningAgent(STRIP_PLAN, 'Plan'))
  await step($, steps, STRIP_PLAN, stepped('turn-p', PLAN_USAGE, 'end_turn'))
  await seen.clock.advance(30_000)
  seen.agents.splice(1, 1, { ...runningAgent(STRIP_PLAN, 'Plan'), status: 'completed' })
  await agentEnds($, STRIP_PLAN, STRIP_ANSWER, 30_000)
  await spawnFrom($, SCOUT)
  seen.agents.push(runningAgent(SCOUT, 'scout'))
  await step($, steps, SCOUT, stepped('turn-s', SCOUT_USAGE, 'tool_use'))
  await spawnFrom($, EXPLORE, SCOUT)
  seen.agents.push(runningAgent(EXPLORE, 'Explore'))
  for (const title of STRIP_PLAN_TITLES) {
    await $.tool.call({ tool: TOOL_ADD, title, agentId: EXPLORE })
  }
  await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed', agentId: EXPLORE })
  await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'completed', agentId: EXPLORE })
  await $.tool.call({ tool: TOOL_UPDATE, id: 3, status: 'in_progress', agentId: EXPLORE })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/band.ts`, agentId: EXPLORE })
  await step($, steps, EXPLORE, stepped('turn-e', EXPLORE_USAGE, 'tool_use'))
  for (const [id, name] of LANE_EXTRAS) {
    await spawnFrom($, id)
    seen.agents.push(runningAgent(id, name))
  }
  await seen.clock.advance(MINUTE - NEEDS_YOU_AFTER_MS)
  const call = askAs($, SCOUT, 'npm test')
  await dialog.opened(1)
  await seen.clock.advance(NEEDS_YOU_AFTER_MS)
  return { seen, dialog, call, steps, runs }
}

function stripProps(body: number, maxRows: number): RenderPropsOf['AbovePrompt'] {
  return { ...bandProps(body), maxRows }
}

async function mountStrip($: Engine, surface: Surface, body: number, maxRows = 10) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'AbovePrompt',
    props: stripProps(body, maxRows),
  })
}

async function stripOn(ui: { find: Mounted['find'] }, body: number): Promise<string[]> {
  const band = drawnOf(await ui.find({ key: 'band' }))
  if (band === null) throw new Error('the band drew nothing')
  const lines = screenOf(band, body).map((line) => line.trimEnd())
  for (const line of lines) {
    expect(displayWidth(line) <= body, `"${line}" is wider than ${String(body)}`).toBe(true)
  }
  return lines
}

async function stripLines(
  $: Engine,
  surface: Surface,
  body: number,
  maxRows = 10,
): Promise<string[]> {
  const ui = await mountStrip($, surface, body, maxRows)
  const lines = await stripOn(ui, body)
  await ui.unmount()
  return lines
}

const KEEP_DONE_CRITERION =
  'When an agent ends done with an answer, the band shows its masked first answer line until the person sends the next prompt.'
const KEEP_FAILED_CRITERION =
  'When an agent ends failed, the band shows its failed row until the person opens the board or runs /board.'

const KEPT_75 = [
  'Agents  2 · no open task                                          [ board ]',
  '■ lane-b    failed    after Bash npm run build                     open  4m',
  '✓ Plan      done      Found 3 callers of drawBand; .npmrc holds t… open 30s',
] as const
const KEPT_35 = [
  'Agents 2 · no open task   [ board ]',
  '■ lane-b    failed after Bash… open',
  '✓ Plan      done Found 3 call… open',
] as const
const ONE_AGENT_HEAD_75 =
  'Agents  1 · no open task                                          [ board ]'
const ONE_AGENT_HEAD_35 = 'Agents 1 · no open task   [ board ]'

async function keepScene($: Engine, on: On, surface: Surface) {
  const seen = world(on)
  engineRows(on)
  await startOn($, surface)
  await seen.clock.set(START)
  await spawnFrom($, LANE)
  seen.agents.push(runningAgent(LANE, 'lane-b'))
  await $.tool.call({ tool: 'Bash', command: 'npm run build', agentId: LANE })
  await seen.clock.advance(4 * MINUTE)
  seen.agents.splice(0, 1, { ...runningAgent(LANE, 'lane-b'), status: 'failed' })
  await agentEnds($, LANE, '', 4 * MINUTE)
  await spawnFrom($, STRIP_PLAN)
  seen.agents.push(runningAgent(STRIP_PLAN, 'Plan'))
  await seen.clock.advance(30_000)
  seen.agents.splice(1, 1, { ...runningAgent(STRIP_PLAN, 'Plan'), status: 'completed' })
  await agentEnds($, STRIP_PLAN, STRIP_ANSWER, 30_000)
  expect([await stripLines($, surface, 75), await stripLines($, surface, 35)]).toEqual([
    KEPT_75,
    KEPT_35,
  ])
  return { seen }
}

async function personPrompt($: Engine): Promise<void> {
  await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
}

const STRIP_SCREENS: readonly { body: number; lines: readonly string[] }[] = [
  {
    body: 115,
    lines: [
      'Agents  6 · no open task                                                                                  [ board ]',
      '◆ scout     needs you waits for: permission · Bash npm test                                        ctx 31k open  1m',
      '■ lane-b    failed    after Bash npm run build                                                     ctx —   open  4m',
      '✓ Plan      done      Found 3 callers of drawBand; .npmrc holds token=*** and the CI file reads it ctx 22k open 30s',
      '[ +3 more agents · 3 running ]',
    ],
  },
  {
    body: 75,
    lines: [
      'Agents  6 · no open task                                          [ board ]',
      '◆ scout     needs you waits for: permission · Bash npm test        open  1m',
      '■ lane-b    failed    after Bash npm run build                     open  4m',
      '✓ Plan      done      Found 3 callers of drawBand; .npmrc holds t… open 30s',
      '[ +3 more agents · 3 running ]',
    ],
  },
  {
    body: 35,
    lines: [
      'Agents 6 · no open task   [ board ]',
      '◆ scout     needs you Bash np… open',
      '■ lane-b    failed after Bash… open',
      '✓ Plan      done Found 3 call… open',
      '[ +3 more · 3 running ]',
    ],
  },
]

for (const surface of SURFACES) {
  describe(STRIP_CRITERION, () => {
    test(
      `needs you, failed and done rows come first with their word, detail and open, and the fold names the running rest, at body 115, 75 and 35, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { dialog, call } = await stripScene($, on, surface)
        const screens = []
        for (const { body } of STRIP_SCREENS) screens.push(await stripLines($, surface, body))
        expect(screens).toEqual(STRIP_SCREENS.map(({ lines }) => lines))
        const ui = await mountStrip($, surface, 75)
        for (const id of [SCOUT, LANE, STRIP_PLAN]) {
          const open = await ui.find({ key: `band-open:${id}` })
          expect(open?.text).toBe('open')
          expect(open?.props.hotkey).toBeUndefined()
        }
        const fold = await ui.find({ key: 'band-agents-more' })
        expect(fold?.props.hotkey).toBeUndefined()
        const state = drawnOf(await ui.find({ key: `band-agent:${SCOUT}` }))
        const [mark, name, word] = state === null ? [] : texts(state)
        expect([mark?.text, mark?.props.color, name?.props.bold, word?.props.color]).toEqual([
          '◆ ',
          'warning',
          true,
          'warning',
        ])
        await ui.unmount()
        dialog.allow()
        await call
      },
    )

    test(
      `running rows show the stall words, the plan step and the tool from body 100, under a stalled task, and open runs /tasks, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        engineRows(on)
        const runs = tasksRuns(on)
        await startOn($, surface)
        await bandFour($, seen)
        await seen.clock.set(START + 11 * MINUTE)
        await spawnFrom($, STRIP_TESTER)
        seen.agents.push(runningAgent(STRIP_TESTER, 'tester'))
        await seen.clock.set(START + 13 * MINUTE)
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/app.ts`, agentId: STRIP_TESTER })
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        for (const title of STRIP_GATE_TITLES) {
          await $.tool.call({ tool: TOOL_ADD, title, agentId: EXPLORE })
        }
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed', agentId: EXPLORE })
        await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'completed', agentId: EXPLORE })
        await $.tool.call({ tool: TOOL_UPDATE, id: 3, status: 'completed', agentId: EXPLORE })
        await $.tool.call({ tool: TOOL_UPDATE, id: 4, status: 'in_progress', agentId: EXPLORE })
        await seen.clock.set(START + 16 * MINUTE - 45_000)
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.set(START + 16 * MINUTE - 9_000)
        await spawnFrom($, STRIP_IMPLEMENTER)
        seen.agents.push(runningAgent(STRIP_IMPLEMENTER, 'implementer'))
        for (const title of ['Edit the band', 'Test the band', 'Write the notes']) {
          await $.tool.call({ tool: TOOL_ADD, title, agentId: STRIP_IMPLEMENTER })
        }
        await $.tool.call({
          tool: TOOL_UPDATE,
          id: 1,
          status: 'in_progress',
          agentId: STRIP_IMPLEMENTER,
        })
        await $.tool.call({
          tool: 'Edit',
          file_path: `${ROOT}/hooks/band.ts`,
          old_string: 'a',
          new_string: 'b',
          agentId: STRIP_IMPLEMENTER,
        })
        await seen.clock.set(START + 16 * MINUTE)
        expect([
          await stripLines($, surface, 115),
          await stripLines($, surface, 75),
          await stripLines($, surface, 35),
        ]).toEqual([
          [
            '▶ 2 Write the tab mocks                                                              stalled 16m ▰▰▱▱ 1/4 [ board ]',
            '▶ tester    quiet 3m  Read src/app.ts                                                              ctx —   open  5m',
            '▶ Explore   slow 45s  ▸ Bash npm run check · step 3/5 Run the gates                                ctx —   open  3m',
            '▶ impl…nter running   0/3 Edit the band · Edit hooks/band.ts                                       ctx —   open  9s',
          ],
          [
            '▶ 2 Write the tab mocks                      stalled 16m ▰▰▱▱ 1/4 [ board ]',
            '▶ tester    quiet 3m  Read src/app.ts                              open  5m',
            '▶ Explore   slow 45s  ▸ Bash npm run check                         open  3m',
            '▶ impl…nter running   0/3 Edit the band                            open  9s',
          ],
          [
            '▶ 2 Writ… stalled 16m 1/4 [ board ]',
            '▶ tester    quiet 3m Read src… open',
            '▶ Explore   slow 45s ▸ Bash n… open',
            '▶ impl…nter running 0/3 Edit…  open',
          ],
        ])
        const ui = await mountStrip($, surface, 75)
        await ui.press({ key: `band-open:${EXPLORE}` })
        await ui.unmount()
        expect(runs).toEqual(['tasks'])
        held.release()
        await call
      },
    )

    test(
      `open on a failed or a done row opens the board with that agent row open, and the fold opens the board, on ${surface}`,
      withStripExpanded,
      async ($, on) => {
        const { seen, dialog, call } = await stripScene($, on, surface)
        const ui = await mountStrip($, surface, 75)
        await ui.press({ key: `band-open:${STRIP_PLAN}` })
        expect(await expandedState($)).toEqual([`agent:${STRIP_PLAN}`, 'group:ended-agents'])
        expect(seen.opens.filter((open) => open.id === PANE)).toEqual([SESSION_OPEN_FOCUS])
        await ui.unmount()
        expect(await board($, 'close')).toBe('Board closed.')
        const again = await mountStrip($, surface, 75)
        await again.press({ key: `band-open:${LANE}` })
        expect(await expandedState($)).toEqual([
          `agent:${STRIP_PLAN}`,
          'group:ended-agents',
          `agent:${LANE}`,
        ])
        await again.unmount()
        const pane = await mountTab($, surface, PANE, 'dock', 80)
        const shown = unframed(await screen(pane, 80))
        await pane.unmount()
        expect(lineWith(shown, 'answer: Found 3 callers of drawBand')).toBeDefined()
        expect(lineWith(shown, 'answer: none, the run failed')).toBeDefined()
        expect(await board($, 'close')).toBe('Board closed.')
        const fold = await mountStrip($, surface, 75)
        await fold.press({ key: 'band-agents-more' })
        await fold.unmount()
        expect(seen.opens.filter((open) => open.id === PANE)).toEqual([
          SESSION_OPEN_FOCUS,
          SESSION_OPEN_FOCUS,
          SESSION_OPEN_FOCUS,
        ])
        dialog.allow()
        await call
      },
    )

    test(
      `a short band drops running rows first and never a needs you row, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { dialog, call } = await stripScene($, on, surface)
        expect([
          await stripLines($, surface, 75, 3),
          await stripLines($, surface, 75, 4),
          await stripLines($, surface, 35, 2),
        ]).toEqual([
          [
            'Agents  6 · no open task                                          [ board ]',
            '◆ scout     needs you waits for: permission · Bash npm test        open  1m',
            '[ +5 more agents · 1 failed · 1 done · 3 running ]',
          ],
          [
            'Agents  6 · no open task                                          [ board ]',
            '◆ scout     needs you waits for: permission · Bash npm test        open  1m',
            '■ lane-b    failed    after Bash npm run build                     open  4m',
            '[ +4 more agents · 1 done · 3 running ]',
          ],
          [
            'Agents 6 · no open task   [ board ]',
            '◆ scout     needs you Bash np… open',
            '[ +5 more · 1 failed · 1 done ]',
          ],
        ])
        dialog.allow()
        await call
      },
    )
  })

  describe(STRIP_NO_TASK_CRITERION, () => {
    test(
      `with no open task the head reads Agents and the count and keeps the board button, and an open task takes the head over the same rows, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen, dialog, call } = await stripScene($, on, surface)
        const before = await stripLines($, surface, 75)
        await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress' })
        const after = await stripLines($, surface, 75)
        const narrow = await stripLines($, surface, 35)
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
        const ended = await stripLines($, surface, 35)
        expect([before[0], after[0], narrow[0], ended[0]]).toEqual([
          'Agents  6 · no open task                                          [ board ]',
          '▶ 1 Write the tab mocks                                  0s ▰ 0/1 [ board ]',
          '▶ 1 Write the tab… 0s 0/1 [ board ]',
          'Agents 6 · no open task   [ board ]',
        ])
        expect(after.slice(1)).toEqual(before.slice(1))
        const ui = await mountStrip($, surface, 75)
        await ui.press({ key: 'band-board' })
        await ui.unmount()
        expect(seen.opens[0]).toEqual(SESSION_OPEN_FOCUS)
        dialog.allow()
        await call
      },
    )

    test(
      `no head and no rows show after the next prompt once only ended done agents are left and the engine no longer lists them, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, STRIP_PLAN)
        seen.agents.push(runningAgent(STRIP_PLAN, 'Plan'))
        await seen.clock.advance(30_000)
        seen.agents.splice(0, 1, { ...runningAgent(STRIP_PLAN, 'Plan'), status: 'completed' })
        await agentEnds($, STRIP_PLAN, '', 30_000)
        const done = [
          'Agents  1 · no open task                                          [ board ]',
          '✓ Plan      done      no answer                                    open 30s',
        ]
        expect(await stripLines($, surface, 75)).toEqual(done)
        seen.agents.splice(0, 1)
        expect(await stripLines($, surface, 75)).toEqual(done)
        await personPrompt($)
        const ui = await mountBand($, surface)
        expect(await ui.find({ key: 'band' })).toBeUndefined()
        expectEngineRow(await ui.drawn())
        await ui.unmount()
      },
    )
  })

  describe(KEEP_DONE_CRITERION, () => {
    test(
      `a done row keeps its masked answer line after the engine no longer lists its agent, at body 75 and 35, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen } = await keepScene($, on, surface)
        seen.agents.splice(0, seen.agents.length)
        expect([await stripLines($, surface, 75), await stripLines($, surface, 35)]).toEqual([
          KEPT_75,
          KEPT_35,
        ])
      },
    )

    test(
      `a done row leaves the band at the next prompt while the engine still lists its agent, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        await keepScene($, on, surface)
        await personPrompt($)
        expect([await stripLines($, surface, 75), await stripLines($, surface, 35)]).toEqual([
          [ONE_AGENT_HEAD_75, KEPT_75[1]],
          [ONE_AGENT_HEAD_35, KEPT_35[1]],
        ])
      },
    )

    test(
      `a done row of an agent that ended before the last prompt does not show, and an answer that comes after the prompt shows, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen } = await keepScene($, on, surface)
        await personPrompt($)
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await seen.clock.advance(MINUTE)
        seen.agents.splice(2, 1, { ...runningAgent(EXPLORE, 'Explore'), status: 'completed' })
        await agentEnds($, EXPLORE, 'Read 4 files and found no caller', MINUTE)
        expect(await stripLines($, surface, 75)).toEqual([
          'Agents  2 · no open task                                          [ board ]',
          KEPT_75[1],
          '✓ Explore   done      Read 4 files and found no caller             open  1m',
        ])
      },
    )

    test(
      `an agent that runs again after the prompt and ends shows its new answer line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen } = await keepScene($, on, surface)
        await personPrompt($)
        seen.agents.splice(1, 1, runningAgent(STRIP_PLAN, 'Plan'))
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/hooks/band.ts`, agentId: STRIP_PLAN })
        expect((await stripLines($, surface, 75)).slice(1)).toEqual([
          KEPT_75[1],
          '▶ Plan      running   Read hooks/band.ts                           open 30s',
        ])
        seen.agents.splice(1, 1, { ...runningAgent(STRIP_PLAN, 'Plan'), status: 'completed' })
        await agentEnds($, STRIP_PLAN, 'Found 4 callers', 30_000)
        seen.agents.splice(0, seen.agents.length)
        expect((await stripLines($, surface, 75)).slice(1)).toEqual([
          KEPT_75[1],
          '✓ Plan      done      Found 4 callers                              open 30s',
        ])
      },
    )

    test(
      `an agent that the engine stops listing before it ends, with no call in flight, shows no row, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, STRIP_PLAN)
        seen.agents.push(runningAgent(STRIP_PLAN, 'Plan'))
        await seen.clock.advance(30_000)
        expect(await stripLines($, surface, 75)).toEqual([
          'Agents  1 · no open task                                          [ board ]',
          '▶ Plan      running                                                open 30s',
        ])
        seen.agents.splice(0, 1)
        const ui = await mountBand($, surface)
        expect(await ui.find({ key: 'band' })).toBeUndefined()
        expectEngineRow(await ui.drawn())
        await ui.unmount()
      },
    )
  })

  describe(KEEP_FAILED_CRITERION, () => {
    test(
      `a failed row stays after the next prompt and after the engine no longer lists its agent, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen } = await keepScene($, on, surface)
        await personPrompt($)
        seen.agents.splice(0, seen.agents.length)
        await personPrompt($)
        expect([await stripLines($, surface, 75), await stripLines($, surface, 35)]).toEqual([
          [ONE_AGENT_HEAD_75, KEPT_75[1]],
          [ONE_AGENT_HEAD_35, KEPT_35[1]],
        ])
      },
    )

    test(
      `a failed row leaves the band once the board opens from the band and the this session tab shows, the tab draw writes no state, a later failure stays, and the done row stays, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const agentWrites: unknown[] = []
        on('state.set', { plugin: PLUGIN, key: 'agents' }, (_$, e, next) => {
          agentWrites.push(e.value)
          return next(e)
        })
        const { seen } = await keepScene($, on, surface)
        seen.agents.splice(0, seen.agents.length)
        const band = await mountStrip($, surface, 75)
        await band.press({ key: 'band-board' })
        await band.unmount()
        expect(await board($, 'close')).toBe('Board closed.')
        expect(await stripLines($, surface, 75)).toEqual(KEPT_75)
        const again = await mountStrip($, surface, 75)
        await again.press({ key: 'band-board' })
        await again.unmount()
        const written = agentWrites.length
        const pane = await mountTab($, surface, PANE, 'dock', 80)
        await seen.clock.settle()
        expect(agentWrites.length).toBe(written)
        await pane.unmount()
        await spawnFrom($, STRIP_TESTER)
        seen.agents.push({ ...runningAgent(STRIP_TESTER, 'tester'), status: 'failed' })
        await agentEnds($, STRIP_TESTER, '', 1_000)
        expect(await board($, 'close')).toBe('Board closed.')
        const lines = await stripLines($, surface, 75)
        expect(lines.some((line) => line.includes('lane-b'))).toBe(false)
        expect(lines.some((line) => line.includes('tester') && line.includes('failed'))).toBe(true)
        expect(lines).toContain(KEPT_75[2])
        expect(seen.logs.filter((line) => line.includes('state.set: denied'))).toEqual([])
      },
    )

    test(
      `a failed row leaves the band when the person runs /board, and the done row stays, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen } = await keepScene($, on, surface)
        seen.agents.splice(0, seen.agents.length)
        expect(await board($, '')).toBe('Board opened: this session.')
        expect(await board($, 'close')).toBe('Board closed.')
        expect([await stripLines($, surface, 75), await stripLines($, surface, 35)]).toEqual([
          [ONE_AGENT_HEAD_75, KEPT_75[2]],
          [ONE_AGENT_HEAD_35, KEPT_35[2]],
        ])
      },
    )
  })

  describe(STRIP_WIDTH_CRITERION, () => {
    test(
      `the ctx column shows from body 100 only, and a not listed agent and a ctx of 128k still fit the body, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        engineRows(on)
        const steps = stepWorld(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await step(
          $,
          steps,
          EXPLORE,
          stepped('turn-e', { fresh: 2_000, written: 6_000, read: 120_000, output: 900 }, null),
        )
        const ghost = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: STRIP_GHOST })
        await seen.clock.advance(MINUTE)
        for (const body of [115, 100]) {
          const lines = await stripLines($, surface, body)
          expect(lines.slice(1).every((line) => line.includes(' ctx '))).toBe(true)
        }
        for (const body of [99, 75, 35]) {
          const lines = await stripLines($, surface, body)
          expect(lines.some((line) => line.includes('ctx'))).toBe(false)
        }
        expect([
          await stripLines($, surface, 115),
          await stripLines($, surface, 75),
          await stripLines($, surface, 35),
        ]).toEqual([
          [
            'Agents  2 · no open task                                                                                  [ board ]',
            '▶ Explore   running                                                                               ctx 128k open  1m',
            '? a0000009  not listed ▸ Bash npm run check                                                        ctx —   open  1m',
          ],
          [
            'Agents  2 · no open task                                          [ board ]',
            '▶ Explore   running                                                open  1m',
            '? a0000009  not listed ▸ Bash npm run check                        open  1m',
          ],
          [
            'Agents 2 · no open task   [ board ]',
            '▶ Explore   running            open',
            '? a0000009  not listed ▸ Bash… open',
          ],
        ])
        held.release()
        await ghost
      },
    )

    test(
      `a name, a target, an answer and a plan step from an agent reach the band escaped, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, LANE)
        seen.agents.push({ ...runningAgent(LANE, 'lane\u202Eb'), status: 'running' })
        await $.tool.call({ tool: 'Bash', command: 'echo \u001B[31mred', agentId: LANE })
        seen.agents.splice(0, 1, { ...runningAgent(LANE, 'lane\u202Eb'), status: 'failed' })
        await agentEnds($, LANE, '', MINUTE)
        await spawnFrom($, STRIP_PLAN)
        seen.agents.push(runningAgent(STRIP_PLAN, 'Plan'))
        seen.agents.splice(1, 1, { ...runningAgent(STRIP_PLAN, 'Plan'), status: 'completed' })
        await agentEnds($, STRIP_PLAN, 'read \u2066gpj.exe\u2069 now', MINUTE)
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await $.tool.call({ tool: TOOL_ADD, title: 'Draw the plan', agentId: EXPLORE })
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress', agentId: EXPLORE })
        await $.tool.call({
          tool: 'Read',
          file_path: `${ROOT}/src/a\u200Fb.ts`,
          agentId: EXPLORE,
        })
        const lines = await stripLines($, surface, 115)
        expect([lines, await stripLines($, surface, 35)]).toEqual([
          [
            'Agents  3 · no open task                                                                                  [ board ]',
            '■ lane…02eb failed    after Bash echo \\u001b[31mred                                                ctx —   open  0s',
            '✓ Plan      done      read \\u2066gpj.exe\\u2069 now                                                 ctx —   open  0s',
            '▶ Explore   running   0/1 Draw the plan · Read src/a\\u200fb.ts                                     ctx —   open  0s',
          ],
          [
            'Agents 3 · no open task   [ board ]',
            '■ lane…02eb failed after Bash… open',
            '✓ Plan      done read \\u2066g… open',
            '▶ Explore   running 0/1 Draw…  open',
          ],
        ])
        expect(lines.join(' ')).not.toMatch(/[\p{Cc}\u202A-\u202E\u2066-\u2069\u200F]/u)
      },
    )
  })

  describe(STRIP_REDRAW_CRITERION, () => {
    test(
      `a new tool and a later time wait for the 10 s tick, and a change of state draws at once, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
        const ui = await mountStrip($, surface, 115)
        const first = await stripOn(ui, 115)
        await seen.clock.advance(5_000)
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/b.ts`, agentId: EXPLORE })
        await seen.clock.advance(4_000)
        const held = await stripOn(ui, 115)
        await seen.clock.advance(1_000)
        const ticked = await stripOn(ui, 115)
        await seen.clock.advance(2_000)
        seen.agents.splice(0, 1, { ...runningAgent(EXPLORE, 'Explore'), status: 'completed' })
        await agentEnds($, EXPLORE, 'Found the table', 12_000)
        const ended = await stripOn(ui, 115)
        expect([first, held, ticked, ended]).toEqual([
          [
            'Agents  1 · no open task                                                                                  [ board ]',
            '▶ Explore   running   Read src/a.ts                                                                ctx —   open  0s',
          ],
          [
            'Agents  1 · no open task                                                                                  [ board ]',
            '▶ Explore   running   Read src/a.ts                                                                ctx —   open  0s',
          ],
          [
            'Agents  1 · no open task                                                                                  [ board ]',
            '▶ Explore   running   Read src/b.ts                                                                ctx —   open 10s',
          ],
          [
            'Agents  1 · no open task                                                                                  [ board ]',
            '✓ Explore   done      Found the table                                                              ctx —   open 12s',
          ],
        ])
        await ui.unmount()
      },
    )

    test(
      `a stall word that comes or goes draws at once, before the tick, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        engineRows(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
        const ui = await mountStrip($, surface, 75)
        await seen.clock.advance(5_000)
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.advance(31_000)
        const slow = (await stripLines($, surface, 75))[1]
        await seen.clock.advance(6_000)
        held.release()
        await call
        const running = (await stripLines($, surface, 75))[1]
        await ui.unmount()
        expect([slow?.slice(0, 22), running?.slice(0, 22)]).toEqual([
          '▶ Explore   slow 31s  ',
          '▶ Explore   running   ',
        ])
      },
    )
  })
}

test('the board refuses a band setting it does not know, by name', () => {
  expect(bandSetting({})).toBe('on')
  expect(bandSetting({ band: 'off' })).toBe('off')
  expect(() => bandSetting({ band: 'sometimes' })).toThrow(
    'handily-board: userConfig band is "sometimes"; set it to on or off in /config.',
  )
})

describe('review repairs of the tasks for you (handily-9uj3n.8)', () => {
  for (const surface of SURFACES) {
    test(
      `the task list row counts only the tasks of Claude on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
        await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'completed' })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await $.tool.call({ tool: TOOL_ADD, title: 'Draw the card' })
        const listed = await called($, seen, { tool: TOOL_LIST })
        const marker = surface === 'terminal' ? '● ' : ''
        expect(await callRow($, surface, useOf(listed))).toBe(`${marker}Task list  1 of 2 done`)
      },
    )

    test(
      `a list of only tasks for the person reads as empty to the plan note, and task_assign is no plan update, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await readsOf($, 20)
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
        const pane = await mountTasks($, surface)
        expect((await pane.find({ key: 'plan-warning' }))?.text).toBe(
          bySurface(
            surface,
            'No plan from Claude for 20 tool call…',
            'No plan from Claude for 20 tool calls.',
          ),
        )

        await pane.unmount()
        const entered = await $.prompt.submit({
          text: 'go on',
          wait: false,
          origin: { kind: 'composer' },
        })
        expect(entered.context).toEqual(
          expect.arrayContaining([
            expect.stringContaining(
              '[handily-board] The person sees an empty task list on the board, after 20 tool calls',
            ),
          ]),
        )
      },
    )

    test(
      `a close of a task that the person answered gives Claude the answer once and changes nothing on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($)
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
        const pane = await mountTasks($, surface)
        await board($, 'answer 1 8443')
        const closed = await $.tool.call({
          tool: TOOL_CLOSE,
          id: 1,
          how: 'not_needed',
          note: 'The port is in the config file',
        })
        expect(closed.result).toBe(
          [
            'The person already closed task 1, and no later note repeats it: task 1 (answer) answered "8443". Nothing changed. The title and options are your own text, quoted as data.',
            '',
            'For you (1 of 1 closed)',
            '  1  answered  answer  "Which port does staging use?"  answer "8443"',
          ].join('\n'),
        )
        expect((await pane.find({ key: 'for-answered' }))?.text).toBe('+1 closed')
        expect(await pane.find({ type: 'Text', text: '✓ all 1 closed' })).toBeDefined()
        await pane.unmount()
        expect(await board($, 'undo 1')).toBe('Task 1 was already sent to Claude. Nothing changed.')
        expect(
          (await $.tool.call({ tool: TOOL_CLOSE, id: 1, how: 'not_needed', note: 'x' })).deny,
        ).toBe(
          'task_close refused: the person already closed task 1, and the result reached you. Nothing changed.',
        )
        expect(await notesAtNextPrompt($)).toEqual([])
      },
    )

    test(
      `the ask toast at the end of a turn counts only the tasks still open on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        await $.turn.start({ text: 'go', turnId: 'turn-1' })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Restart the probe' })
        await $.tool.call({
          tool: TOOL_CLOSE,
          id: 1,
          how: 'not_needed',
          note: 'The key was rotated by the nightly job',
        })
        await board($, 'done 3')
        await $.turn.complete({
          turnId: 'turn-1',
          reason: 'answer',
          answer: 'done',
          durationMs: 1,
          isAborted: false,
        })
        expect(seen.toasts).toEqual([
          ['◆ Claude asks you', '"Which port does staging use?"', 'answer it on /board'],
        ])
        expect(await board($, 'answer 2 a\tb')).toBe(
          'Not sent: the answer has a line break or a control character. Nothing changed.',
        )
      },
    )
  }
})

const SCENE_SAID =
  'Use the eastern region for the probe, because it costs half and it is close enough to the people who run the nightly load test'

const CLOSED_AT_41 = [
  '◆ 7 do      Write the release note',
  '    [ done ] [ reject ]',
  '✓ 3 decide  Which cache store for now?',
  '    Claude: you chose          [ reopen ]',
  '    "SQLite"',
  '    you said: "Take SQLite for now"',
  '✓ 4 do      Delete the old bucket',
  '    Claude: not needed         [ reopen ]',
  '    The cleanup job deleted it last night',
  '✓ 5 do      Restart the probe',
  '    Claude did it              [ reopen ]',
  '    Restarted it with the deploy script',
  '    after the config change',
  '✓ 6 answer  Which region for the probe?',
  '    Claude: you answered       [ reopen ]',
  '    "eastern"',
  '    you said: "Use the eastern region for',
  '    the probe, because it costs half and',
  '    it is close enough to the people who',
  '    run the nightly load test"',
  '✓ 1 do      Rotate the staging API key',
  '    you: done · to send          [ undo ]',
  '✓ 2 answer  Which port does staging use?',
  '    you answered · to send       [ undo ]',
  '    "8443"',
  '■ 8 do      Delete the old logs',
  '    you rejected · to send       [ undo ]',
  '    "not my call"',
  'Claude gets them with your next prompt.',
]

const CLOSED_AT_30 = [
  '◆ 7 do     Write the release',
  '           note',
  '    [ done ] [ reject ]',
  '✓ 3 decide Which cache store',
  '           for now?',
  '    Claude: you chose',
  '    [ reopen ]',
  '    "SQLite"',
  '    you said: "Take SQLite for',
  '    now"',
  '✓ 4 do     Delete the old',
  '           bucket',
  '    Claude: not needed',
  '    [ reopen ]',
  '    The cleanup job deleted it',
  '    last night',
  '✓ 5 do     Restart the probe',
  '    Claude did it   [ reopen ]',
  '    Restarted it with the',
  '    deploy script after the',
  '    config change',
  '✓ 6 answer Which region for',
  '           the probe?',
  '    Claude: you answered',
  '    [ reopen ]',
  '    "eastern"',
  '    you said: "Use the eastern',
  '    region for the probe,',
  '    because it costs half and',
  '    it is close enough to the',
  '    people who run the nightly',
  '    load test"',
  '✓ 1 do     Rotate the staging',
  '           API key',
  '    you: done · to send',
  '    [ undo ]',
  '✓ 2 answer Which port does',
  '           staging use?',
  '    you answered · to send',
  '    [ undo ]',
  '    "8443"',
  '■ 8 do     Delete the old logs',
  '    you rejected · to send',
  '    [ undo ]',
  '    "not my call"',
  'Claude gets them with your',
  'next prompt.',
]

async function personSays($: Engine, text: string): Promise<readonly string[]> {
  const entered = await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
  return entered.context ?? []
}

async function closeTaskCall($: Engine, input: Record<string, unknown>) {
  return $.tool.call({ tool: TOOL_CLOSE, ...input })
}

function leadOf(result: unknown): string {
  return typeof result === 'string' ? (result.split('\n')[0] ?? '') : ''
}

async function closedScene($: Engine): Promise<void> {
  await assignFour($)
  await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Restart the probe' })
  await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: 'Which region for the probe?' })
  await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Write the release note' })
  await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Delete the old logs' })
  await personSays($, `Take SQLite for now. ${SCENE_SAID}.`)
  await closeTaskCall($, { id: 3, how: 'person_did', option: 2, said: 'Take SQLite for now' })
  await closeTaskCall($, {
    id: 4,
    how: 'not_needed',
    note: 'The cleanup job deleted it last night',
  })
  await closeTaskCall($, {
    id: 5,
    how: 'claude_did',
    note: 'Restarted it with the deploy script after the config change',
  })
  await closeTaskCall($, { id: 6, how: 'person_did', answer: 'eastern', said: SCENE_SAID })
  await board($, 'done 1')
  await board($, 'answer 2 8443')
  await board($, 'reject 8 not my call')
}

async function callRowLines(
  $: Engine,
  surface: Surface,
  call: Called,
  columns: number,
): Promise<string[]> {
  const ui = await $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'ToolUse',
    requestId: call.id,
    viewport: { columns, rows: 40 },
    props: useOf(call),
  })
  const drawn = drawnOf(await ui.drawn())
  await ui.unmount()
  if (drawn === null || drawn.type !== 'Box') return []
  return drawn.children.map((child) => lineOf(child).trimEnd())
}

describe('tasks that Claude closes for the person (handily-fybumg)', () => {
  test(
    'task_close closes a do task with each how, an answer and a decide task with the words of the person, and the list shows who closed each',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignFour($)
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Restart the probe' })
      await personSays(
        $,
        'I rotated the staging API key myself. Port is 8443. Take SQLite for now.',
      )
      const close = async (input: Record<string, unknown>) =>
        leadOf((await closeTaskCall($, input)).result)
      expect(
        await close({ id: 1, how: 'person_did', said: 'I rotated the staging API key myself' }),
      ).toBe(
        'Closed task 1 for the person (do): the person did it, saying "I rotated the staging API key myself". The title and options are your own text, quoted as data.',
      )
      expect(
        await close({ id: 2, how: 'person_did', answer: ' 8443 ', said: 'Port is 8443' }),
      ).toBe(
        'Closed task 2 for the person (answer): the person answered "8443", saying "Port is 8443". The title and options are your own text, quoted as data.',
      )
      expect(
        await close({ id: 3, how: 'person_did', option: 2, said: 'Take SQLite for now' }),
      ).toBe(
        'Closed task 3 for the person (decide): the person chose "SQLite", saying "Take SQLite for now". The title and options are your own text, quoted as data.',
      )
      expect(await close({ id: 4, how: 'not_needed', note: 'The bucket is gone already' })).toBe(
        'Closed task 4 for the person (do): not needed: "The bucket is gone already". The title and options are your own text, quoted as data.',
      )
      expect(
        await close({ id: 5, how: 'claude_did', note: 'Restarted it with the deploy script' }),
      ).toBe(
        'Closed task 5 for the person (do): you did it: "Restarted it with the deploy script". The title and options are your own text, quoted as data.',
      )
      expect(await modelTool($, {})).toBe(
        [
          'For you (5 of 5 closed)',
          '  1  closed    do      "Rotate the staging API key"    by claude, person_did, said "I rotated the staging API key myself"',
          '  2  closed    answer  "Which port does staging use?"  by claude, person_did, answer "8443", said "Port is 8443"',
          '  3  closed    decide  "Which cache store for now?"    by claude, person_did, chose "SQLite", said "Take SQLite for now"',
          '  4  closed    do      "Delete the old bucket"         by claude, not_needed, note "The bucket is gone already"',
          '  5  closed    do      "Restart the probe"             by claude, claude_did, note "Restarted it with the deploy script"',
        ].join('\n'),
      )
      expect(await notesAtNextPrompt($)).toEqual([])
    },
  )

  test(
    'task_close refuses each wrong close by name and changes nothing',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignFour($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
      const deny = async (input: Record<string, unknown>) => (await closeTaskCall($, input)).deny
      expect(await deny({ id: 1, how: 'claude_did', note: 'Rotated', agentId: 'agent-1' })).toBe(
        'task_close works only in the main loop; tell the main agent what the person did.',
      )
      expect(await deny({ how: 'claude_did', note: 'Rotated' })).toBe(
        'task_close needs id: the integer id of a task for the person that task_list shows.',
      )
      expect(await deny({ id: 99, how: 'claude_did', note: 'Rotated' })).toBe(
        'No task 99 for the person. The tasks for the person are 1-4. Call task_list to see them.',
      )
      expect(await deny({ id: 5, how: 'claude_did', note: 'Wrote them' })).toBe(
        'Task 5 is your own task. Set its status with task_update.',
      )
      for (const how of [undefined, 'done']) {
        expect(await deny({ id: 1, how, note: 'Rotated' })).toBe(
          'task_close needs how: one of claude_did, person_did, not_needed.',
        )
      }
      expect(await deny({ id: 3, how: 'claude_did', note: 'Picked SQLite' })).toBe(
        'task_close refused: task 3 asks the person to decide. You cannot decide it: close it with how person_did and the option the person named, or with not_needed.',
      )
      expect(await deny({ id: 2, how: 'claude_did', note: 'It is 8443' })).toBe(
        'task_close refused: task 2 asks the person for an answer. You cannot answer it: close it with how person_did, the answer and said, or with not_needed and the answer in note.',
      )
      expect(await deny({ id: 1, how: 'claude_did' })).toBe(
        'task_close needs note for how claude_did: one line of at most 200 characters that says what you did.',
      )
      expect(await deny({ id: 1, how: 'not_needed', note: '  ' })).toBe(
        'task_close needs note for how not_needed: one line of at most 200 characters that says why the task is no longer needed.',
      )
      for (const said of [undefined, '  ']) {
        expect(await deny({ id: 1, how: 'person_did', said })).toBe(
          'task_close needs said for how person_did: the words of the person from their prompt, copied exactly, as one line of at most 200 characters.',
        )
      }
      expect(await deny({ id: 2, how: 'person_did', said: 'It is 8443' })).toBe(
        'task_close needs answer for task 2: the answer of the person as one line of at most 1000 characters.',
      )
      for (const option of [undefined, 4, 1.5]) {
        expect(await deny({ id: 3, how: 'person_did', said: 'SQLite', option })).toBe(
          'task_close needs option for task 3: the number of the option that the person chose, 1 to 3: 1 "Postgres", 2 "SQLite", 3 "Redis".',
        )
      }
      expect(await deny({ id: 1, how: 'person_did', said: 'done', answer: 'yes' })).toBe(
        'task_close takes answer only for a task of the kind answer; task 1 has the kind do.',
      )
      expect(await deny({ id: 2, how: 'person_did', said: '8443', option: 1 })).toBe(
        'task_close takes option only for a task of the kind decide; task 2 has the kind answer.',
      )
      expect(await deny({ id: 2, how: 'not_needed', note: 'In the config', answer: '8443' })).toBe(
        'task_close takes answer and option only with how person_did.',
      )
      expect(await deny({ id: 1, how: 'claude_did', note: 'Rotated', said: 'done' })).toBe(
        'task_close takes said only with how person_did: the words in which the person said that they did it.',
      )
      expect(await deny({ id: 1, how: 'claude_did', note: 'one\ntwo' })).toBe(
        'task_close refused: note has a line break or a control character. Write it on one line.',
      )
      expect(await deny({ id: 1, how: 'person_did', said: 'done \u{202e}' })).toBe(
        'task_close refused: said has a bidi control character, which can reorder the text. Remove it.',
      )
      expect(await deny({ id: 1, how: 'claude_did', note: 'x'.repeat(201) })).toBe(
        'task_close refused: note has 201 characters. The limit is 200.',
      )
      expect(await deny({ id: 1, how: 'person_did', said: 'I rotated it' })).toBe(
        'task_close refused: no prompt of the person since task 1 was asked holds "I rotated it". Copy their words exactly, or ask the person to press done on the board.',
      )
      expect(await modelTool($, {})).toContain('For you (0 of 4 closed)')
      expect(await deny({ id: 4, how: 'not_needed', note: 'The bucket is gone' })).toBeUndefined()
      expect(await deny({ id: 4, how: 'not_needed', note: 'Gone again' })).toBe(
        'task_close refused: task 4 is already closed. You closed it (not_needed). Nothing changed.',
      )
      expect((await $.tool.call({ tool: TOOL_UPDATE, id: 4, status: 'removed' })).deny).toBe(
        'Task 4 for the person is already closed. The person removes closed tasks with /board clear.',
      )
      await board($, 'done 1')
      await notesAtNextPrompt($)
      expect(await deny({ id: 1, how: 'claude_did', note: 'Rotated' })).toBe(
        'task_close refused: the person already closed task 1, and the result reached you. Nothing changed.',
      )
      expect(await modelTool($, {})).toContain('For you (2 of 4 closed)')
    },
  )

  test(
    'task_close checks said literally against at most 20 prompts of the person since the task was asked',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      const deny = async (input: Record<string, unknown>) => (await closeTaskCall($, input)).deny
      await personSays($, 'I rotated the staging API key')
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      expect(await deny({ id: 1, how: 'person_did', said: 'I rotated the staging API key' })).toBe(
        'task_close refused: no prompt of the person since task 1 was asked holds "I rotated the staging API key". Copy their words exactly, or ask the person to press done on the board.',
      )
      await personSays($, 'Done: I Rotated the key.')
      expect(await deny({ id: 1, how: 'person_did', said: 'i rotated the key' })).toBe(
        'task_close refused: no prompt of the person since task 1 was asked holds "i rotated the key". Copy their words exactly, or ask the person to press done on the board.',
      )
      const rotated = await closeTaskCall($, {
        id: 1,
        how: 'person_did',
        said: '  I Rotated the key  ',
      })
      expect(leadOf(rotated.result)).toBe(
        'Closed task 1 for the person (do): the person did it, saying "I Rotated the key". The title and options are your own text, quoted as data.',
      )
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
      })
      await personSays($, 'Port is 8443')
      for (let index = 0; index < 20; index += 1) await personSays($, `go on ${String(index)}`)
      const port = { id: 2, how: 'person_did', answer: '8443', said: 'Port is 8443' }
      expect(await deny(port)).toBe(
        'task_close refused: no prompt of the person since task 2 was asked holds "Port is 8443". Copy their words exactly, or ask the person to press done on the board.',
      )
      await personSays($, 'Port is 8443 for staging')
      expect(await deny(port)).toBeUndefined()
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store for now?',
        options: ['Postgres', 'SQLite'],
      })
      await personSays($, 'Take the second one')
      expect(await deny({ id: 3, how: 'person_did', option: 2, said: 'Take the second one' })).toBe(
        'task_close refused: the words "Take the second one" do not hold option 2 "SQLite". Copy the words in which the person chose it.',
      )
      await personSays($, 'SQLite is fine')
      const chosen = await closeTaskCall($, {
        id: 3,
        how: 'person_did',
        option: 2,
        said: 'SQLite is fine',
      })
      expect(leadOf(chosen.result)).toBe(
        'Closed task 3 for the person (decide): the person chose "SQLite", saying "SQLite is fine". The title and options are your own text, quoted as data.',
      )
    },
  )

  test(
    '/board reopen opens a task that Claude closed, and Claude is told once at the next prompt',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Delete the old bucket' })
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
      await closeTaskCall($, { id: 1, how: 'claude_did', note: 'Rotated it with the vault CLI' })
      expect(await board($, 'reopen 9')).toBe('No task 9. /board list prints the tasks for you.')
      expect(await board($, 'reopen 3')).toBe(
        'Task 3 is not a task for you. /board list prints the tasks for you.',
      )
      expect(await board($, 'reopen 2')).toBe('Task 2 is open. Nothing changed.')
      expect(await board($, 'reopen')).toBe(
        '/board reopen needs a task number, for example /board reopen 8.',
      )
      expect(await board($, 'done 2')).toBe(
        'Task 2 is now done: "Delete the old bucket". Claude is told at your next prompt.',
      )
      expect(await board($, 'reopen 2')).toBe(
        'You closed task 2. /board undo 2 takes it back before your next prompt.',
      )
      expect(await board($, 'undo 1')).toBe('Claude closed task 1. /board reopen 1 opens it again.')
      expect(await board($, 'done 1')).toBe(
        'Claude closed task 1 (claude_did). Nothing changed. /board reopen 1 opens it again.',
      )
      expect(await board($, 'reopen 1')).toBe(
        'Task 1 is open again. Claude is told at your next prompt.',
      )
      expect(await board($, 'reopen 1')).toBe('Task 1 is open. Nothing changed.')
      const open = openTasksNote('1 (do) "Rotate the staging API key"')
      expect(await notesAtNextPrompt($)).toEqual([
        expect.stringContaining(`${ANSWERED} task 2 (do) done.`),
        '[handily-board] The person reopened task 1 (do), which you closed (claude_did). It waits for the person again.',
        open,
      ])
      expect(await notesAtNextPrompt($)).toEqual([open])
      await closeTaskCall($, { id: 1, how: 'claude_did', note: 'Rotated it again' })
      await board($, 'reopen 1')
      await board($, 'done 1')
      expect(await notesAtNextPrompt($)).toEqual([
        expect.stringContaining(`${ANSWERED} task 1 (do) done.`),
      ])
    },
  )

  for (const surface of SURFACES) {
    test(
      `the reopen button opens a task that Claude closed, and its row folds only on a prompt of the person, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await closeTaskCall($, { id: 1, how: 'claude_did', note: 'Rotated it with the vault CLI' })
        const pane = await mountTasks($, surface)
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            'For you  ✓ all 1 closed',
            '✓ 1 do      Rotate the staging API key',
            `${'    Claude did it'.padEnd(30)} [ reopen ]`,
            '    Rotated it with the vault CLI',
          ]),
        )
        await pane.unmount()
        await $.prompt.submit({
          text: 'Answer to task 9',
          wait: false,
          origin: { kind: 'plugin', name: PLUGIN, asUser: true },
        })
        const kept = await mountTasks($, surface)
        expect(await kept.find({ key: 'row:for:1' })).toBeDefined()
        await kept.unmount()
        await personSays($, 'go on')
        const folded = await mountTasks($, surface)
        expect(await folded.find({ key: 'row:for:1' })).toBeUndefined()
        expect((await folded.find({ key: 'for-answered' }))?.text).toBe('+1 closed')
        await folded.press({ key: 'for-answered' })
        await folded.press({ key: 'for-reopen:1' })
        expect(await folded.find({ key: 'for-done:1' })).toBeDefined()
        expect(await folded.find({ key: 'for-reopen:1' })).toBeUndefined()
        expect(seen.toasts).toEqual([])
        await folded.unmount()
        expect(await board($, 'list')).toContain(
          '  1  open      do      "Rotate the staging API key"',
        )
      },
    )
  }

  test(
    'a person prompt names at most 5 open tasks for the person, and a prompt of the board or with no open task names none',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      for (let index = 1; index <= 7; index += 1) {
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: `Step ${String(index)}` })
      }
      const openNotes = (context: readonly string[]) =>
        context.filter((text) => text.startsWith(OPEN_LINE))
      expect(openNotes(await personSays($, 'go on'))).toEqual([
        openTasksNote(
          '1 (do) "Step 1"; 2 (do) "Step 2"; 3 (do) "Step 3"; 4 (do) "Step 4"; 5 (do) "Step 5"; 2 more in task_list',
        ),
      ])
      const fromBoard = await $.prompt.submit({
        text: 'Answer to task 1',
        wait: false,
        origin: { kind: 'plugin', name: PLUGIN, asUser: true },
      })
      expect(openNotes(fromBoard.context ?? [])).toEqual([])
      for (let id = 1; id <= 7; id += 1) {
        await closeTaskCall($, { id, how: 'not_needed', note: 'The plan changed' })
      }
      expect(openNotes(await personSays($, 'go on'))).toEqual([])
    },
  )

  for (const surface of SURFACES) {
    test(
      `a task_assign call and a task_close call each draw one row, and below 60 columns the title takes its own line, on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        const marker = surface === 'terminal' ? '● ' : ''
        const indent = surface === 'terminal' ? '  ' : ''
        const title = 'Rotate the staging API key'
        const assigned = await called($, seen, { tool: TOOL_ASSIGN, kind: 'do', title })
        await personSays($, 'I rotated the staging API key')
        const closed = await called($, seen, {
          tool: TOOL_CLOSE,
          id: 1,
          how: 'person_did',
          said: 'I rotated the staging API key',
        })
        expect(await callRowLines($, surface, assigned, 80)).toEqual([
          `${marker}Task 1 ◆ for you, do  ${title}`,
        ])
        expect(await callRowLines($, surface, closed, 80)).toEqual([
          `${marker}Task 1 ✓ closed by Claude  ${title}`,
          `${indent}you said: "I rotated the staging API key"`,
        ])
        expect(await callRowLines($, surface, assigned, 40)).toEqual([
          `${marker}Task 1 ◆ for you, do`,
          `${indent}${title}`,
        ])
        expect(await callRowLines($, surface, closed, 40)).toEqual([
          `${marker}Task 1 ✓ closed by Claude`,
          `${indent}${title}`,
          `${indent}you said: "I rotated the staging API`,
          `${indent}key"`,
        ])
        const port = 'Which port does staging use?'
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: port })
        const notNeeded = await called($, seen, {
          tool: TOOL_CLOSE,
          id: 2,
          how: 'not_needed',
          note: 'It is in the config file',
        })
        expect(await callRowLines($, surface, notNeeded, 80)).toEqual([
          `${marker}Task 2 ✓ closed by Claude  ${port}`,
          `${indent}not needed: It is in the config file`,
        ])
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: 'Which region?' })
        await personSays($, 'Use eastern')
        const answered = await called($, seen, {
          tool: TOOL_CLOSE,
          id: 3,
          how: 'person_did',
          answer: 'eastern',
          said: 'Use eastern',
        })
        expect((await callRowLines($, surface, answered, 80))[1]).toBe(
          `${indent}you answered "eastern"`,
        )
        const long = await called($, seen, { tool: TOOL_ASSIGN, kind: 'do', title: ASKED_TITLE })
        const did = await called($, seen, {
          tool: TOOL_CLOSE,
          id: 4,
          how: 'claude_did',
          note: 'Asked the owner of the bill',
        })
        for (const columns of [40, 80, 120]) {
          for (const call of [long, did]) {
            const lines = await callRowLines($, surface, call, columns)
            expect(lines.join('\n')).not.toContain('…')
            expect(joinedWords(lines)).toContain(ASKED_TITLE)
            for (const line of lines) expect(line.length).toBeLessThanOrEqual(columns)
          }
        }
        expect((await callRowLines($, surface, did, 80)).at(-1)).toBe(
          `${indent}Claude did it: Asked the owner of the bill`,
        )
      },
    )
  }

  for (const surface of SURFACES) {
    for (const size of [
      { placement: 'dock', columns: 41 },
      { placement: 'inline', columns: 76 },
      { placement: 'inline', columns: 36 },
      { placement: 'dock', columns: 30 },
    ] as const) {
      test(
        `the closed rows say who closed each task and wrap their whole text, ${size.placement} at ${String(size.columns)} columns on ${surface}`,
        withWorkitems,
        async ($, on) => {
          world(on)
          await start($)
          await closedScene($)
          const pane = await mountTasks($, surface, size.placement, size.columns)
          const lines = forYouLines(await screen(pane, size.columns))
          expect(lines.join('\n')).not.toContain('…')
          if (size.columns === 41) expect(lines).toEqual(CLOSED_AT_41)
          if (size.columns === 30) expect(lines).toEqual(CLOSED_AT_30)
          const text = joinedWords(lines)
          for (const shown of [
            'Claude: you chose',
            '"SQLite" you said: "Take SQLite for now"',
            'Claude: not needed',
            'The cleanup job deleted it last night',
            'Claude did it',
            'Restarted it with the deploy script after the config change',
            'Claude: you answered',
            `"eastern" you said: "${SCENE_SAID}"`,
            'you: done · to send',
            'you answered · to send',
            '"8443"',
            'you rejected · to send',
            '"not my call"',
            'Claude gets them with your next prompt.',
          ]) {
            expect(text).toContain(shown)
          }
          const keys = (await pane.findAll({ type: 'Button' }))
            .map((button) => button.key ?? '')
            .filter((key) => key.startsWith('for-undo') || key.startsWith('for-reopen'))
          expect(keys).toEqual([
            'for-reopen:3',
            'for-reopen:4',
            'for-reopen:5',
            'for-reopen:6',
            'for-undo:1',
            'for-undo:2',
            'for-undo:8',
          ])
          const title = await pane.find({ type: 'Text', text: /^Write the release/u })
          expect(title?.props.bold).toBe(true)
          expect((await pane.find({ type: 'Text', text: '"eastern"' }))?.props.bold).toBe(true)
          await pane.unmount()
        },
      )
    }
  }

  for (const surface of SURFACES) {
    test(
      `from body 50 the band names the oldest open task for the person, cuts the own title first, and keeps the short line below 50, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await bandFour($, seen)
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: 'Pick a port' })
        expect(await bandLine($, surface, 75)).toBe(
          '◆ 2 for you: Rotate the staging API key · ▶ 2 Write…  4m ▰▰▱▱ 1/4 [ board ]',
        )
        expect(await bandLine($, surface, 60)).toBe(
          '◆ 2 for you: Rotate the stagin… · ▶ 2  4m ▰▰▱▱ 1/4 [ board ]',
        )
        expect(await bandLine($, surface, 45)).toBe('◆ 2 for you · ▶ 2 Write the… 4m 1/4 [ board ]')
        await closeTaskCall($, { id: 5, how: 'claude_did', note: 'Rotated it' })
        expect(await bandLine($, surface, 75)).toBe(
          '◆ 1 for you: Pick a port · ▶ 2 Write the tab mocks    4m ▰▰▱▱ 1/4 [ board ]',
        )
      },
    )
  }
})

describe('review repairs of the plan offer and the band (handily-9uj3n.7 and .9)', () => {
  for (const surface of SURFACES) {
    test(
      `a task for the person after the approval raises no repeat warning on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        engineRows(on)
        await start($)
        const call = await approve($, seen)
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        expect(await planLine($, surface, call)).toBe(
          '  [ add 3 steps as tasks ]  adds them to the board as pending tasks',
        )
        const pane = await mountTasks($, surface)
        expect(await pane.find({ type: 'Text', text: /Claude added/ })).toBeUndefined()
        await pane.unmount()
      },
    )

    test(
      `a step that is empty without its marks is no step on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, {
          planAnswer: planOf(
            '1. Read the design\n2. ![](diagram.png)\n3. [ ] \n4. ``\n5. Test it\n',
          ),
        })
        await start($)
        await approve($, seen)
        const pane = await mountTasks($, surface)
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            'Plan  approved · 2 numbered steps',
            '  1 Read the design',
            '  2 Test it',
          ]),
        )
        await pane.unmount()
        expect(await board($, 'plan')).toBe(
          'Added tasks 1-2 from the approved plan. Claude is told at your next prompt.',
        )
      },
    )

    test(
      `a band that stays drawn moves its time and turns to the warning colour at 15 minutes on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await bandFour($, seen)
        const ui = await mountBand($, surface)
        expect((await ui.find({ type: 'Text', text: '4m' }))?.props.dimColor).toBe(true)
        await seen.clock.advance(12 * MINUTE)
        expect((await ui.find({ type: 'Text', text: 'stalled 16m' }))?.props.color).toBe('warning')
        await ui.unmount()
      },
    )

    test(
      `no band timer runs while the band draws no task in progress on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        await start($)
        await bandFour($, seen)
        const ui = await mountBand($, surface)
        await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'pending' })
        expect(await ui.find({ type: 'Text', text: 'next' })).toBeDefined()
        const asked = seen.panesAsked
        await seen.clock.advance(MINUTE)
        expect(seen.panesAsked).toBe(asked)
        await ui.unmount()
      },
    )

    test(
      `the band follows a switch to the this machine tab at once and to another tab within 10 seconds, shows a closed board at once, and no draw writes state, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        engineRows(on)
        ownSession(on)
        const paneWrites: number[] = []
        on('state.set', { plugin: PLUGIN, key: 'paneChanges' }, (_$, e, next) => {
          paneWrites.push(e.value)
          return next(e)
        })
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
        expect(await board($, '')).toBe('Board opened: this session.')
        const tasks = await mountTasks($, surface)
        const band = await mountBand($, surface)
        expect(await band.find({ key: 'band' })).toBeUndefined()
        seen.shown = MACHINE
        const written = paneWrites.length
        const machine = await $.ui.mount({
          plugin: PLUGIN,
          surface,
          component: 'Pane',
          requestId: MACHINE,
          props: paneProps('dock', 41),
        })
        await seen.clock.advance(0)
        expect(await band.find({ key: 'band' })).toBeDefined()
        await machine.unmount()
        seen.shown = PANE
        await tasks.unmount()
        const again = await mountTasks($, surface)
        await seen.clock.advance(0)
        expect(await band.find({ key: 'band' })).toBeUndefined()
        expect(paneWrites.length).toBe(written)
        seen.shown = 'another-plugin-pane'
        await seen.clock.advance(10_000)
        expect(await band.find({ key: 'band' })).toBeDefined()
        seen.shown = PANE
        await seen.clock.advance(10_000)
        expect(await band.find({ key: 'band' })).toBeUndefined()
        expect(await board($, 'close')).toBe('Board closed.')
        expect(await band.find({ key: 'band' })).toBeDefined()
        await again.unmount()
        await seen.clock.advance(0)
        expect(await band.find({ key: 'band' })).toBeDefined()
        await band.unmount()
        expect(seen.logs.filter((line) => line.includes('state.set: denied'))).toEqual([])
      },
    )
  }

  test('a plan lock that a failed add left behind frees itself after 10 seconds', async () => {
    let now = 1_000
    let plan: BoardPlan | undefined
    let planWrites = 0
    let list: BoardList = { tasks: [], nextId: 1 }
    let isListBroken = true
    const plans: PlanHost = {
      now: () => Promise.resolve(now),
      current: () => Promise.resolve('plan-1'),
      read: () => Promise.resolve(plan),
      edit: <T>(_id: string, change: (kept: BoardPlan) => { plan: BoardPlan; value: T }) => {
        planWrites += 1
        if (plan === undefined || (isListBroken && planWrites > 1)) {
          return Promise.reject(new Error('the plan write failed'))
        }
        const changed = change(plan)
        plan = changed.plan
        return Promise.resolve(changed.value)
      },
    }
    const refuse = () => Promise.reject(new Error('not used'))
    const host: TaskHost = {
      read: () => Promise.resolve(list),
      edit: <T>(change: (kept: BoardList) => { list: BoardList; value: T }) => {
        if (isListBroken) return Promise.reject(new Error('the list write failed'))
        const changed = change(list)
        list = changed.list
        return Promise.resolve(changed.value)
      },
      snapshot: refuse,
      lines: refuse,
      tell: () => Promise.resolve(undefined),
      expanded: refuse,
      editExpanded: refuse,
    }
    plan = newPlan('plan-1', '1. Read the design\n2. Test it\n', 1)
    const failed = await addPlanAsTasks(plans, host, 'plan-1').then(
      () => 'added',
      (error: unknown) => String(error),
    )
    expect(failed).toBe('Error: the plan write failed')
    isListBroken = false
    now += 1_000
    expect((await addPlanAsTasks(plans, host, 'plan-1')).text).toBe(
      'The approved plan is being added. Nothing changed.',
    )
    now += 10_000
    expect((await addPlanAsTasks(plans, host, 'plan-1')).text).toBe(
      'Added tasks 1-2 from the approved plan. Claude is told at your next prompt.',
    )
  })
})

const FILES_BUTTON_CRITERION =
  'When the person presses the files button on task 2 in the board, the files tab shows only the files of task 2 with the counts line.'
const NO_TREE_CRITERION = 'When the tree command is not listed, the board shows no files button.'

type TreeRuns = { args: string[]; names: readonly string[] | 'refused' }

function listsCommands(on: On, names: readonly string[] | 'refused'): TreeRuns {
  const runs: TreeRuns = { args: [], names }
  on('command.list', () => {
    if (runs.names === 'refused') return { deny: 'the slash commands are not ready' }
    return {
      value: runs.names.map((name) => ({
        name,
        description: `the ${name} command`,
        source: 'plugin' as const,
        plugin: name === 'tree' ? 'handily-filetree' : PLUGIN,
      })),
    }
  })
  on('command.run', { command: 'tree' }, (_$, e) => {
    runs.args.push(e.args)
    if (e.args === 'task 3') throw new Error('the files tab is gone')
    return { text: `Tree opened: files of ${e.args}.` }
  })
  return runs
}

async function openedTask($: Engine, surface: Surface, id: number) {
  const ui = await mountTab($, surface, PANE, 'dock', 41)
  await ui.press({ key: `open:task:${String(id)}` })
  return ui
}

for (const surface of SURFACES) {
  describe(FILES_BUTTON_CRITERION, () => {
    test(
      `an opened task 2 has a files button under its other buttons, as mock 10.9a, and a press runs /tree task 2, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const runs = listsCommands(on, ['board', 'tree'])
        await startOn($, surface)
        await mockWork($, seen)
        const ui = await openedTask($, surface, 2)
        const gap = bySurface(surface, '', '    ')
        expect(fromTasks(await screen(ui, 41)).slice(1, 6)).toEqual([
          `▶ 2 Write the tab mocks     ${gap}4m [ rm ]`,
          `    ▸ Edit docs/mocks.md      ${gap}9 tools`,
          '    started 4m ago · 9 tools in all',
          '    [ done ] [ open ]',
          '    [ files ]',
        ])
        await ui.press({ key: 'files:2' })
        expect(runs.args).toEqual(['task 2'])
        expect(seen.toasts).toEqual([])
        await ui.unmount()
      },
    )

    test(
      `a run of /tree that fails is logged and named in a toast, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const runs = listsCommands(on, ['board', 'tree'])
        await startOn($, surface)
        await mockWork($, seen)
        const ui = await openedTask($, surface, 3)
        await ui.press({ key: 'files:3' })
        expect(runs.args).toEqual(['task 3'])
        expect(seen.toasts).toEqual([['■ The files tab did not open', 'the transcript shows why']])
        expect(
          seen.logs.filter((text) => text.includes('the files tab did not open')),
        ).toHaveLength(1)
        await ui.unmount()
      },
    )
  })

  describe(NO_TREE_CRITERION, () => {
    test(
      `with no /tree in the slash commands, an opened task has no files button, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const runs = listsCommands(on, ['board', 'tasks'])
        await startOn($, surface)
        await mockWork($, seen)
        const ui = await openedTask($, surface, 2)
        expect(await ui.find({ key: 'files:2' })).toBeUndefined()
        expect(fromTasks(await screen(ui, 41)).slice(3, 6)).toEqual([
          '    started 4m ago · 9 tools in all',
          '    [ done ] [ open ]',
          bySurface(
            surface,
            '○ 3 Review the mocks with Cod… [ rm ]',
            '○ 3 Review the mocks with Codex    [ rm ]',
          ),
        ])

        expect(runs.args).toEqual([])
        runs.names = ['board', 'tasks', 'tree']
        await ui.redraw()
        expect(await ui.find({ key: 'files:2' })).toBeDefined()
        await ui.unmount()
      },
    )

    test(
      `a slash command list that is refused shows no files button and logs why, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        listsCommands(on, 'refused')
        await startOn($, surface)
        await mockWork($, seen)
        const ui = await openedTask($, surface, 2)
        expect(await ui.find({ key: 'files:2' })).toBeUndefined()
        expect(
          seen.logs.some((text) => text.includes('the slash commands could not be listed')),
        ).toBe(true)
        await ui.unmount()
      },
    )
  })
}

const OLD_AGENT = 'a0000009old'
const AXIS_EXTRAS = [
  ...LANE_EXTRAS,
  ['a0000006review', 'review'],
  ['a0000008build', 'build'],
] as const

async function oldAgentEnded($: Engine, seen: World, surface: Surface): Promise<void> {
  await startOn($, surface)
  await seen.clock.set(START)
  await spawnFrom($, OLD_AGENT)
  seen.agents.push({ ...runningAgent(OLD_AGENT, 'old'), status: 'completed' })
  await seen.clock.advance(MINUTE)
  await $.turn.complete({
    turnId: 'turn-old',
    reason: 'answer',
    answer: 'done',
    durationMs: MINUTE,
    isAborted: false,
    agentId: OLD_AGENT,
  })
  await seen.clock.advance(29 * MINUTE)
  for (const [id, name] of [[EXPLORE, 'Explore'], ...AXIS_EXTRAS] as const) {
    await spawnFrom($, id)
    seen.agents.push(runningAgent(id, name))
  }
  await seen.clock.advance(MINUTE)
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
  await seen.clock.advance(MINUTE)
}

describe('the agent lanes: review repairs (handily-xsjad.8)', () => {
  for (const surface of SURFACES) {
    test(
      `a folded ended agent does not stretch the axis, and the axis takes it in once the fold opens, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await oldAgentEnded($, seen, surface)
        const ui = await mountTab($, surface, PANE, 'dock', 89)
        const folded = unframed(await screen(ui, 89))
        const header = folded.findIndex((line) => line.startsWith('Agents'))
        const explore = (lines: readonly string[]) =>
          lines.find((line) => line.includes('▶ Explore'))
        if (surface === 'desktop') {
          expect(folded[header]).toBe('Agents  5')
          expect(await ui.find({ key: `lane:agent:${EXPLORE}` })).toBeUndefined()
          await ui.unmount()
          return
        }
        expect(folded[header]).toBe('Agents  5 · lanes from 2m ago to now')
        expect(explore(folded)).toContain(`ctx —   ${'━'.repeat(20)} open  2m`)
        await ui.press({ key: 'group:ended-agents' })
        const opened = unframed(await screen(ui, 89))
        expect(opened[header]).toBe('Agents  5 · lanes from 32m ago to now')
        expect(explore(opened)).toContain(`ctx —   ${'·'.repeat(18)}━━ open  2m`)
        expect(opened.find((line) => line.includes('✓ old'))).toContain(
          `ctx —   ━${'·'.repeat(19)}`,
        )
        await ui.unmount()
      },
    )
  }
})

describe('the glyph setting', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    test(
      `keeps glyphs nerd from the handily row at session start and draws the waits toast with the nerd bell for 10 s on ${surface}`,
      { ...withWorkitems, options: { mode: 'always' } },
      async ($, on) => {
        const seen = world(on, {
          unplacedReason: 'an unasked pane waits for 144 columns.',
          glyphs: 'nerd',
        })
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        expect(seen.glyphs).toEqual(['nerd'])
        expect(seen.toasts).toEqual([NERD_WAITS_TOAST])
        expect(seen.toastMs).toEqual([10000])
      },
    )

    test(
      `keeps glyphs plain with no glyphs row and draws the plain waits toast on ${surface}`,
      { ...withWorkitems, options: { mode: 'always' } },
      async ($, on) => {
        const seen = world(on, { unplacedReason: 'an unasked pane waits for 144 columns.' })
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        expect(seen.glyphs).toEqual(['plain'])
        expect(seen.toasts).toEqual([WAITS_TOAST])
        expect(seen.toastMs).toEqual([10000])
      },
    )
  }

  test(
    'reads the setting again after a config set of the glyphs row, and not after another row',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, { glyphs: 'plain' })
      await start($)
      seen.config = [glyphsRow('nerd')]
      for (const [key, plugin] of [
        ['theme', 'engine'],
        ['handily-board.glyphs', 'handily-board@niksavis'],
      ] as const) {
        await $.config.set({
          key,
          value: 'nerd',
          previous: 'plain',
          provider: { plugin, tier: 'user' },
          origin: { kind: 'composer' },
        })
      }
      expect(seen.glyphs).toEqual(['plain'])
      await $.config.set({
        key: GLYPHS_KEY,
        value: 'nerd',
        previous: 'plain',
        provider: { plugin: 'handily@niksavis', tier: 'user' },
        origin: { kind: 'composer' },
      })
      expect(seen.glyphs).toEqual(['plain', 'nerd'])
    },
  )
})

describe('the glyph setting of the task status toast', () => {
  const marksOf = {
    plain: { doing: '▶', done: '✓', toDo: '○' },
    nerd: { doing: '\u{EB2C}', done: '\u{EAB2}', toDo: '\u{EBB5}' },
  } as const
  for (const glyphs of ['nerd', 'plain'] as const) {
    for (const surface of SURFACES) {
      test(
        `start, done and open draw the ${glyphs} mark of the new status on ${surface}`,
        withWorkitems,
        async ($, on) => {
          const seen = world(on, { glyphs })
          await start($)
          await mockWork($, seen)
          const ui = await mountTab($, surface, PANE, 'dock', 41)
          const marks = marksOf[glyphs]
          const title = '"Review the mocks with Codex"'
          await ui.press({ key: 'open:task:3' })
          await ui.press({ key: 'start:3' })
          expect(seen.toasts.at(-1)).toEqual([`${marks.doing} Task 3 is now in progress`, title])
          await ui.press({ key: 'done:3' })
          expect(seen.toasts.at(-1)).toEqual([`${marks.done} Task 3 is now done`, title])
          await ui.press({ key: 'done' })
          await ui.press({ key: 'open:3' })
          expect(seen.toasts.at(-1)).toEqual([`${marks.toDo} Task 3 is now pending`, title])
          await ui.unmount()
        },
      )
    }
  }
})

const SIGNALS_FROM_SET_CRITERION =
  'SIGNALS keeps the theme colours and takes its marks from the set in the board state key glyphs, and END_MARKS in lanes.ts uses the set.'
const NERD_TAB_CRITERION =
  'With glyphs nerd the this session tab of mock 11 draws U+EB2C, U+EBB5, U+EAA2 and U+EA87, and every drawn line measures 41 columns at body 41 and 30 at body 30.'
const KEPT_MARKS_CRITERION =
  'The running call mark, the progress bar, the lane cells, the rules and the row bullet are the same in both sets, and on the desktop surface the board draws plain.'

const NERD_OF_PLAIN: readonly (readonly [string, string])[] = [
  ['▶', '\u{EB2C}'],
  ['✓', '\u{EAB2}'],
  ['○', '\u{EBB5}'],
  ['■', '\u{EA87}'],
  ['◆', '\u{EAA2}'],
]
const NERD_DOING = '\u{EB2C}'
const NERD_TO_DO = '\u{EBB5}'
const NERD_BELL = '\u{EAA2}'
const NERD_ERROR = '\u{EA87}'
const SECTION_RULE = /^─+$/u

function nerdSwapped(line: string): string {
  return NERD_OF_PLAIN.reduce((text, [plain, nerd]) => text.replaceAll(plain, nerd), line)
}

async function setGlyphs($: Engine, seen: World, value: 'plain' | 'nerd'): Promise<void> {
  const previous = seen.config.find((row) => row.key === GLYPHS_KEY)?.value ?? 'plain'
  seen.config = [glyphsRow(value)]
  await $.config.set({
    key: GLYPHS_KEY,
    value,
    previous,
    provider: { plugin: 'handily@niksavis', tier: 'user' },
    origin: { kind: 'composer' },
  })
}

async function glyphScene($: Engine, on: On, surface: Surface) {
  const seen = world(on, { glyphs: 'plain' })
  const dialog = personDialog(on)
  await startOn($, surface)
  await mockWork($, seen)
  await spawnFrom($, LANE)
  seen.agents.push({ ...runningAgent(LANE, 'lane-b'), status: 'failed' })
  await $.tool.call({ tool: 'Bash', command: 'npm run build', agentId: LANE })
  await $.turn.complete({
    turnId: 'turn-lane',
    reason: 'answer',
    answer: 'done',
    durationMs: MINUTE,
    isAborted: false,
    agentId: LANE,
  })
  await spawnFrom($, SCOUT)
  const { call } = await scoutWaits($, seen, dialog)
  return { seen, dialog, call }
}

function widthProblems(lines: readonly string[], columns: number): string[] {
  return lines.flatMap((line) => {
    const width = displayWidth(line)
    if (width > columns) return [`"${line}" measures ${String(width)}, over ${String(columns)}`]
    if (SECTION_RULE.test(line) && width !== columns) {
      return [`"${line}" measures ${String(width)}, not ${String(columns)}`]
    }
    return []
  })
}

describe(NERD_TAB_CRITERION, () => {
  for (const surface of SURFACES) {
    for (const columns of [41, 30]) {
      test(
        `a switch to glyphs nerd swaps each signal mark one for one at body ${String(columns)} on ${surface}, where the desktop keeps plain`,
        withWorkitems,
        async ($, on) => {
          const { seen, dialog, call } = await glyphScene($, on, surface)
          const ui = await mountTab($, surface, PANE, 'dock', columns)
          const plain = await screen(ui, columns)
          const plainText = plain.join('\n')
          for (const mark of ['▶', '○', '◆', '■']) expect(plainText).toContain(mark)
          await setGlyphs($, seen, 'nerd')
          const nerd = await screen(ui, columns)
          expect(nerd).toEqual(bySurface(surface, plain.map(nerdSwapped), plain))
          const nerdText = nerd.join('\n')
          for (const icon of [NERD_DOING, NERD_TO_DO, NERD_BELL, NERD_ERROR]) {
            expect(nerdText.includes(icon)).toBe(surface === 'terminal')
          }
          expect(widthProblems(nerd, columns)).toEqual([])
          expect(nerd.map(displayWidth)).toEqual(plain.map(displayWidth))
          if (columns === 41 && surface === 'terminal') {
            expect(nerd.filter((line) => SECTION_RULE.test(line)).length).toBeGreaterThan(2)
          }
          await ui.unmount()
          dialog.allow()
          await call
        },
      )
    }
  }

  test(
    'the nerd tab of mock 11 draws each row with its icon at body 41 and body 30 on the terminal',
    withWorkitems,
    async ($, on) => {
      const { seen, dialog, call } = await glyphScene($, on, 'terminal')
      await setGlyphs($, seen, 'nerd')
      const wide = await mountTab($, 'terminal', PANE, 'dock', 41)
      const framed = unframed(await screen(wide, 41))
      await wide.unmount()
      expect(framed).toContain(`Tasks  ▰▰▱▱ 1/4 · ${NERD_DOING}1 ${NERD_TO_DO}2 · 14m`)
      expect(framed).toContain(`${NERD_DOING} 2 Write the tab mocks     4m [ rm ]`)
      expect(framed).toContain('    ▸ Edit docs/mocks.md      9 tools')
      expect(framed).toContain(`${NERD_TO_DO} 3 Review the mocks with Cod… [ rm ]`)
      const titles = framed.findIndex((line) => line.includes(`${NERD_BELL} scout`))
      expect(framed[titles]).toContain(`${NERD_ERROR} lane-b`)
      expect(framed[titles + 1]).toMatch(/needs you .* failed/u)
      const narrow = await mountTab($, 'terminal', PANE, 'dock', 30)
      const flat = await screen(narrow, 30)
      await narrow.unmount()
      expect(flat[0]).toBe(`Session  ${NERD_BELL} 1 waits · ${NERD_TO_DO} idle`)
      expect(flat).toContain(`${NERD_DOING} 2 Write the tab m… 4m [ rm ]`)
      expect(widthProblems(flat, 30)).toEqual([])
      dialog.allow()
      await call
    },
  )
})

describe(KEPT_MARKS_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `with glyphs nerd the running call mark, the progress bar and the rule stay on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { seen, dialog, call } = await glyphScene($, on, surface)
        await setGlyphs($, seen, 'nerd')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        const lines = await screen(ui, 41)
        await ui.unmount()
        const flat = unframed(lines)
        expect(lineWith(flat, '▸ Edit docs/mocks.md')).toBeDefined()
        expect(lineWith(flat, '▰▰▱▱ 1/4')).toBeDefined()
        expect(lines.some((line) => line.includes('─'.repeat(37)))).toBe(true)
        dialog.allow()
        await call
      },
    )

    test(
      `with glyphs nerd the lane cells stay and each lane ends in the icon of its state on ${surface}, while the desktop draws rows with no lane`,
      withWorkitems,
      async ($, on) => {
        const { seen, dialog, call } = await glyphScene($, on, surface)
        for (const [id, name] of AXIS_EXTRAS.slice(0, 3)) {
          await spawnFrom($, id)
          seen.agents.push(runningAgent(id, name))
        }
        await setGlyphs($, seen, 'nerd')
        const ui = await mountTab($, surface, PANE, 'dock', 89)
        const scout = drawnOf(await ui.find({ key: `lane:agent:${SCOUT}` }))
        const lane = drawnOf(await ui.find({ key: `lane:agent:${LANE}` }))
        await ui.unmount()
        if (surface === 'desktop') {
          expect([scout, lane]).toEqual([null, null])
          dialog.allow()
          await call
          return
        }
        const bell = NERD_BELL
        const error = NERD_ERROR
        expect(scout?.text).toMatch(new RegExp(`^·*━+${bell}·*$`, 'u'))
        expect(scout?.children[1]?.props.color).toBe('warning')
        expect(lane?.text).toMatch(new RegExp(`^·*━*${error}·+$`, 'u'))
        expect(lane?.children[1]?.props.color).toBe('error')
        expect(displayWidth(scout?.text ?? '')).toBe(20)
        expect(displayWidth(lane?.text ?? '')).toBe(20)
        dialog.allow()
        await call
      },
    )

    test(
      `with glyphs nerd a task tool row keeps the row bullet and draws the status icon on ${surface}, plain on the desktop`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { glyphs: 'nerd' })
        engineRows(on)
        await startOn($, surface)
        await called($, seen, { tool: TOOL_ADD, title: 'Draw the mocks' })
        const started = await called($, seen, { tool: TOOL_UPDATE, id: 1, status: 'in_progress' })
        expect(await callRow($, surface, useOf(started))).toBe(
          bySurface(
            surface,
            `● Task 1 ${NERD_DOING} in progress  Draw the mocks`,
            'Task 1 ▶ in progress  Draw the mocks',
          ),
        )
      },
    )

    test(
      `with glyphs nerd the band draws the icon of the current task on ${surface}, plain on the desktop`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { glyphs: 'nerd' })
        engineRows(on)
        await startOn($, surface)
        await bandFour($, seen)
        const mark = bySurface(surface, NERD_DOING, '▶')
        expect(await bandLine($, surface)).toBe(
          `${mark} 2 Write the tab mocks                               4m ▰▰▱▱ 1/4 [ board ]`,
        )
      },
    )
  }
})

describe(SIGNALS_FROM_SET_CRITERION, () => {
  const nerdWaits = `${NERD_BELL} scout waits for permission: Bash npm test`
  for (const surfaces of [['terminal'], ['terminal', 'desktop']] as const) {
    test(
      `the status line and /board stats draw the bell of the kept setting and redraw after a switch, in a session on ${surfaces.join(' and ')}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { glyphs: 'nerd', surfaces })
        const dialog = personDialog(on)
        await startOn($, surfaces[0])
        const { call } = await scoutWaits($, seen, dialog)
        expect(seen.statuses).toEqual([nerdWaits])
        expect(await board($, 'stats')).toContain(`    ${nerdWaits}`)
        await setGlyphs($, seen, 'plain')
        expect(seen.statuses).toEqual([nerdWaits, SCOUT_WAITS])
        expect(await board($, 'stats')).toContain(`    ${SCOUT_WAITS}`)
        dialog.allow()
        await call
      },
    )
  }

  test(
    'the status line and /board stats draw the plain mark with glyphs nerd in a session on the desktop only',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, { glyphs: 'nerd', surfaces: ['desktop'] })
      const dialog = personDialog(on)
      await startOn($, 'desktop')
      const { call } = await scoutWaits($, seen, dialog)
      expect(seen.statuses).toEqual([SCOUT_WAITS])
      const stats = await board($, 'stats')
      expect(stats).toContain(`    ${SCOUT_WAITS}`)
      expect(stats).not.toContain(NERD_BELL)
      dialog.allow()
      await call
    },
  )

  test(
    'a pane that cannot read the glyph setting logs it and draws plain',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, { glyphs: 'nerd' })
      let isLocked = false
      on('state.get', { plugin: PLUGIN, key: 'glyphs' }, (_$, e, next) =>
        isLocked ? { deny: 'the store is locked' } : next(e),
      )
      await start($)
      await mockWork($, seen)
      isLocked = true
      const ui = await mountTab($, 'terminal', PANE, 'dock', 41)
      const lines = unframed(await screen(ui, 41))
      await ui.unmount()
      expect(lines).toContain('▶ 2 Write the tab mocks     4m [ rm ]')
      const failures = seen.logs.filter((text) =>
        text.startsWith('handily-board: the glyph setting was not read: '),
      )
      expect(failures.length).toBeGreaterThan(0)
      expect(failures[0]).toContain('the store is locked')
    },
  )
})

describe('the engine row check', () => {
  test('passes for an engine row of ref 0 and of ref 1', () => {
    expectEngineRow({ type: 'engine', ref: 0 })
    expectEngineRow({ type: 'engine', ref: 1 })
    expectNoEngineRow({ type: 'Box', ref: 0 })
  })

  test('fails for a row of another type and for a ref that is not an integer of 0 or more', () => {
    expect(() => {
      expectEngineRow({ type: 'Box', ref: 0 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine', ref: -1 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine', ref: 1.5 })
    }).toThrow()
    expect(() => {
      expectEngineRow({ type: 'engine' })
    }).toThrow()
    expect(() => {
      expectNoEngineRow({ type: 'engine', ref: 1 })
    }).toThrow()
  })
})

const CHAT_AT = new Date(2026, 10, 19, 18, 12, 0).getTime()
const CHAT_TURN = 'chat-turn'
const SHIP_CHOICE = 'Decision on task 1, "Ship the build?": "go"'

async function endTurn($: Engine): Promise<void> {
  await $.turn.complete({
    turnId: CHAT_TURN,
    reason: 'answer',
    answer: 'done',
    durationMs: 1,
    isAborted: false,
  })
}

async function personTurn($: Engine, text: string): Promise<void> {
  await personSays($, text)
  await $.turn.start({ text, turnId: CHAT_TURN })
  await endTurn($)
}

async function assignShip($: Engine): Promise<void> {
  await $.tool.call({
    tool: TOOL_ASSIGN,
    kind: 'decide',
    title: 'Ship the build?',
    options: ['go', 'not now'],
  })
}

async function forYouAt($: Engine, surface: Surface, columns: number): Promise<string[]> {
  const pane = await mountTasks($, surface, columns === 41 ? 'dock' : 'inline', columns)
  const lines = forYouLines(unframed(await screen(pane, columns)))
  await pane.unmount()
  return lines
}

async function forKeys(
  pane: Awaited<ReturnType<typeof mountTasks>>,
  lead: string,
): Promise<string[]> {
  return (await pane.findAll({ type: 'Button' }))
    .map((button) => button.key ?? '')
    .filter((key) => key.startsWith(lead))
}

describe('decide tasks answered in the chat and tasks for the person that wait too long (handily-yb14h4)', () => {
  for (const surface of SURFACES) {
    test(
      `an option word that the turn leaves open marks the decide task answered in chat with two buttons, and close as records the choice of the person, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await seen.clock.set(CHAT_AT)
        await start($)
        await assignShip($)
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'decide',
          title: 'Merge the lane?',
          options: ['go', 'not now'],
        })
        await personSays($, 'Merge the lane: go')
        await personSays($, 'go')
        await $.turn.start({ text: 'go', turnId: CHAT_TURN })
        await closeTaskCall($, {
          id: 4,
          how: 'person_did',
          option: 1,
          said: 'Merge the lane: go',
        })
        await endTurn($)
        expect(await forYouAt($, surface, 76)).toEqual([
          '◆ 1 decide  Ship the build?',
          `    ${'answered in chat? you said "go" · 18:12'.padEnd(41)} [ close as go ] [ still open ]`,
          '    [ go ] [ not now ]',
          '    [ reject ]',
          '◆ 2 answer  Which port does staging use?',
          '    [ Your answer ][Send]',
          '    [ reject ]',
          '◆ 3 do      Rotate the staging API key',
          '    [ done ] [ reject ]',
          '✓ 4 decide  Merge the lane?',
          `${'    Claude: you chose'.padEnd(65)} [ reopen ]`,
          '    "go"',
          '    you said: "Merge the lane: go"',
        ])
        expect(await forYouAt($, surface, 41)).toEqual([
          '◆ 1 decide  Ship the build?',
          '    answered in chat? you said "go" ·',
          '    18:12',
          '    [ close as go ] [ still open ]',
          '    [ go ] [ not now ]',
          '    [ reject ]',
          '◆ 2 answer  Which port does staging use?',
          '    [ Your answer ][Send]',
          '    [ reject ]',
          '◆ 3 do      Rotate the staging API key',
          '    [ done ] [ reject ]',
          '✓ 4 decide  Merge the lane?',
          '    Claude: you chose          [ reopen ]',
          '    "go"',
          '    you said: "Merge the lane: go"',
        ])
        const pane = await mountTasks($, surface)
        expect(await forKeys(pane, 'for-chat')).toEqual(['for-chat-close:1', 'for-chat-open:1'])
        expect(
          (await pane.find({ type: 'Text', text: /^answered in chat/u }))?.props.dimColor,
        ).toBe(true)
        await pane.press({ key: 'for-chat-close:1' })
        expect(entered.map((one) => one.text)).toEqual(['Merge the lane: go', 'go', SHIP_CHOICE])
        expect(entered.at(-1)).toMatchObject({ text: SHIP_CHOICE, origin: OWN_PROMPT })
        expect(await forKeys(pane, 'for-chat')).toEqual([])
        expect(joinedWords(forYouLines(unframed(await screen(pane, 41))))).toContain(
          `✓ 1 decide Ship the build? sent ${SHIP_CHOICE}`,
        )
        await pane.unmount()
        expect(await board($, 'list')).toContain('chose "go"')
      },
    )

    test(
      `still open clears the chat mark until a new prompt holds an option label again, and a prompt with two labels of one task shows no mark, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await seen.clock.set(CHAT_AT)
        await start($)
        await assignShip($)
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'decide',
          title: 'Deploy the probe?',
          options: ['now', 'not now'],
        })
        await personTurn($, 'go')
        const pane = await mountTasks($, surface)
        expect(await forKeys(pane, 'for-chat')).toEqual(['for-chat-close:1', 'for-chat-open:1'])
        await pane.press({ key: 'for-chat-open:1' })
        expect(await forKeys(pane, 'for-chat')).toEqual([])
        await pane.unmount()
        await personTurn($, 'the staging box first')
        const kept = await mountTasks($, surface)
        expect(await forKeys(kept, 'for-chat')).toEqual([])
        await kept.unmount()
        await seen.clock.advance(MINUTE)
        await personTurn($, 'go or not now?')
        const both = await mountTasks($, surface)
        expect(await forKeys(both, 'for-chat')).toEqual(['for-chat-close:2', 'for-chat-open:2'])
        await both.unmount()
        await seen.clock.advance(MINUTE)
        await personTurn($, 'the lane is red\nNot now, wait\u{202e}')
        const again = await mountTasks($, surface)
        expect(await forKeys(again, 'for-chat')).toEqual([
          'for-chat-close:1',
          'for-chat-open:1',
          'for-chat-close:2',
          'for-chat-open:2',
        ])
        expect((await again.find({ key: 'for-chat-close:1' }))?.text).toBe('close as not now')
        expect((await again.find({ key: 'for-chat-close:2' }))?.text).toBe('close as not now')
        expect(joinedWords(forYouLines(unframed(await screen(again, 41))))).toContain(
          'answered in chat? you said "Not now, wait\\u202e" · 18:14',
        )
        await again.press({ key: 'for-chat-close:2' })
        await again.unmount()
        expect(await board($, 'list')).toContain('chose "not now"')
      },
    )

    test(
      `a task for the person open 2 hours with no prompt that names it draws dim and asks if it is still needed, and not needed closes it and tells Claude once, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await seen.clock.set(CHAT_AT)
        await start($)
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: 'Which port for the probe?' })
        await assignShip($)
        await personSays($, 'there are 23 of them')
        await personSays($, 'ROTATE it after lunch')
        await personSays($, 'about 2, later')
        await seen.clock.advance(2 * HOUR - MINUTE)
        const early = await mountTasks($, surface)
        expect(await forKeys(early, 'for-unneeded')).toEqual([])
        await early.unmount()
        await seen.clock.advance(11 * MINUTE)
        expect(await forYouAt($, surface, 76)).toEqual([
          '◆ 1 do      Rotate the staging API key',
          '    [ done ] [ reject ]',
          '◆ 2 answer  Which port for the probe?',
          '    [ Your answer ][Send]',
          '    [ reject ]',
          '◆ 3 decide  Ship the build?',
          `    ${'open 2h 10m · still needed?'.padEnd(57)} [ not needed ]`,
          '    [ go ] [ not now ]',
          '    [ reject ]',
        ])
        const pane = await mountTasks($, surface)
        const lines = unframed(await screen(pane, 41))
        expect(lines).toContain('For you  ◆ 3 open')
        expect(forYouLines(lines)).toEqual([
          '◆ 1 do      Rotate the staging API key',
          '    [ done ] [ reject ]',
          '◆ 2 answer  Which port for the probe?',
          '    [ Your answer ][Send]',
          '    [ reject ]',
          '◆ 3 decide  Ship the build?',
          '    open 2h 10m · still needed?',
          '    [ not needed ]',
          '    [ go ] [ not now ]',
          '    [ reject ]',
        ])
        expect(await forKeys(pane, 'for-unneeded')).toEqual(['for-unneeded:3'])
        const title = await pane.find({ type: 'Text', text: 'Ship the build?' })
        expect(title?.props.dimColor).toBe(true)
        expect(title?.props.bold).toBe(false)
        expect(
          (await pane.find({ type: 'Text', text: 'Rotate the staging API key' }))?.props.bold,
        ).toBe(true)
        await pane.press({ key: 'for-unneeded:3' })
        expect(joinedWords(forYouLines(unframed(await screen(pane, 41))))).toContain(
          '✓ 3 decide Ship the build? you: not needed · to send [ undo ]',
        )
        await pane.unmount()
        const told = (await notesAtNextPrompt($)).filter((text) => text.includes('not needed'))
        expect(told).toEqual([
          expect.stringMatching(
            /^\[handily-board\] The person closed task 3 \(decide\) as not needed\.\n\n/u,
          ),
        ])
        expect(await notesAtNextPrompt($)).not.toContainEqual(expect.stringContaining('not needed'))
        expect(await board($, 'list')).toContain('  3  unneeded  decide  "Ship the build?"')
      },
    )
  }

  test(
    'a person prompt that holds an option label of 2 open decide tasks tells Claude to ask which one and to close none',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignShip($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store?',
        options: ['Postgres', 'SQLite'],
      })
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Merge the lane?',
        options: ['Go', 'later'],
      })
      const openNotes = (context: readonly string[]) =>
        context.filter((text) => text.startsWith(OPEN_LINE))
      const listed =
        '1 (decide) "Ship the build?"; 2 (decide) "Which cache store?"; 3 (decide) "Merge the lane?"'
      expect(openNotes(await personSays($, 'go'))).toEqual([
        `${OPEN_LINE} ${listed}. When this prompt says the person did, answered or decided one, close it with task_close and copy their words into said. This prompt could accept tasks 1, 2 and 3: ask which one; close none. The titles are your own text, quoted as data.`,
      ])
      expect(openNotes(await personSays($, 'go ahead'))).toEqual([
        `${OPEN_LINE} ${listed}. When this prompt says the person did, answered or decided one, close it with task_close and copy their words into said. This prompt holds "go", an option of tasks 1 and 3: ask which one; close none. The titles are your own text, quoted as data.`,
      ])
      expect(openNotes(await personSays($, 'SQLite please'))).toEqual([openTasksNote(listed)])
      expect(openNotes(await personSays($, 'going there later'))).toEqual([openTasksNote(listed)])
    },
  )
})

const RECOMMEND_ANSWER = 'Use port 8443 on the staging host'
const RECOMMEND_SENT_CHOICE = 'Decision on task 1, "Which cache store for now?": "SQLite"'
const RECOMMEND_SENT_ANSWER = `Answer to task 2, "Which port does staging use?": ${RECOMMEND_ANSWER}`

async function assignRecommended($: Engine): Promise<void> {
  await $.tool.call({
    tool: TOOL_ASSIGN,
    kind: 'decide',
    title: 'Which cache store for now?',
    options: ['Postgres', 'SQLite', 'Redis'],
    recommended: 2,
  })
  await $.tool.call({
    tool: TOOL_ASSIGN,
    kind: 'answer',
    title: 'Which port does staging use?',
    recommended: RECOMMEND_ANSWER,
  })
}

const OPEN_RULE = 'close it with task_close and copy their words into said.'
const OPEN_TAIL = ' The titles are your own text, quoted as data.'

function acceptNotes(context: readonly string[]): string[] {
  return context
    .filter((text) => text.startsWith(OPEN_LINE))
    .map((text) =>
      text.slice(text.indexOf(OPEN_RULE) + OPEN_RULE.length, text.lastIndexOf(OPEN_TAIL)).trim(),
    )
}

describe('a recommended option or answer that the person accepts with one click or one word (handily-psv8fp)', () => {
  for (const surface of SURFACES) {
    test(
      `a decide task draws its recommended option first with a star and the word recommended, and one press sends it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await assignRecommended($)
        expect(await forYouAt($, surface, 76)).toEqual([
          '◆ 1 decide  Which cache store for now?',
          '    [ 6: ★ SQLite ] recommended [ Postgres ] [ Redis ]',
          '    [ reject ]',
          '◆ 2 answer  Which port does staging use?',
          `    recommended: "${RECOMMEND_ANSWER}" [ 7: accept ]`,
          '    [ Your answer ][Send]',
          '    [ reject ]',
        ])
        expect((await forYouAt($, surface, 41)).slice(0, 4)).toEqual([
          '◆ 1 decide  Which cache store for now?',
          '    [ 6: ★ SQLite ] recommended',
          '    [ Postgres ] [ Redis ]',
          '    [ reject ]',
        ])
        const pane = await mountTasks($, surface)
        expect(await forKeys(pane, 'for-pick')).toEqual([
          'for-pick:1:2',
          'for-pick:1:1',
          'for-pick:1:3',
        ])
        expect((await pane.find({ type: 'Text', text: '★ SQLite' }))?.props.color).toBe(
          'suggestion',
        )
        expect((await pane.find({ type: 'Text', text: 'recommended' }))?.props.dimColor).toBe(true)
        await pane.press({ key: 'for-pick:1:2' })
        expect(entered).toMatchObject([{ text: RECOMMEND_SENT_CHOICE, origin: OWN_PROMPT }])
        await pane.unmount()
        expect(await board($, 'list')).toContain('chose "SQLite"')
      },
    )

    test(
      `an answer task draws the recommended answer with the word recommended and accept sends it with one press, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await assignRecommended($)
        expect((await forYouAt($, surface, 41)).slice(4)).toEqual([
          '◆ 2 answer  Which port does staging use?',
          '    recommended: "Use port 8443 on the',
          '                 staging host"',
          '    [ 7: accept ]',
          '    [ Your answer ][Send]',
          '    [ reject ]',
        ])
        const pane = await mountTasks($, surface)
        expect((await pane.find({ type: 'Text', text: 'recommended: ' }))?.props.dimColor).toBe(
          true,
        )
        expect((await pane.find({ type: 'Text', text: /^"Use port 8443/u }))?.props.color).toBe(
          'suggestion',
        )
        await pane.press({ key: 'for-accept:2' })
        expect(entered).toMatchObject([{ text: RECOMMEND_SENT_ANSWER, origin: OWN_PROMPT }])
        await pane.unmount()
        expect(await board($, 'list')).toContain(`answer "${RECOMMEND_ANSWER}"`)
      },
    )
  }

  for (const surface of SURFACES) {
    test(
      `a recommended option too long for a button draws first on a numbered star button and wraps in full, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'decide',
          title: 'Which region for the probe?',
          options: ASKED_OPTIONS,
          recommended: 3,
        })
        const lines = await forYouAt($, surface, 41)
        expect(lines.join('\n')).not.toContain('…')
        expect(lines[1]).toBe('    [ 6: ★ 3 ] Both regions, with the')
        expect(joinedWords(lines)).toContain(
          `[ 6: ★ 3 ] ${ASKED_OPTIONS[2] ?? ''} recommended [ 1 ]`,
        )
        const pane = await mountTasks($, surface)
        expect(await forKeys(pane, 'for-pick')).toEqual([
          'for-pick:1:3',
          'for-pick:1:1',
          'for-pick:1:2',
          'for-pick:1:4',
        ])
        await pane.press({ key: 'for-pick:1:3' })
        expect(entered.map((one) => one.text)).toEqual([
          `Decision on task 1, "Which region for the probe?": "${ASKED_OPTIONS[2] ?? ''}"`,
        ])
        await pane.unmount()
      },
    )
  }

  test(
    'task_list shows the recommended option and the recommended answer on the row',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignRecommended($)
      expect(await modelTool($, {})).toBe(
        [
          'For you (0 of 2 closed)',
          '  1  open      decide  "Which cache store for now?"    options "Postgres", "SQLite", "Redis"; recommended 2 (SQLite)',
          `  2  open      answer  "Which port does staging use?"  recommended "${RECOMMEND_ANSWER}"`,
        ].join('\n'),
      )
    },
  )

  test(
    'with one open decide or answer task, a prompt of only ok or a bare option number tells Claude to close it, and task_close takes those words as said',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store for now?',
        options: ['Postgres', 'SQLite', 'Redis'],
        recommended: 2,
      })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      expect(acceptNotes(await personSays($, '3'))).toEqual([
        'This prompt accepts task 1: close it with task_close how person_did, option 3, and said "3".',
      ])
      const byNumber = await closeTaskCall($, { id: 1, how: 'person_did', option: 3, said: '3' })
      expect(byNumber.deny).toBeUndefined()
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
        recommended: RECOMMEND_ANSWER,
      })
      expect(acceptNotes(await personSays($, 'OK'))).toEqual([
        `This prompt accepts task 3: close it with task_close how person_did, answer "${RECOMMEND_ANSWER}", and said "OK".`,
      ])
      const byWord = await closeTaskCall($, {
        id: 3,
        how: 'person_did',
        answer: RECOMMEND_ANSWER,
        said: 'OK',
      })
      expect(byWord.deny).toBeUndefined()
      expect(await modelTool($, {})).toContain('chose "Redis", said "3"')
    },
  )

  test(
    'with two or more open decide or answer tasks, a one-word prompt asks which task and task_close refuses that word as said by name',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store for now?',
        options: ['Postgres', 'SQLite', 'Redis'],
        recommended: 2,
      })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
      })
      const ask = 'This prompt could accept tasks 1 and 3: ask which one; close none.'
      for (const word of ['go', ' Yes. ', '2', 'sqlite']) {
        expect(acceptNotes(await personSays($, word))).toEqual([ask])
      }
      const refusal = (said: string) =>
        `task_close refused: "${said}" alone names no task while tasks 1 and 3 are open for the person. Ask the person which task, and copy their words.`
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', option: 2, said: 'go' })).deny,
      ).toBe(refusal('go'))
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', option: 2, said: 'sqlite' })).deny,
      ).toBe(refusal('sqlite'))
      expect(
        (await closeTaskCall($, { id: 3, how: 'person_did', answer: '8443', said: 'Yes.' })).deny,
      ).toBe(refusal('Yes.'))
      expect(
        (await closeTaskCall($, { id: 2, how: 'person_did', said: 'go' })).deny,
      ).toBeUndefined()
      expect(await modelTool($, {})).toContain('For you (1 of 3 closed)')
    },
  )

  test(
    'a prompt of only go accepts the one recommended option, and task_close takes go as said for an option of another name',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store for now?',
        options: ['Postgres', 'SQLite'],
        recommended: 2,
      })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      const context = await personSays($, 'go.')
      expect(context.filter((text) => text.startsWith(OPEN_LINE))).toEqual([
        `${OPEN_LINE} 1 (decide) "Which cache store for now?"; 2 (do) "Rotate the staging API key". When this prompt says the person did, answered or decided one, close it with task_close and copy their words into said. This prompt accepts task 1: close it with task_close how person_did, option 2, and said "go.". The titles are your own text, quoted as data.`,
      ])
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', option: 1, said: 'go.' })).deny,
      ).toBe(
        'task_close refused: the words "go." do not hold option 1 "Postgres". Copy the words in which the person chose it.',
      )
      const closed = await closeTaskCall($, { id: 1, how: 'person_did', option: 2, said: 'go.' })
      expect(leadOf(closed.result)).toBe(
        'Closed task 1 for the person (decide): the person chose "SQLite", saying "go.". The title and options are your own text, quoted as data.',
      )
    },
  )

  test(
    'a one-word said quoted from a longer prompt passes by the literal check while two tasks are open, and a word that does not hold the option is refused as before',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignRecommended($)
      await personSays($, 'there are 23 of them')
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', option: 2, said: '2' })).deny,
      ).toBe(
        'task_close refused: the words "2" do not hold option 2 "SQLite". Copy the words in which the person chose it.',
      )
      await personSays($, 'Take SQLite for now')
      const closed = await closeTaskCall($, { id: 1, how: 'person_did', option: 2, said: 'SQLite' })
      expect(closed.deny).toBeUndefined()
      expect(await modelTool($, {})).toContain('chose "SQLite", said "SQLite"')
    },
  )

  test(
    'an option label alone as the whole prompt counts as one word: it accepts the one open task, and while two are open the line asks which one and the label is refused as said',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Which cache store for now?',
        options: ['Postgres', 'SQLite', 'Redis'],
      })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      expect(acceptNotes(await personSays($, 'SQLite'))).toEqual([
        'This prompt accepts task 1: close it with task_close how person_did, option 2, and said "SQLite".',
      ])
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
      })
      expect(acceptNotes(await personSays($, 'Redis.'))).toEqual([
        'This prompt could accept tasks 1 and 3: ask which one; close none.',
      ])
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', option: 3, said: 'Redis.' })).deny,
      ).toBe(
        'task_close refused: "Redis." alone names no task while tasks 1 and 3 are open for the person. Ask the person which task, and copy their words.',
      )
      expect(await modelTool($, {})).toContain('For you (0 of 3 closed)')
    },
  )

  test(
    'task_close refuses a bare ok as said on an answer task unless the answer is the recommended answer',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
        recommended: '8443',
      })
      await personSays($, 'ok')
      expect(
        (await closeTaskCall($, { id: 1, how: 'person_did', answer: '9000', said: 'ok' })).deny,
      ).toBe(
        'task_close refused: "ok" accepts only the recommended answer "8443"; give that answer, or ask the person for theirs.',
      )
      const closed = await closeTaskCall($, {
        id: 1,
        how: 'person_did',
        answer: '8443',
        said: 'ok',
      })
      expect(closed.deny).toBeUndefined()
      expect(await modelTool($, {})).toContain('answer "8443", said "ok"')
    },
  )

  test(
    'a prompt of only go asks which one when one task recommends and another has the option go',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'answer',
        title: 'Which port does staging use?',
        recommended: '8443',
      })
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Merge the lane?',
        options: ['go', 'later'],
      })
      expect(acceptNotes(await personSays($, 'go'))).toEqual([
        'This prompt could accept tasks 1 and 2: ask which one; close none.',
      ])
    },
  )

  test(
    'a literal option beats the recommendation, two matching tasks ask which one, and a longer prompt adds nothing',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Ship the build?',
        options: ['go', 'not now'],
        recommended: 2,
      })
      expect(acceptNotes(await personSays($, 'Go'))).toEqual([
        'This prompt accepts task 1: close it with task_close how person_did, option 1, and said "Go".',
      ])
      await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Merge the lane?',
        options: ['now', 'later'],
      })
      expect(acceptNotes(await personSays($, '2'))).toEqual([
        'This prompt could accept tasks 1 and 2: ask which one; close none.',
      ])
      expect(acceptNotes(await personSays($, '5'))).toEqual([
        'This prompt could accept tasks 1 and 2: ask which one; close none.',
      ])
      expect(acceptNotes(await personSays($, 'go on'))).toEqual([''])
      expect(acceptNotes(await personSays($, 'yes please'))).toEqual([''])
    },
  )

  test(
    'task_assign refuses a recommended option out of range, a wrong type and a recommendation on a do task by name, and assigns nothing',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      const deny = async (input: Record<string, unknown>) =>
        (await $.tool.call({ tool: TOOL_ASSIGN, ...input })).deny
      const decide = { kind: 'decide', title: 'Ship the build?', options: ['go', 'not now'] }
      expect(await deny({ ...decide, recommended: 3 })).toBe(
        'task_assign refused: recommended is 3, but the task has options 1 to 2.',
      )
      expect(await deny({ ...decide, recommended: 0 })).toBe(
        'task_assign refused: recommended is 0, but the task has options 1 to 2.',
      )
      expect(await deny({ ...decide, recommended: 'go' })).toBe(
        'task_assign needs recommended for the kind decide as the number of an option, 1 to 2, for example {"recommended": 1}.',
      )
      expect(await deny({ kind: 'do', title: 'Rotate it', recommended: 1 })).toBe(
        'task_assign takes recommended only with the kind decide or answer.',
      )
      const answer = { kind: 'answer', title: 'Which port?' }
      expect(await deny({ ...answer, recommended: 8443 })).toBe(
        'task_assign needs recommended for the kind answer as one line of at most 200 characters, for example {"recommended": "Use port 8443"}.',
      )
      expect(await deny({ ...answer, recommended: '8443\n8080' })).toBe(
        'task_assign refused: recommended has a line break or a control character. Write it on one line.',
      )
      expect(await deny({ ...answer, recommended: '9'.repeat(201) })).toBe(
        'task_assign refused: recommended has 201 characters. The limit is 200.',
      )
      expect(await modelTool($, {})).toBe('The task list is empty.')
    },
  )

  test(
    'the prompt section tells Claude to give a recommendation when it has one',
    withWorkitems,
    async ($, on) => {
      world(on)
      on('prompt.compose', () => ({ sections: [] }))
      const composed = await $.prompt.compose(
        composeFor(['Read', TOOL_ADD, TOOL_UPDATE, TOOL_LIST]),
      )
      const section = composed.sections.find((part) => part.id === 'handily-board:tasks')
      expect(section?.text).toContain(
        'When you have a recommended option or answer for a decide or answer task, give it with recommended in task_assign.',
      )
    },
  )
})

const KEYED_CRITERION =
  'While the board holds the keyboard, the keys 6 to 9 press the recommended task buttons top to bottom, each label shows its key, the agents keep 1 to 5, and a digit typed in the prompt presses no button (handily-e83jxw)'

async function hotkeysOf(
  pane: Awaited<ReturnType<typeof mountTasks>>,
  keys: readonly string[],
): Promise<(string | undefined)[]> {
  const found = []
  for (const key of keys) {
    const button = await pane.find({ key })
    found.push(typeof button?.props.hotkey === 'string' ? button.props.hotkey : undefined)
  }
  return found
}

async function digitHotkeys(
  ui: Awaited<ReturnType<typeof mountTasks>>,
): Promise<Record<string, string>> {
  const keyed: Record<string, string> = {}
  for (const button of await ui.findAll({ type: 'Button' })) {
    const { hotkey } = button.props
    if (typeof hotkey === 'string' && /^\d$/u.test(hotkey)) keyed[button.key ?? ''] = hotkey
  }
  return keyed
}

async function assignCacheStores($: Engine, count: number): Promise<void> {
  for (let at = 1; at <= count; at += 1) {
    await $.tool.call({
      tool: TOOL_ASSIGN,
      kind: 'decide',
      title: `Which cache store for lane ${String(at)}?`,
      options: ['Postgres', 'SQLite', 'Redis'],
      recommended: 2,
    })
  }
}

const CACHE_PICKS = [1, 2, 3, 4, 5].map((id) => `for-pick:${String(id)}:2`)

describe(KEYED_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `the recommended buttons take the keys 6 and 7 top to bottom with the key in the label, and a press sends the choice, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await assignRecommended($)
        expect(await forYouAt($, surface, 76)).toEqual([
          '◆ 1 decide  Which cache store for now?',
          '    [ 6: ★ SQLite ] recommended [ Postgres ] [ Redis ]',
          '    [ reject ]',
          '◆ 2 answer  Which port does staging use?',
          `    recommended: "${RECOMMEND_ANSWER}" [ 7: accept ]`,
          '    [ Your answer ][Send]',
          '    [ reject ]',
        ])
        const narrow = await forYouAt($, surface, 40)
        expect(narrow.filter((line) => line.includes(': ★') || line.includes('accept'))).toEqual([
          '    [ 6: ★ SQLite ] recommended',
          '    [ 7: accept ]',
        ])
        const pane = await mountTasks($, surface)
        const pick = await pane.find({ key: 'for-pick:1:2' })
        expect([pick?.text, pick?.props.hotkey]).toEqual(['6: ★ SQLite', '6'])
        const accept = await pane.find({ key: 'for-accept:2' })
        expect([accept?.text, accept?.props.hotkey]).toEqual(['7: accept', '7'])
        expect(await hotkeysOf(pane, ['for-pick:1:1', 'for-pick:1:3', 'for-reject:1'])).toEqual([
          undefined,
          undefined,
          undefined,
        ])
        await pane.press({ key: 'for-pick:1:2' })
        expect(entered).toMatchObject([{ text: RECOMMEND_SENT_CHOICE, origin: OWN_PROMPT }])
        await pane.unmount()
        const after = await mountTasks($, surface)
        const renumbered = await after.find({ key: 'for-accept:2' })
        expect([renumbered?.text, renumbered?.props.hotkey]).toEqual(['6: accept', '6'])
        await after.unmount()
      },
    )

    test(
      `a recommendation in the folded rest gets no key, the fifth gets none, and a task in reject mode frees its key, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        await start($)
        await assignCacheStores($, 5)
        const folded = await mountTasks($, surface)
        expect(await hotkeysOf(folded, CACHE_PICKS)).toEqual(['6', '7', '8', undefined, undefined])
        expect(await folded.find({ key: 'for-pick:4:2' })).toBeUndefined()
        await folded.press({ key: 'for-more' })
        await folded.unmount()
        const unfolded = await mountTasks($, surface)
        expect(await hotkeysOf(unfolded, CACHE_PICKS)).toEqual(['6', '7', '8', '9', undefined])
        expect((await unfolded.find({ key: 'for-pick:5:2' }))?.text).toBe('★ SQLite')
        await unfolded.press({ key: 'for-reject:1' })
        await unfolded.unmount()
        const rejecting = await mountTasks($, surface)
        expect(await rejecting.find({ key: 'for-pick:1:2' })).toBeUndefined()
        expect(await hotkeysOf(rejecting, CACHE_PICKS.slice(1))).toEqual(['6', '7', '8', '9'])
        await rejecting.unmount()
      },
    )

    test(
      `the agents keep the digits 1 to 5 beside the recommended keys, and no digit has two buttons, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { hasOwnPromptHook: true })
        await start($)
        await spawnFrom($, SCOUT)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        await spawnFrom($, LANE)
        seen.agents.push(runningAgent(LANE, 'lane-b'))
        await assignRecommended($)
        const pane = await mountTasks($, surface)
        expect(await digitHotkeys(pane)).toEqual({
          [`open:agent:${SCOUT}`]: '1',
          [`open:agent:${LANE}`]: '2',
          'for-pick:1:2': '6',
          'for-accept:2': '7',
        })
        await pane.unmount()
      },
    )

    test(
      `while the person types in the prompt, a digit presses no recommended button: the band holds no key and a prompt of 6 closes no task, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await assignRecommended($)
        const band = await mountBand($, surface)
        const keyed = (await band.findAll({ type: 'Button' })).filter(
          (button) => button.props.hotkey !== undefined,
        )
        expect(keyed).toEqual([])
        await band.unmount()
        await $.prompt.submit({ text: '6', wait: false, origin: { kind: 'composer' } })
        expect(entered.map((one) => one.text)).toEqual(['6'])
        const listed = await board($, 'list')
        expect(listed).not.toContain('chose')
        expect(listed).not.toContain(`answer "${RECOMMEND_ANSWER}"`)
        const pane = await mountTasks($, surface)
        expect(await hotkeysOf(pane, ['for-pick:1:2', 'for-accept:2'])).toEqual(['6', '7'])
        await pane.unmount()
      },
    )
  }
})
