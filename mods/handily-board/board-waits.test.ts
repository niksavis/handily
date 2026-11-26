import type { On, TelemetryRecordEntry, UiNotifyResult } from 'claude-code'
import { describe, expect, test, type Engine, type Mounted, type Plugin } from 'claude-code/testing'
import { NEEDS_YOU_AFTER_MS } from './hooks/agents'
import { statusLineSetting } from './hooks/attention'
import type { TaskHost } from './hooks/commands'
import { type PlanHost, addPlanAsTasks } from './hooks/plan'
import {
  expectEngineRow,
  ROOT,
  PANE,
  PLUGIN,
  TOOL_ADD,
  TOOL_UPDATE,
  TOOL_MOVE,
  fakeWorkitems,
  type World,
  type PlanAnswer,
  world,
  start,
  board,
  modelTool,
  paneProps,
  CHANGED,
  toldAtNextPrompt,
  withWorkitems,
  MACHINE,
  SESSION_OPEN,
  type Drawn,
  drawnOf,
  texts,
  rowOf,
  MINUTE,
  START,
  screen,
  unframed,
  bySurface,
  fromTasks,
  edit,
  SURFACES,
  type Surface,
  withToolIds,
  engineRows,
  mockWork,
  mountTab,
  fiveTasks,
  order,
  measure,
  mainTurnStarts,
  mainTurnEnds,
  sessionLine,
  limitsAt,
  spawnFrom,
  mainTurnTakes,
  compacts,
  stepped,
  stepWorld,
  step,
  SCOUT,
  LANE,
  EXPLORE,
  CLASSIFIED_COMMAND,
  SCOUT_WAITS,
  type PersonDialog,
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
  PLAN_TEXT,
  APPROVED_PLAN,
  planOf,
  approve,
  mountPlanRow,
  mountTasks,
  planLine,
  TOOL_ASSIGN,
  TOOL_CLOSE,
  ANSWERED,
  OPEN_LINE,
  openTasksNote,
  BOARD_NOTE,
  assignFour,
  notesAtNextPrompt,
  OWN_PROMPT,
  enteredPrompts,
  forYouLines,
  joinedWords,
  ASKED_TITLE,
  ASKED_OPTIONS,
} from './fixtures/board-kit'

const STATUS_WAIT_CRITERION =
  'When a subagent waits for permission and the this session tab is not shown, the status line names the agent and the tool'
const STATUS_CLEAR_CRITERION =
  'When nothing waits and the context is under 80 percent, the board clears its status line'
const STATUS_OFF_CRITERION =
  'When the setting statusLine is off, the board never sets a status line'
const STATUS_FACTS_CRITERION =
  'The board shows the session state and every wait from engine facts only'
const STATUS_NO_CONTEXT_CRITERION =
  'When the context is 80 percent or more and nothing waits, the board sets no status line.'
const STATUS_WAIT_ONLY_CRITERION =
  'When a subagent waits for permission, the status line names the agent and the tool and says nothing about the context.'
const PANE_STILL_HIGH_CRITERION =
  'When the context is high, the board pane still shows the word high on its Session line.'

const CLASSIFIER_MS = 600

type Settling = { decision: 'accept' | 'reject'; source: string; mode: 'default' | 'auto' }

const PERSON_ALLOWS: Settling = { decision: 'accept', source: 'user_temporary', mode: 'default' }
const PERSON_REFUSES: Settling = { decision: 'reject', source: 'user_reject', mode: 'default' }
const CLASSIFIER_ALLOWS: Settling = { decision: 'accept', source: 'config', mode: 'auto' }

function decisionRecord(callId: string, settling: Settling): TelemetryRecordEntry {
  return {
    to: 'collector',
    event: 'tool_decision',
    attributes: {
      tool_use_id: callId,
      decision: settling.decision,
      source: settling.source,
      permission_mode: settling.mode,
    },
    loggedAt: '2026-11-04T10:00:00.000Z',
  }
}

async function settles(
  $: Engine,
  dialog: PersonDialog,
  command: string,
  settling: Settling,
): Promise<void> {
  await $.telemetry.log(decisionRecord(dialog.callOf(command), settling))
}

async function classifierAllows($: Engine, dialog: PersonDialog): Promise<void> {
  await settles($, dialog, CLASSIFIED_COMMAND, CLASSIFIER_ALLOWS)
  dialog.allow()
}

for (const surface of SURFACES) {
  describe(STATUS_WAIT_ONLY_CRITERION, () => {
    test(
      `an ask unsettled for 3 s names the agent and the tool, as mock 8.10p, and a high context adds nothing, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS - 1)
        expect(seen.statuses).toEqual([])
        await seen.clock.advance(1)
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        await measure($, { percent: 91, usd: 12.4 })
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        dialog.allow()
        await call
      },
    )

    test(
      `two waiting agents are counted, and the line names the one left when the other is refused, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        await measure($, { percent: 91, usd: 12.4 })
        seen.agents.push(runningAgent(SCOUT, 'scout'), runningAgent(LANE, 'lane-b'))
        const scout = askAs($, SCOUT, 'npm test')
        const lane = askAs($, LANE, 'npm run lint')
        await dialog.opened(2)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual(['◆ 2 agents wait for permission'])
        dialog.refuse()
        expect((await scout).isError).toBe(true)
        expect(seen.statuses).toEqual([
          '◆ 2 agents wait for permission',
          '◆ lane-b waits for permission: Bash npm run lint',
        ])
        dialog.allow()
        await lane
      },
    )
  })

  describe(STATUS_WAIT_CRITERION, () => {
    test(
      `a shown this session tab holds the line clear, and the line comes back when the board closes, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        expect(await board($, '')).toBe('Board opened: this session.')
        const { call } = await scoutWaits($, seen, dialog)
        expect(seen.statuses).toEqual([])
        expect(await board($, 'close')).toBe('Board closed.')
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        expect(await board($, '')).toBe('Board opened: this session.')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined])
        await ui.unmount()
        expect(await board($, 'machine')).toBe('Board opened: this machine.')
        await seen.clock.advance(10_000)
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined, SCOUT_WAITS])
        dialog.allow()
        await call
      },
    )
  })

  describe(STATUS_CLEAR_CRITERION, () => {
    test(
      `the line clears when the call runs and when the turn of the agent ends, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        const { call: first } = await scoutWaits($, seen, dialog)
        dialog.allow()
        await first
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined])
        const second = askAs($, SCOUT, 'npm test')
        await dialog.opened(2)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses.at(-1)).toBe(SCOUT_WAITS)
        await $.turn.complete({
          turnId: 'scout-turn',
          reason: 'answer',
          answer: 'done',
          durationMs: 1,
          isAborted: false,
          agentId: SCOUT,
        })
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined, SCOUT_WAITS, undefined])
        dialog.allow()
        await second
      },
    )

    test(
      `a session with nothing to say never sets the line, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await measure($, { percent: 62, usd: 4.18 })
        await mainTurnStarts($, 'turn-1')
        await measure($, { percent: 79, usd: 4.49 })
        await mainTurnEnds($, 'turn-1')
        expect(seen.statuses).toEqual([])
      },
    )
  })

  describe(STATUS_OFF_CRITERION, () => {
    test(
      `with statusLine off, a wait and a high context set no line, while the tab still draws the wait, on ${surface}`,
      { ...withWorkitems, options: { statusLine: 'off' } },
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        await measure($, { percent: 91, usd: 12.4 })
        const { call } = await scoutWaits($, seen, dialog)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(unframed(await screen(ui, 41))[0]).toBe('Session  ◆ 1 waits · ○ idle')
        await ui.unmount()
        dialog.allow()
        await call
        expect(seen.statuses).toEqual([])
      },
    )
  })

  describe(STATUS_FACTS_CRITERION, () => {
    test(
      `the line names only the ask a person must answer, not an agent that the list calls waiting or a classifier ask settled in 0.6 s, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const run = holdCommand(on, CLASSIFIED_COMMAND)
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(
          { ...runningAgent(EXPLORE, 'held'), status: 'waiting' },
          runningAgent(SCOUT, 'scout'),
          runningAgent(LANE, 'lane-b'),
        )
        const classified = askAs($, SCOUT, CLASSIFIED_COMMAND)
        await dialog.opened(1)
        await seen.clock.advance(CLASSIFIER_MS / 2)
        await measure($, { percent: 91, usd: 12.4 })
        await seen.clock.advance(CLASSIFIER_MS / 2)
        await classifierAllows($, dialog)
        const lane = askAs($, LANE, 'npm run lint')
        await dialog.opened(2)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.statuses).toEqual(['◆ lane-b waits for permission: Bash npm run lint'])
        run.release()
        expect(await classified).toEqual({ result: '' })
        dialog.allow()
        await lane
      },
    )
  })

  describe(STATUS_NO_CONTEXT_CRITERION, () => {
    test(
      `a context at 80 and 91 percent with nothing waiting sets no line, before a wait and after it settles, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        await measure($, { percent: 80, usd: 12.4 })
        await measure($, { percent: 91, usd: 12.4 })
        expect(seen.statuses).toEqual([])
        const { call } = await scoutWaits($, seen, dialog)
        dialog.allow()
        await call
        await measure($, { percent: 95, usd: 12.4 })
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined])
      },
    )
  })

  describe(PANE_STILL_HIGH_CRITERION, () => {
    test(
      `at 91 percent the Session line of the tab says high while the status line stays unset, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await measure($, { percent: 91, usd: 12.4 })
        expect(seen.statuses).toEqual([])
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          'ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k · $12.40',
        )
        expect(seen.statuses).toEqual([])
      },
    )
  })
}

test('the board refuses a statusLine setting it does not know, by name', () => {
  expect(statusLineSetting({})).toBe('attention')
  expect(statusLineSetting({ statusLine: 'off' })).toBe('off')
  expect(() => statusLineSetting({ statusLine: 'sometimes' })).toThrow(
    'handily-board: userConfig statusLine is "sometimes"; set it to attention or off in /config.',
  )
})

const NOTICE_CRITERION =
  'When a permission ask of this session stays unsettled for the needs-you delay, the board sends one notice through $.ui.notify that names the session and the tool'
const NOTICE_TOAST_CRITERION =
  'When $.ui.notify reports that it sent nothing, the board shows a toast in its place'

const SCOUT_NOTICE = 'app needs you: scout waits for permission: Bash npm test'
const MAIN_NOTICE = 'app needs you: Claude waits for permission: Bash npm test'

for (const surface of SURFACES) {
  describe(NOTICE_CRITERION, () => {
    test(
      `a subagent ask unsettled for 3 s sends one notice with the session, the agent and the tool, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS - 1)
        expect(seen.notices).toEqual([])
        await seen.clock.advance(1)
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        await seen.clock.advance(10 * MINUTE)
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        expect(seen.toasts).toEqual([])
        dialog.allow()
        await call
      },
    )

    test(
      `an ask of the main loop unsettled for 3 s sends one notice that names Claude, and the next wait sends its own, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        const first = $.tool.call({ tool: 'Bash', command: 'npm test' })
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.notices).toEqual([MAIN_NOTICE])
        dialog.allow()
        await first
        const second = $.tool.call({ tool: 'Bash', command: 'npm run lint' })
        await dialog.opened(2)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.notices).toEqual([
          MAIN_NOTICE,
          'app needs you: Claude waits for permission: Bash npm run lint',
        ])
        dialog.refuse()
        await second
      },
    )

    test(
      `an ask settled before 3 s, a classifier ask and a wait while the this session tab is shown send no notice, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const run = holdCommand(on, CLASSIFIED_COMMAND)
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const quick = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS - 1)
        dialog.allow()
        await quick
        const classified = $.tool.call({ tool: 'Bash', command: CLASSIFIED_COMMAND })
        await dialog.opened(2)
        await seen.clock.advance(CLASSIFIER_MS)
        await classifierAllows($, dialog)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.notices).toEqual([])
        run.release()
        expect(await classified).toEqual({ result: '' })
        expect(await board($, '')).toBe('Board opened: this session.')
        const shown = askAs($, SCOUT, 'npm test')
        await dialog.opened(3)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.notices).toEqual([])
        dialog.allow()
        await shown
        expect(await board($, 'close')).toBe('Board closed.')
        const away = askAs($, SCOUT, 'npm run lint')
        await dialog.opened(4)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.notices).toEqual([
          'app needs you: scout waits for permission: Bash npm run lint',
        ])
        dialog.allow()
        await away
      },
    )
  })

  describe(NOTICE_TOAST_CRITERION, () => {
    const unsent: readonly { name: string; notice: UiNotifyResult | 'denied' }[] = [
      { name: 'a notice with no surface', notice: { isSent: false, reason: 'no-surface' } },
      { name: 'a turned off notice', notice: { isSent: false, reason: 'disabled' } },
      { name: 'a notice a hook refused', notice: 'denied' },
    ]
    for (const { name, notice } of unsent) {
      test(
        `${name} shows the wait once as a toast, on ${surface}`,
        withWorkitems,
        async ($, on) => {
          const seen = world(on, { notice })
          const dialog = personDialog(on)
          await startOn($, surface)
          seen.agents.push(runningAgent(SCOUT, 'scout'))
          const call = askAs($, SCOUT, 'npm test')
          await dialog.opened(1)
          await seen.clock.advance(NEEDS_YOU_AFTER_MS)
          await seen.clock.advance(10 * MINUTE)
          expect(seen.notices).toEqual([SCOUT_NOTICE])
          expect(seen.toasts).toEqual([
            ['◆ app needs you', 'scout waits for permission', 'Bash npm test'],
          ])
          expect(seen.toastMs).toEqual([10000])
          dialog.allow()
          await call
        },
      )
    }
  })
}

const ASK_KIND_CRITERION =
  'When an AskUserQuestion or ExitPlanMode ask waits, the attention notice and the status line use the kind of askSight (question or waits) and never the word permission'

const REGION_QUESTION = {
  tool: 'AskUserQuestion' as const,
  questions: [
    {
      question: 'Which region?',
      header: 'Region',
      options: [
        { label: 'eu', description: 'Europe' },
        { label: 'us', description: 'America' },
      ],
      multiSelect: false,
    },
  ],
}

for (const surface of SURFACES) {
  describe(ASK_KIND_CRITERION, () => {
    test(
      `a question of the main loop sends a notice and a toast that say asks a question with the question, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { notice: { isSent: false, reason: 'disabled' } })
        const dialog = personDialog(on)
        await startOn($, surface)
        const call = $.tool.call(REGION_QUESTION)
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.notices).toEqual(['app needs you: Claude asks a question: Which region?'])
        expect(seen.toasts).toEqual([
          ['◆ app needs you', 'Claude asks a question', 'Which region?'],
        ])
        dialog.allow()
        await call
      },
    )

    test(
      `a plan approval of the main loop sends a notice that says waits with ExitPlanMode, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        const call = $.tool.call({ tool: 'ExitPlanMode' })
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.notices).toEqual(['app needs you: Claude waits: ExitPlanMode'])
        dialog.refuse()
        await call
      },
    )

    test(
      `a subagent question sets a status line that says asks a question, and a question with a plan approval reads 2 agents wait for you, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'), runningAgent(LANE, 'lane-b'))
        const question = $.tool.call({ ...REGION_QUESTION, agentId: SCOUT })
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual(['◆ scout asks a question: Which region?'])
        expect(seen.notices).toEqual(['app needs you: scout asks a question: Which region?'])
        const plan = $.tool.call({ tool: 'ExitPlanMode', agentId: LANE })
        await dialog.opened(2)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses.at(-1)).toBe('◆ 2 agents wait for you')
        expect(seen.notices.at(-1)).toBe('app needs you: lane-b waits: ExitPlanMode')
        expect([...seen.statuses, ...seen.notices].join('\n')).not.toContain('permission')
        dialog.allow()
        dialog.allow()
        await question
        await plan
      },
    )
  })
}

const SETTLED_CRITERION =
  'When the engine records tool_decision for a call that the board holds as asked, the board forgets that ask at once, on the main loop and for an agent'
const RECORD_PASSES_CRITERION =
  'When the telemetry hook runs, it returns the record unchanged to the collector, and a record of another kind changes nothing on the board'

const LANE_WAITS = '◆ lane-b waits for permission: Bash npm run lint'
const LANE_NOTICE = 'app needs you: lane-b waits for permission: Bash npm run lint'

function otherRecord(callId: string): TelemetryRecordEntry {
  return {
    to: 'collector',
    event: 'tool_result',
    attributes: { tool_use_id: callId, success: true },
    loggedAt: '2026-11-04T10:00:01.000Z',
  }
}

const FORGE_COMMAND = 'forge-decision'

const decisionForger: Plugin = {
  name: 'decision-forger',
  register(on) {
    on('command.run', { command: 'forge-decision' }, async ($, e) => {
      await $.telemetry.log({
        to: 'collector',
        event: 'tool_decision',
        attributes: {
          tool_use_id: e.args,
          decision: 'accept',
          source: 'user_temporary',
          permission_mode: 'default',
        },
        loggedAt: '2026-11-04T10:00:00.000Z',
      })
      return { text: 'forged' }
    })
  },
}

async function forgeDecision($: Engine, callId: string): Promise<string | undefined> {
  const result = await $.command.run({
    command: FORGE_COMMAND,
    args: callId,
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return result.text
}

for (const surface of SURFACES) {
  describe(SETTLED_CRITERION, () => {
    test(
      `an ask of the main loop that the person allows in 1 s sends no notice while the call runs past 3 s, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const run = holdCommand(on, 'npm test')
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        const call = $.tool.call({ tool: 'Bash', command: 'npm test' })
        await dialog.opened(1)
        await seen.clock.advance(1_000)
        await settles($, dialog, 'npm test', PERSON_ALLOWS)
        dialog.allow()
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.notices).toEqual([])
        expect(seen.toasts).toEqual([])
        run.release()
        expect(await call).toEqual({ result: '' })
      },
    )

    test(
      `a subagent decision before the 3 s timer leaves the timer no ask, so it sets no status line and sends no notice while the call runs, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const run = holdCommand(on, 'npm test')
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(1_000)
        await settles($, dialog, 'npm test', PERSON_ALLOWS)
        dialog.allow()
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.statuses).toEqual([])
        expect(seen.notices).toEqual([])
        run.release()
        expect(await call).toEqual({ result: '' })
      },
    )

    test(
      `a refusal that the engine records clears the ask before the call ends, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(1_000)
        await settles($, dialog, 'npm test', PERSON_REFUSES)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS * 2)
        expect(seen.statuses).toEqual([])
        expect(seen.notices).toEqual([])
        dialog.refuse()
        expect((await call).isError).toBe(true)
      },
    )

    test(
      `a decision about a call that the board does not hold keeps the wait, the status line and the notice, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await $.telemetry.log(decisionRecord('toolu_not_held', PERSON_ALLOWS))
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        dialog.allow()
        await call
      },
    )

    test(
      `of two waiting agents, a decision clears only the ask of its own call, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'), runningAgent(LANE, 'lane-b'))
        const scout = askAs($, SCOUT, 'npm test')
        const lane = askAs($, LANE, 'npm run lint')
        await dialog.opened(2)
        await settles($, dialog, 'npm test', PERSON_ALLOWS)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual([LANE_WAITS])
        expect(seen.notices).toEqual([LANE_NOTICE])
        dialog.allow()
        dialog.allow()
        await Promise.all([scout, lane])
      },
    )
  })

  describe(RECORD_PASSES_CRITERION, () => {
    test(
      `the collector gets each record unchanged, a record of another kind keeps the wait, and a late decision clears the shown wait, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        const callId = dialog.callOf('npm test')
        await $.telemetry.log(otherRecord(callId))
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        await $.telemetry.log(decisionRecord(callId, PERSON_ALLOWS))
        expect(seen.statuses).toEqual([SCOUT_WAITS, undefined])
        expect(seen.collected).toEqual([otherRecord(callId), decisionRecord(callId, PERSON_ALLOWS)])
        dialog.allow()
        await call
      },
    )
  })

  describe(SETTLED_CRITERION, () => {
    test(
      `a tool_decision that a plugin logs keeps the wait, the status line and the notice, on ${surface}`,
      { plugins: [fakeWorkitems, decisionForger] },
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, 'scout'))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        const callId = dialog.callOf('npm test')
        expect(await forgeDecision($, callId)).toBe('forged')
        expect(seen.collected).toEqual([decisionRecord(callId, PERSON_ALLOWS)])
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(unframed(await screen(ui, 41))[0]).toBe('Session  ◆ 1 waits · ○ idle')
        await ui.unmount()
        dialog.allow()
        await call
      },
    )
  })
}

const UNPLACED_CRITERION =
  'When the this session tab is opened but waits undrawn, the person sees no board, so the status line and the notice still name the wait'

const NOTICE_ESCAPE_CRITERION =
  'A folder name or an agent name with a control character or a bidi control reaches the status line and the notice escaped'

const HOSTILE_FOLDER = `${ROOT}/ev\u202eil\u001b]0;x\u0007`
const HOSTILE_AGENT = 'sc\u0007out'
const CONTROL_BELOW = 0x20
const DELETE = 0x7f
const BIDI_RANGES: readonly (readonly [number, number])[] = [
  [0x202a, 0x202e],
  [0x2066, 0x2069],
]

function hasRawControl(text: string): boolean {
  return Array.from(text).some((character) => {
    const code = character.codePointAt(0) ?? 0
    const isBidi = BIDI_RANGES.some(([first, last]) => code >= first && code <= last)
    return code < CONTROL_BELOW || code === DELETE || isBidi
  })
}

for (const surface of SURFACES) {
  describe(UNPLACED_CRITERION, () => {
    test(
      `with mode always on a narrow terminal, the board waits undrawn and a wait still sets the status line and sends the notice, on ${surface}`,
      { ...withWorkitems, options: { mode: 'always' } },
      async ($, on) => {
        const seen = world(on, { unplacedReason: 'the terminal is 120 columns wide' })
        const dialog = personDialog(on)
        await startOn($, surface)
        expect(seen.opened).toContain(PANE)
        const { call } = await scoutWaits($, seen, dialog)
        expect(seen.statuses).toEqual([SCOUT_WAITS])
        expect(seen.notices).toEqual([SCOUT_NOTICE])
        dialog.allow()
        await call
      },
    )
  })

  describe(NOTICE_ESCAPE_CRITERION, () => {
    test(
      `the notice and the status line escape the folder and the agent name, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { cwd: HOSTILE_FOLDER })
        const dialog = personDialog(on)
        await startOn($, surface)
        seen.agents.push(runningAgent(SCOUT, HOSTILE_AGENT))
        const call = askAs($, SCOUT, 'npm test')
        await dialog.opened(1)
        await seen.clock.advance(NEEDS_YOU_AFTER_MS)
        const shown = [...seen.notices, ...seen.statuses.filter((text) => text !== undefined)]
        expect(shown).toHaveLength(2)
        for (const text of shown) expect(hasRawControl(text), text).toBe(false)
        expect(seen.notices).toEqual([
          'ev\\u202eil\\u001b]0;x\\u0007 needs you: sc\\u…7out waits for permission: Bash npm test',
        ])
        expect(seen.statuses).toEqual(['◆ sc\\u…7out waits for permission: Bash npm test'])
        dialog.allow()
        await call
      },
    )
  })
}

const SLOW_CRITERION =
  'When a subagent call has run for more than 30 seconds, its state reads slow with the time of that call.'
const QUIET_CRITERION =
  'When a running subagent has had no event for 2 minutes, its state reads quiet with the time since its last event.'
const NO_TIMER_CRITERION = 'When no board tab is shown, no timer runs for these states.'

async function exploreRuns($: Engine, seen: World, surface: Surface): Promise<void> {
  await startOn($, surface)
  await seen.clock.set(START)
  await spawnFrom($, EXPLORE)
  seen.agents.push(runningAgent(EXPLORE, 'Explore'))
}

const EXPLORE_ROW = /^(?:\d: )?[▶○] Explore /u
const CARD_STATE_LINE = 'cards:2'

type ExploreRow = { line: string; state: Drawn | undefined; lines: string[] }

async function exploreOn(ui: { find: Mounted['find'] }): Promise<ExploreRow> {
  const lines = unframed(await screen(ui, 41))
  const row = drawnOf(await ui.find({ key: `row:agent:${EXPLORE}` }))
  if (row !== null) {
    return { line: lines.find((one) => EXPLORE_ROW.test(one)) ?? '', state: texts(row)[2], lines }
  }
  const card = drawnOf(await ui.find({ key: CARD_STATE_LINE }))
  const state = card === null ? undefined : texts(card)[1]
  return { line: state?.text ?? '', state, lines }
}

async function exploreRow($: Engine, surface: Surface): Promise<ExploreRow> {
  const ui = await mountTab($, surface, PANE, 'dock', 41)
  const shown = await exploreOn(ui)
  await ui.unmount()
  return shown
}

const timerSpy: Plugin = {
  name: 'timer-spy',
  register(on) {
    const waits: number[] = []
    on('clock.every', (_$, e, next) => {
      waits.push(e.ms)
      return next(e)
    })
    on('clock.after', (_$, e, next) => {
      if (e.ms > 0) waits.push(e.ms)
      return next(e)
    })
    on('command.run', { command: 'timer-waits' }, () => ({ text: JSON.stringify(waits) }))
  },
}

async function timerWaits($: Engine): Promise<number[]> {
  const result = await $.command.run({
    command: 'timer-waits',
    args: '',
    origin: { kind: 'sdk' },
    presentation: { isFullscreen: false, columns: 80 },
  })
  return JSON.parse(result.text ?? '[]') as number[]
}

async function exploreLine($: Engine, surface: Surface): Promise<string> {
  return (await exploreRow($, surface)).line
}

for (const surface of SURFACES) {
  describe(SLOW_CRITERION, () => {
    test(
      `a call past 30 s reads slow with its time in the warning colour, as mock 8.10f, and the mark stays, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        await exploreRuns($, seen, surface)
        await seen.clock.advance(3 * MINUTE - 45_000)
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.advance(30_000)
        expect(await exploreLine($, surface)).toBe(
          bySurface(surface, 'running', '1: ▶ Explore   running   ▸ Bash… open  2m'),
        )
        await seen.clock.advance(15_000)
        const slow = await exploreRow($, surface)
        expect(slow.line).toBe(
          bySurface(surface, 'slow 45s', '1: ▶ Explore   slow 45s  ▸ Bash… open  3m'),
        )
        expect(slow.state?.text).toBe('slow 45s')
        expect(slow.state?.props.color).toBe('warning')
        held.release()
        await call
        expect(await exploreLine($, surface)).toBe(
          bySurface(surface, 'running', '1: ▶ Explore   running   Bash n… open  3m'),
        )
      },
    )

    test(
      `a slow call reads slow before quiet, and a plan of the agent does not hide it, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        await exploreRuns($, seen, surface)
        await $.tool.call({ tool: TOOL_ADD, title: 'Check the build', agentId: EXPLORE })
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.advance(3 * MINUTE)
        expect(await exploreLine($, surface)).toBe(
          bySurface(surface, 'slow 3m', '1: ▶ Explore   slow 3m   ▸ Bash… open  3m'),
        )
        held.release()
        await call
        expect(await exploreLine($, surface)).toContain('plan 0/1')
      },
    )
  })

  describe(QUIET_CRITERION, () => {
    test(
      `a running agent with no event for 2 minutes reads quiet with that time, as mock 8.10f, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await exploreRuns($, seen, surface)
        await seen.clock.advance(3 * MINUTE)
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
        await seen.clock.advance(2 * MINUTE - 1)
        expect(await exploreLine($, surface)).toBe(
          bySurface(surface, 'running', '1: ▶ Explore   running   Read s… open  4m'),
        )
        await seen.clock.advance(1)
        const quiet = await exploreRow($, surface)
        expect(quiet.line).toBe(
          bySurface(surface, 'quiet 2m', '1: ▶ Explore   quiet 2m  Read s… open  5m'),
        )
        expect(quiet.state?.props.color).toBe('warning')
        await seen.clock.advance(MINUTE)
        expect(await exploreLine($, surface)).toBe(
          bySurface(surface, 'quiet 3m', '1: ▶ Explore   quiet 3m  Read s… open  6m'),
        )
      },
    )

    test(
      `a step or a tool call of the agent ends the quiet, and an agent that no longer runs is never quiet, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const steps = stepWorld(on)
        await exploreRuns($, seen, surface)
        await seen.clock.advance(3 * MINUTE)
        expect(await exploreLine($, surface)).toContain('quiet 3m')
        await step($, steps, EXPLORE, stepped('turn-1', null, 'tool_use'))
        expect(await exploreLine($, surface)).toContain('running')
        await seen.clock.advance(3 * MINUTE)
        expect(await exploreLine($, surface)).toContain('quiet 3m')
        await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
        expect(await exploreLine($, surface)).toContain('running')
        await seen.clock.advance(3 * MINUTE)
        seen.agents[0] = { ...runningAgent(EXPLORE, 'Explore'), status: 'idle' }
        const idle = await exploreRow($, surface)
        expect(idle.line).toBe(
          bySurface(surface, 'idle', '1: ○ Explore   idle      Read src/a.…  9m'),
        )
        expect(idle.lines.join('\n')).not.toContain('quiet')
      },
    )
  })

  describe(NO_TIMER_CRITERION, () => {
    test(
      `no timer runs while no board tab is shown, and the 10 s redraw of a shown tab moves the time, on ${surface}`,
      { plugins: [fakeWorkitems, timerSpy] },
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        await exploreRuns($, seen, surface)
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.advance(35_000)
        expect(await timerWaits($)).toEqual([])
        expect(await board($, '')).toBe('Board opened: this session.')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        const row = async () => (await exploreOn(ui)).line
        expect(await row()).toContain('slow 35s')
        await seen.clock.advance(10_000)
        expect(await row()).toContain('slow 45s')
        const shown = await timerWaits($)
        expect(shown).toContain(10_000)
        await ui.unmount()
        expect(await board($, 'close')).toBe('Board closed.')
        await seen.clock.advance(3 * MINUTE)
        expect(await timerWaits($)).toEqual(shown)
        held.release()
        await call
      },
    )
  })
}

const LANES_CRITERION =
  'When the body is 80 columns or wider, each agent row shows its ctx and a lane on one axis from the first spawn to now, which ends in the wait or failure mark.'
const NARROW_ROWS_CRITERION =
  'When the body is narrower than 80 columns, the agent rows match the approved 41 column rows.'

async function laneScene($: Engine, on: On, surface: Surface) {
  const seen = world(on)
  const dialog = personDialog(on)
  const steps = stepWorld(on)
  await startOn($, surface)
  await seen.clock.set(START)
  await spawnFrom($, LANE)
  seen.agents.push(runningAgent(LANE, 'lane-b'))
  await $.tool.call({ tool: 'Bash', command: 'npm run build', agentId: LANE })
  await seen.clock.advance(8 * MINUTE)
  seen.agents.splice(0, 1, { ...runningAgent(LANE, 'lane-b'), status: 'failed' })
  await $.turn.complete({
    turnId: 'turn-lane',
    reason: 'answer',
    answer: 'done',
    durationMs: 8 * MINUTE,
    isAborted: false,
    agentId: LANE,
  })
  await seen.clock.advance(4 * MINUTE)
  await spawnFrom($, SCOUT)
  seen.agents.push(runningAgent(SCOUT, 'scout'))
  await step($, steps, SCOUT, stepped('turn-s', SCOUT_USAGE, 'tool_use'))
  await seen.clock.advance(5 * MINUTE)
  await spawnFrom($, EXPLORE, SCOUT)
  seen.agents.push(runningAgent(EXPLORE, 'Explore'))
  await seen.clock.advance(2 * MINUTE)
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/src/a.ts`, agentId: EXPLORE })
  await step($, steps, EXPLORE, stepped('turn-e', EXPLORE_USAGE, 'tool_use'))
  for (const [id, name] of LANE_EXTRAS) {
    await spawnFrom($, id)
    seen.agents.push(runningAgent(id, name))
  }
  await seen.clock.advance(MINUTE - NEEDS_YOU_AFTER_MS)
  const call = askAs($, SCOUT, 'npm test')
  await dialog.opened(1)
  await seen.clock.advance(NEEDS_YOU_AFTER_MS)
  return { dialog, call }
}

async function agentScreen(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<{ lines: string[]; lanes: (Drawn | null)[] }> {
  const ui = await mountTab($, surface, PANE, placement, columns)
  const all = unframed(await screen(ui, columns))
  const lanes: (Drawn | null)[] = []
  for (const id of [SCOUT, LANE, EXPLORE]) {
    lanes.push(drawnOf(await ui.find({ key: `lane:agent:${id}` })))
  }
  await ui.unmount()
  const first = all.findIndex((line) => line.startsWith('Agents'))
  return { lines: all.slice(first).filter((line) => line !== '' && !line.startsWith('[')), lanes }
}

const LANE_SCREENS: readonly {
  columns: number
  lines: readonly string[]
  framed: readonly string[]
}[] = [
  {
    columns: 89,
    framed: [
      'Agents  5 · 1 needs you · 1 failed · lanes from 20m ago to now',
      '1: ◆ scout     needs you waits for: permission… ctx 31k ············━━━━━━━◆ open  8m',
      '2: ■ lane-b    failed    failed after Bash npm… ctx —   ━━━━━━━■············       8m',
      '3: ▶ Explore   running   Read src/a.ts          ctx 48k ·················━━━ open  3m',
      '4: ▶ tester    running                          ctx —   ···················━ open  1m',
      '5: ▶ docs      running                          ctx —   ···················━ open  1m',
    ],
    lines: [
      'Agents  5 · 1 needs you · 1 failed',
      '1: ◆ scout     needs you                                                         open  8m',
      '    waits for: permission · Bash npm test',
      '2: ■ lane-b    failed                                                                  8m',
      '    failed after Bash npm run build',
      '3: ▶ Explore   running   Read src/a.ts                                           open  3m',
      '4: ▶ tester    running                                                           open  1m',
      '5: ▶ docs      running                                                           open  1m',
    ],
  },
  {
    columns: 80,
    framed: [
      'Agents  5 · 1 needs you · 1 failed · lanes from 20m ago to now',
      '1: ◆ scout     needs you waits for: p… ctx 31k ············━━━━━━━◆ open  8m',
      '2: ■ lane-b    failed    failed after… ctx —   ━━━━━━━■············       8m',
      '3: ▶ Explore   running   Read src/a.ts ctx 48k ·················━━━ open  3m',
      '4: ▶ tester    running                 ctx —   ···················━ open  1m',
      '5: ▶ docs      running                 ctx —   ···················━ open  1m',
    ],
    lines: [
      'Agents  5 · 1 needs you · 1 failed',
      '1: ◆ scout     needs you                                                open  8m',
      '    waits for: permission · Bash npm test',
      '2: ■ lane-b    failed                                                         8m',
      '    failed after Bash npm run build',
      '3: ▶ Explore   running   Read src/a.ts                                  open  3m',
      '4: ▶ tester    running                                                  open  1m',
      '5: ▶ docs      running                                                  open  1m',
    ],
  },
]

for (const surface of SURFACES) {
  describe(LANES_CRITERION, () => {
    for (const { columns, lines, framed } of LANE_SCREENS) {
      test(
        `when 5 agents do not fit as cards, each terminal agent row draws its ctx and a lane from the first spawn to now, as mock 8.10k, and the desktop draws rows, at ${String(columns)} columns, on ${surface}`,
        withWorkitems,
        async ($, on) => {
          const { dialog, call } = await laneScene($, on, surface)
          expect((await agentScreen($, surface, 'dock', columns)).lines).toEqual(
            bySurface(surface, framed, lines),
          )

          dialog.allow()
          await call
        },
      )
    }

    test(
      `the lane of a waiting agent ends in the warning mark and the lane of a failed agent in the error mark, and the desktop draws no lane, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { dialog, call } = await laneScene($, on, surface)
        const lanes = (await agentScreen($, surface, 'dock', 89)).lanes
        if (surface === 'desktop') {
          expect(lanes).toEqual([null, null, null])
        } else {
          const [scout, lane, explore] = lanes
          expect(scout?.children[1]?.text.endsWith('◆')).toBe(true)
          expect(scout?.children[1]?.props.color).toBe('warning')
          expect(lane?.children[1]?.text.endsWith('■')).toBe(true)
          expect(lane?.children[1]?.props.color).toBe('error')
          expect(lane?.children[2]?.props.dimColor).toBe(true)
          expect(explore?.children[1]?.text).toBe('━━━')
        }
        dialog.allow()
        await call
      },
    )

    test(
      `an inline board with a body of 80 columns draws rows with no ctx and no lane, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const { dialog, call } = await laneScene($, on, surface)
        const inline = await agentScreen($, surface, 'inline', 80)
        expect(inline.lines[0]).toBe('Agents  5 · 1 needs you · 1 failed')
        expect(inline.lines.join('\n')).not.toContain('ctx')
        expect(inline.lanes).toEqual([null, null, null])
        dialog.allow()
        await call
      },
    )
  })

  describe(NARROW_ROWS_CRITERION, () => {
    for (const columns of [41, 79]) {
      test(
        `a body of ${String(columns)} columns keeps the rows of mock 8.10f with no ctx and no lane, and body 80 adds them on the terminal, on ${surface}`,
        withWorkitems,
        async ($, on) => {
          const { dialog, call } = await laneScene($, on, surface)
          const narrow = await agentScreen($, surface, 'dock', columns)
          const body = bySurface(surface, columns - 4, columns)
          const row = (lead: string, tail: string) => `${lead.padEnd(body - tail.length)}${tail}`
          const explore = {
            framed41: row('3: ▶ Explore   running', 'open  3m'),
            flat41: '3: ▶ Explore   running   Read s… open  3m',
            wide: row('3: ▶ Explore   running   Read src/a.ts', 'open  3m'),
          }
          expect(narrow.lines).toEqual([
            'Agents  5 · 1 needs you · 1 failed',
            row('1: ◆ scout     needs you', 'open  8m'),
            body < 41
              ? '    waits for: permission · Bash npm…'
              : '    waits for: permission · Bash npm test',
            row('2: ■ lane-b    failed', '8m'),
            '    failed after Bash npm run build',
            columns === 41 ? bySurface(surface, explore.framed41, explore.flat41) : explore.wide,
            row('4: ▶ tester    running', 'open  1m'),
            row('5: ▶ docs      running', 'open  1m'),
          ])

          expect(narrow.lanes).toEqual([null, null, null])
          const wide = await agentScreen($, surface, 'dock', 80)
          expect(wide.lines[0]).toBe(
            bySurface(
              surface,
              'Agents  5 · 1 needs you · 1 failed · lanes from 20m ago to now',
              'Agents  5 · 1 needs you · 1 failed',
            ),
          )
          expect(wide.lanes.every((lane) => lane !== null)).toBe(surface === 'terminal')
          expect(wide.lanes.every((lane) => lane === null)).toBe(surface === 'desktop')
          dialog.allow()
          await call
        },
      )
    }
  })
}

const STATS_CRITERION =
  'When the person runs /board stats, the reply lists the context, the cost, the limits, the checks, the waits and each agent with its state and ctx.'
const STATS_NO_USAGE_CRITERION =
  'When the host gives no usage, the reply says so by name and shows no number.'

for (const surface of SURFACES) {
  describe(STATS_CRITERION, () => {
    test(
      `the reply prints the Session line, its details, the wait, the checks and each agent with its state and ctx, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const dialog = personDialog(on)
        const steps = stepWorld(on)
        await startOn($, surface)
        await seen.clock.set(START)
        await measure($, { percent: 62, usd: 4.18, limits: limitsAt(seen.clock.now()) })
        await compacts($)
        await mainTurnStarts($, 'turn-1')
        await edit($, 'docs/mocks.md')
        await spawnFrom($, EXPLORE)
        seen.agents.push(runningAgent(EXPLORE, 'Explore'))
        await step($, steps, EXPLORE, stepped('turn-e', EXPLORE_USAGE, 'tool_use'))
        await measure($, { usd: 4.8 })
        await mainTurnTakes($, 'turn-1', 3 * MINUTE)
        const { call } = await scoutWaits($, seen, dialog)
        expect(await board($, 'stats')).toBe(
          [
            'Session  ◆ 1 waits · ctx 62% · $4.80',
            '    ◆ scout waits for permission: Bash npm test',
            '    last 3m · 1 edit · 0 errors · +$0.62 · 1 agent spawned',
            '    context 124k of 200k · 1 compaction',
            '    trend after 2 turns',
            '    no breakdown on this host',
            '    limits 5h 31% · 7d 13% · resets 5h in 2h · 7d in 4d',
            '    pace after 15m of readings · 5h ~53% at reset · 7d ~30% at reset · plan start',
            '    Context 124k of 200k tokens. Limits reset: 5h in 2 hours, 7d in 4 days.',
            '    Checks 2: 1 allowed, 1 asked (the classifier or you), 0 denied.',
            '    file 1 · shell 1 · other 0',
            '    last 2 checks, oldest first: 1 allowed, 1 asked',

            'Agents  2 · 1 needs you',
            '    scout: needs you · ctx —',
            '    Explore: running · ctx 48k',
          ].join('\n'),
        )
        expect(seen.opened).toEqual([])
        dialog.allow()
        await call
      },
    )

    test(
      `the reply names a slow agent as its row does, and an empty session says no agents yet, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const held = holdCommand(on)
        const seen = world(on)
        await exploreRuns($, seen, surface)
        expect(await board($, 'stats')).toBe(
          [
            'Session  ctx — until the first reply',
            'Agents  1',
            '    Explore: running · ctx —',
          ].join('\n'),
        )
        const call = $.tool.call({ tool: 'Bash', command: HELD_COMMAND, agentId: EXPLORE })
        await seen.clock.advance(45_000)
        expect((await board($, 'stats')).split('\n').at(-1)).toBe('    Explore: slow 45s · ctx —')
        held.release()
        await call
        seen.agents.splice(0)
        await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
        await startOn($, surface)
        expect(await board($, 'stats')).toBe(
          ['Session  ctx — until the first reply', 'No agents yet.'].join('\n'),
        )
      },
    )
  })

  describe(STATS_NO_USAGE_CRITERION, () => {
    test(
      `a host whose usage refuses gets a reply that names no context or cost on this host and has no number, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { usage: 'refused' })
        await startOn($, surface)
        const reply = await board($, 'stats')
        expect(reply).toBe(
          ['Session  no context or cost on this host', 'No agents yet.'].join('\n'),
        )
        expect(reply).not.toMatch(/\d/)
      },
    )
  })
}

const EDIT_CRITERION =
  'When the person runs /board edit 3 new title, task 3 shows the new title and Claude receives a note naming the change'

const EDIT_REFUSAL_CRITERION =
  'When the new title is empty, too long or holds a control character, the command refuses by name and keeps the old title'

const EDIT_FORM =
  '/board edit needs a task number and a title, for example /board edit 2 Write the tests.'

for (const surface of SURFACES) {
  describe(EDIT_CRITERION, () => {
    test(
      `/board edit 3 gives task 3 the new title on the board and in the list on ${surface}, and the next prompt names the change`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await toldAtNextPrompt($)
        expect(await board($, 'edit 3 Review the mocks with Ana')).toBe(
          'Task 3 is now titled: "Review the mocks with Ana". Claude is told at your next prompt.',
        )
        expect(await board($, 'edit 4   Ask Ana about the tabs ')).toBe(
          'Task 4 is now titled: Ask Ana about the tabs. Claude is told at your next prompt.',
        )
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        const gap = bySurface(surface, '', '    ')
        expect(fromTasks(await screen(ui, 41)).slice(3, 5)).toEqual([
          `○ 3 Review the mocks with Ana  ${gap}[ rm ]`,
          bySurface(
            surface,
            '○ 4 You: Ask Ana about the ta… [ rm ]',
            '○ 4 You: Ask Ana about the tabs    [ rm ]',
          ),
        ])
        await ui.unmount()
        expect(await toldAtNextPrompt($)).toEqual([
          [
            `${CHANGED} it set the title "Review the mocks with Ana" on task 3 by claude, titled "Review the mocks with Codex". it set the title "Ask Ana about the tabs" on task 4 by the person: Ask the person about tabs.`,
            '',
            'Tasks (1 of 4 done)',
            '  1  done         claude   "Read the design"',
            '  2  in progress  claude   "Write the tab mocks"',
            '  3  pending      claude   "Review the mocks with Ana"',
            '  4  pending      you      Ask Ana about the tabs',
          ].join('\n'),
        ])
        expect(await board($, 'edit 3 Review the mocks with Ana')).toBe(
          'Task 3 already has this title. Nothing changed.',
        )
        expect(await toldAtNextPrompt($)).toEqual([])
      },
    )
  })

  describe(EDIT_REFUSAL_CRITERION, () => {
    test(
      `an empty, a too long and a control character title are refused by name and the old title stays on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await toldAtNextPrompt($)
        const before = await modelTool($, {})
        const refusals: readonly (readonly [string, string])[] = [
          ['edit 3', `Not changed: the new title is empty. ${EDIT_FORM}`],
          ['edit 3   ', `Not changed: the new title is empty. ${EDIT_FORM}`],
          [
            `edit 3 ${'x'.repeat(201)}`,
            'Not changed: the title has 201 characters. The limit is 200.',
          ],
          [
            'edit 3 Review\u0007the mocks',
            'Not changed: the title has a line break or a control character. Write it on one line.',
          ],
          [
            'edit 3 Review\nthe mocks',
            'Not changed: the title has a line break or a control character. Write it on one line.',
          ],
          [
            'edit 3 Review \u202ethe mocks',
            'Not changed: the title has a bidi control character, which can reorder the text. Remove it.',
          ],
          ['edit', EDIT_FORM],
          ['edit three Review it', EDIT_FORM],
          ['edit 9 Review it', 'No task 9. This session has tasks 1-4; /board list prints them.'],
          [
            'edit 1000000000000000000000 Review it',
            '1000000000000000000000 is too large for a task number. /board list prints the task numbers.',
          ],
        ]
        for (const [args, reply] of refusals) expect(await board($, args)).toBe(reply)
        expect(await modelTool($, {})).toBe(before)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(ui, 41))[3]).toBe(
          bySurface(
            surface,
            '○ 3 Review the mocks with Cod… [ rm ]',
            '○ 3 Review the mocks with Codex    [ rm ]',
          ),
        )
        await ui.unmount()
        expect(await toldAtNextPrompt($)).toEqual([])
      },
    )
  })
}

const BATCH_CRITERION =
  'When Claude calls task_add with several titles, every title is added in the given order and the answer lists the new ids'

const BATCH_BEFORE_CRITERION =
  'When Claude calls task_add with a before id, the new tasks sit before that task'

const BATCH_LIMIT_CRITERION =
  'When a batch would pass the task limit, the call refuses the whole batch and adds nothing'

async function taskRowOrder(ui: { findAll: Mounted['findAll'] }): Promise<string> {
  const keys = (await ui.findAll({ type: 'Button' })).map((button) => String(button.key))
  return keys
    .filter((key) => key.startsWith('open:task:'))
    .map((key) => key.slice('open:task:'.length))
    .join(' ')
}

for (const surface of SURFACES) {
  describe(BATCH_CRITERION, () => {
    test(
      `task_add with titles adds each title in the given order and names the new ids, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await startOn($, surface)
        await $.tool.call({ tool: TOOL_ADD, title: 'Read the design' })
        const added = await $.tool.call({
          tool: TOOL_ADD,
          titles: ['Draw the mocks', 'Write the tests', 'Ship the mod'],
        })
        expect(added.result).toBe(
          [
            'Added tasks 2, 3, 4.',
            '',
            'Tasks (0 of 4 done)',
            '  1  pending      claude   "Read the design"',
            '  2  pending      claude   "Draw the mocks"',
            '  3  pending      claude   "Write the tests"',
            '  4  pending      claude   "Ship the mod"',
          ].join('\n'),
        )
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await taskRowOrder(ui)).toBe('1 2 3 4')
        const gap = bySurface(surface, '', '    ')
        expect(fromTasks(await screen(ui, 41)).slice(1, 5)).toEqual([
          `○ 1 Read the design            ${gap}[ rm ]`,
          `○ 2 Draw the mocks             ${gap}[ rm ]`,
          `○ 3 Write the tests            ${gap}[ rm ]`,
          `○ 4 Ship the mod               ${gap}[ rm ]`,
        ])
        await ui.unmount()
        const one = await $.tool.call({ tool: TOOL_ADD, titles: ['Tag the release'] })
        expect(String(one.result).split('\n')[0]).toBe('Added task 5: "Tag the release".')
      },
    )
  })

  describe(BATCH_BEFORE_CRITERION, () => {
    test(
      `task_add with before puts the new tasks before that task in the given order, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await startOn($, surface)
        await fiveTasks($)
        const added = await $.tool.call({ tool: TOOL_ADD, titles: ['Six', 'Seven'], before: 2 })
        expect(String(added.result).split('\n')[0]).toBe('Added tasks 6, 7 before task 2.')
        expect(await order($)).toBe('1 6 7 2 3 4 5')
        const first = await $.tool.call({ tool: TOOL_ADD, title: 'Eight', before: 1 })
        expect(String(first.result).split('\n')[0]).toBe('Added task 8 before task 1: "Eight".')
        expect(await order($)).toBe('8 1 6 7 2 3 4 5')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await taskRowOrder(ui)).toBe('8 1 6 7 2 3 4 5')
        await ui.unmount()
        expect((await $.tool.call({ tool: TOOL_ADD, titles: ['Nine'], before: 99 })).deny).toBe(
          'No task 99. The ids are 1-8. Call task_list, then task_add with one of its ids as before.',
        )
        expect((await $.tool.call({ tool: TOOL_ADD, titles: ['Nine'], before: 'two' })).deny).toBe(
          'task_add needs before as an integer task id that task_list shows, for example {"titles": ["Write the tests"], "before": 2}.',
        )
        expect(await order($)).toBe('8 1 6 7 2 3 4 5')
      },
    )
  })

  describe(BATCH_LIMIT_CRITERION, () => {
    test(
      `a batch that passes the limit, or holds one bad title, adds nothing and says why, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await startOn($, surface)
        for (let index = 1; index <= 98; index += 1) {
          await $.tool.call({ tool: TOOL_ADD, title: `Task ${String(index)}` })
        }
        await $.tool.call({ tool: TOOL_UPDATE, id: 7, status: 'completed' })
        const before = String(await modelTool($, {}))
        expect((await $.tool.call({ tool: TOOL_ADD, titles: ['One', 'Two', 'Three'] })).deny).toBe(
          'task_add refused: the list has 98 of 100 tasks, so 3 new tasks do not fit. Add at most 2, or remove a task first. 1 of them is done. Remove a done task with task_update and the status removed, then add the task.',
        )
        expect(
          (await $.tool.call({ tool: TOOL_ADD, titles: ['One', 'Two\nlines'], before: 1 })).deny,
        ).toBe(
          'task_add refused title 2: the title has a line break or a control character. Write it on one line.',
        )
        const shapes: readonly (readonly [Record<string, unknown>, string])[] = [
          [{ titles: [] }, BATCH_SHAPE],
          [{ titles: ['One', ' '] }, BATCH_SHAPE],
          [{ titles: 'One' }, BATCH_SHAPE],
          [{ title: 'One', titles: ['Two'] }, 'task_add takes title or titles, not both.'],
        ]
        for (const [input, deny] of shapes) {
          expect((await $.tool.call({ tool: TOOL_ADD, ...input })).deny).toBe(deny)
        }
        expect(String(await modelTool($, {}))).toBe(before)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(ui, 41))[0]).toBe('Tasks  ▱▱▱▱▱▱▱▱ 1/98 · ○97')
        await ui.unmount()
        const fits = await $.tool.call({ tool: TOOL_ADD, titles: ['One', 'Two'] })
        expect(String(fits.result).split('\n')[0]).toBe('Added tasks 99, 100.')
      },
    )
  })
}

const BATCH_SHAPE =
  'task_add needs titles: a list of non-empty strings, for example {"titles": ["Write the tests", "Run the tests"]}.'

const HEADER_BAR_CRITERION =
  'When the list holds tasks, the header shows a bar split into done, in progress and pending, with the counts'

const STALLED_CRITERION =
  'When a task stays in progress longer than the set time, its time shows in the warning colour'

const STALLED_WORD_CRITERION =
  'When a task in progress has run for more than 15 minutes in its current run, the this session tab shows its time with the word stalled before it'

const RUN_TIME = /^(?:stalled )?\d+m$/u

const FINISH_CRITERION =
  'When every task is done, the header shows the finish state with the total time'

async function runningRowLine(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string | undefined> {
  const ui = await mountTab($, surface, PANE, placement, columns)
  const lines = fromTasks(await screen(ui, columns))
  await ui.unmount()
  return lines.find((line) => line.startsWith('▶ 2 '))
}

async function headerOf(ui: { find: Mounted['find'] }): Promise<Drawn> {
  const header = drawnOf(await ui.find({ key: 'tasks-header' }))
  if (header === null) throw new Error('no task header is drawn')
  return header
}

const FRAME_EDGE = /^[─ ]+$/u

function colouredParts(element: Drawn): (readonly [string, unknown])[] {
  return texts(element)
    .filter((text) => text.props.color !== undefined && !FRAME_EDGE.test(text.text))
    .map((text) => [text.text, text.props.color] as const)
}

for (const surface of SURFACES) {
  describe(HEADER_BAR_CRITERION, () => {
    test(
      `the header draws the done, in progress and pending cells in their colours, with the counts, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(ui, 41))[0]).toBe('Tasks  ▰▰▱▱ 1/4 · ▶1 ○2 · 14m')
        expect(colouredParts(await headerOf(ui))).toEqual([
          ['Tasks', 'planMode'],
          ['▰', 'success'],
          ['▰', 'claude'],
          ['▶1', 'claude'],
          ['○2', 'subtle'],
        ])
        await ui.unmount()
        for (const title of ['Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']) {
          await $.tool.call({ tool: TOOL_ADD, title })
        }
        await board($, 'done 3')
        await board($, 'done 4')
        const wide = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(wide, 41))[0]).toBe('Tasks  ▰▰▰▱▱▱▱▱ 3/10 · ▶1 ○6 · 14m')
        await wide.unmount()
        const narrow = await mountTab($, surface, PANE, 'dock', 30)
        expect(fromTasks(await screen(narrow, 30))[0]).toBe('Tasks  ▰▰▰▱▱▱▱▱ 3/10 · ▶1 ○6 …')
        await narrow.unmount()
      },
    )
  })

  describe(STALLED_CRITERION, () => {
    test(
      `the time of a task in progress turns to the warning colour after 15 minutes, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        const timeOf = async (): Promise<Drawn | undefined> => {
          const ui = await mountTab($, surface, PANE, 'dock', 41)
          const time = texts(await rowOf(ui, 'task:2')).find((text) => RUN_TIME.test(text.text))
          await ui.unmount()
          return time
        }
        await seen.clock.advance(11 * MINUTE)
        const due = await timeOf()
        expect([due?.text, due?.props.color, due?.props.dimColor]).toEqual(['15m', undefined, true])
        await seen.clock.advance(MINUTE)
        const stalled = await timeOf()
        expect([stalled?.text, stalled?.props.color]).toEqual(['stalled 16m', 'warning'])
      },
    )

    test(
      `a done task that runs again is stalled only after 15 minutes of the new run, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await board($, 'done 2')
        await seen.clock.advance(20 * MINUTE)
        await board($, 'start 2')
        const timeOf = async (): Promise<Drawn | undefined> => {
          const ui = await mountTab($, surface, PANE, 'dock', 41)
          const time = texts(await rowOf(ui, 'task:2')).find((text) => RUN_TIME.test(text.text))
          await ui.unmount()
          return time
        }
        const restarted = await timeOf()
        expect([restarted?.text, restarted?.props.color, restarted?.props.dimColor]).toEqual([
          '24m',
          undefined,
          true,
        ])
        await seen.clock.advance(15 * MINUTE)
        const due = await timeOf()
        expect([due?.text, due?.props.color]).toEqual(['39m', undefined])
        await seen.clock.advance(MINUTE)
        const stalled = await timeOf()
        expect([stalled?.text, stalled?.props.color]).toEqual(['stalled 40m', 'warning'])
      },
    )
  })

  describe(STALLED_WORD_CRITERION, () => {
    test(
      `a task in progress over 15 minutes reads stalled 16m with colour off at body 41, 30 and 80, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await seen.clock.advance(12 * MINUTE)
        expect([
          await runningRowLine($, surface, 'dock', 41),
          await runningRowLine($, surface, 'dock', 30),
          await runningRowLine($, surface, 'inline', 80),
        ]).toEqual([
          bySurface(
            surface,
            '▶ 2 Write the tab… stalled 16m [ rm ]',
            '▶ 2 Write the tab moc… stalled 16m [ rm ]',
          ),
          '▶ 2 Write … stalled 16m [ rm ]',
          '▶ 2 Write the tab mocks          ▸ Edit docs/mocks.md · 9 to… stalled 16m [ rm ]',
        ])
      },
    )

    test(
      `a task in progress for 15 minutes shows its time with no word, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await seen.clock.advance(11 * MINUTE)
        expect([
          await runningRowLine($, surface, 'dock', 41),
          await runningRowLine($, surface, 'dock', 30),
        ]).toEqual([
          bySurface(
            surface,
            '▶ 2 Write the tab mocks    15m [ rm ]',
            '▶ 2 Write the tab mocks        15m [ rm ]',
          ),
          '▶ 2 Write the tab … 15m [ rm ]',
        ])
      },
    )

    test(
      `a done task that runs again is not stalled at once, with colour off, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await board($, 'done 2')
        await seen.clock.advance(20 * MINUTE)
        await board($, 'start 2')
        expect(await runningRowLine($, surface, 'dock', 30)).toBe('▶ 2 Write the tab … 24m [ rm ]')
        await seen.clock.advance(16 * MINUTE)
        expect(await runningRowLine($, surface, 'dock', 30)).toBe('▶ 2 Write … stalled 40m [ rm ]')
      },
    )
  })

  describe(FINISH_CRITERION, () => {
    test(
      `the header of a list with every task done shows all done and the time until the last task ended, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        for (const id of ['2', '3', '4']) await board($, `done ${id}`)
        await seen.clock.advance(5 * MINUTE)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(ui, 41))[0]).toBe('Tasks  ✓ all 4 done · 14m')
        expect(colouredParts(await headerOf(ui))).toEqual([
          ['Tasks', 'planMode'],
          ['✓ all 4 done', 'success'],
        ])
        await ui.unmount()
        await board($, 'open 4')
        const reopened = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(reopened, 41))[0]).toBe('Tasks  ▰▰▰▱ 3/4 · ○1 · 19m')
        await reopened.unmount()
      },
    )

    test(
      `the finish time ends when the last task is done, also a task that never ran, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await startOn($, surface)
        await mockWork($, seen)
        await board($, 'done 2')
        await seen.clock.advance(5 * MINUTE)
        await board($, 'done 3')
        await board($, 'done 4')
        await seen.clock.advance(7 * MINUTE)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(fromTasks(await screen(ui, 41))[0]).toBe('Tasks  ✓ all 4 done · 19m')

        await ui.unmount()
      },
    )
  })
}

const REJECTED_PLAN: PlanAnswer = {
  isError: true,
  result: 'User rejected tool use',
  text: "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
}

type PlanAnswers = { current: PlanAnswer }

function planWorld(on: On, first: PlanAnswer): { seen: World; answers: PlanAnswers } {
  const answers: PlanAnswers = { current: first }
  const seen = world(on, {
    get planAnswer() {
      return answers.current
    },
  })
  return { seen, answers }
}

const ADDED_NOTE = [
  '[handily-board] The person changed the session task list: it added tasks 1, 2, 3 from the approved plan.',
  '',
  'Tasks (0 of 3 done)',
  '  1  pending      claude   "Create a.txt"',
  '  2  pending      claude   "Create b.txt"',
  '  3  pending      claude   "Create c.txt"',
].join('\n')

describe('an approved plan as tasks (handily-9uj3n.7)', () => {
  for (const surface of SURFACES) {
    test(
      `an approved plan with numbered steps shows the add button and adds nothing by itself on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        engineRows(on)
        await start($)
        const call = await approve($, seen)
        expect(await modelTool($, {})).toBe('The task list is empty.')
        const row = await mountPlanRow($, surface, call)
        expect((await row.find({ key: 'plan-add' }))?.text).toBe('add 3 steps as tasks')
        expect(
          await row.find({ type: 'Text', text: 'adds them to the board as pending tasks' }),
        ).toBeDefined()
        expect(drawnOf(await row.drawn())?.children[0]).toMatchObject({ type: 'engine' })
        await row.unmount()
        const pane = await mountTasks($, surface)
        expect((await pane.find({ key: 'plan-add' }))?.text).toBe('add 3 as tasks')
        expect((await pane.find({ key: 'plan-dismiss' }))?.text).toBe('dismiss')
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            'Plan  approved · 3 numbered steps',
            '  1 Create a.txt',
            '  2 Create b.txt',
            '  … 1 more step',
            '  [ add 3 as tasks ]  [ dismiss ]',
          ]),
        )
        await pane.unmount()
        expect(await modelTool($, {})).toBe('The task list is empty.')
        expect(await toldAtNextPrompt($)).toEqual([])
      },
    )

    test(
      `a press on the transcript button adds each step as a pending task of claude in order on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        engineRows(on)
        await start($)
        const call = await approve($, seen)
        const row = await mountPlanRow($, surface, call)
        await row.press({ key: 'plan-add' })
        await row.unmount()
        expect(await modelTool($, {})).toBe(
          'Tasks (0 of 3 done)\n  1  pending      claude   "Create a.txt"\n  2  pending      claude   "Create b.txt"\n  3  pending      claude   "Create c.txt"',
        )
        expect(await planLine($, surface, call)).toBe('  ✓ added as tasks 1-3')
        expect(seen.toasts).toEqual([])
        expect(await toldAtNextPrompt($)).toEqual([ADDED_NOTE])
        const pane = await mountTasks($, surface)
        expect(await pane.find({ key: 'plan-add' })).toBeUndefined()
        await pane.unmount()
      },
    )

    test(
      `a press on the pane button adds each step as a pending task in order on ${surface}`,
      withToolIds,
      async ($, on) => {
        const seen = world(on, { planAnswer: APPROVED_PLAN })
        await start($)
        await board($, 'add Check the narrow dock')
        await approve($, seen)
        const pane = await mountTasks($, surface)
        await pane.press({ key: 'plan-add' })
        expect(await pane.find({ key: 'plan-add' })).toBeUndefined()
        expect(
          (await pane.findAll({ type: 'Button', text: 'rm' })).map((button) => button.key),
        ).toEqual(['rm:1', 'rm:2', 'rm:3', 'rm:4'])
        await pane.unmount()
        expect(await modelTool($, {})).toBe(
          'Tasks (0 of 4 done)\n  1  pending      you      Check the narrow dock\n  2  pending      claude   "Create a.txt"\n  3  pending      claude   "Create b.txt"\n  4  pending      claude   "Create c.txt"',
        )
        expect(seen.toasts).toEqual([])
        expect(await board($, 'plan')).toBe(
          'The approved plan is already tasks 2-4. Nothing changed.',
        )
      },
    )
  }

  test(
    'a rejected plan, a plan of a subagent and a plan with no numbered list get no offer',
    withToolIds,
    async ($, on) => {
      const { seen, answers } = planWorld(on, REJECTED_PLAN)
      engineRows(on)
      await start($)
      for (const surface of SURFACES) {
        const rejected = await approve($, seen)
        const row = await mountPlanRow($, surface, rejected, true)
        expectEngineRow(await row.drawn())
        await row.unmount()
      }
      answers.current = planOf(PLAN_TEXT, true)
      const agentPlan = await approve($, seen)
      answers.current = APPROVED_PLAN
      const fromAgent = await approve($, seen, 'agent-1')
      answers.current = planOf('Read the design, then draw the mocks.\n\n- one\n- two\n')
      const bulleted = await approve($, seen)
      answers.current = planOf('1. Only one step\n\nThen more text.\n')
      await approve($, seen)
      for (const surface of SURFACES) {
        for (const call of [agentPlan, fromAgent, bulleted]) {
          const row = await mountPlanRow($, surface, call)
          expectEngineRow(await row.drawn())
          await row.unmount()
        }
        const pane = await mountTasks($, surface)
        expect(await pane.find({ key: 'plan-add' })).toBeUndefined()
        await pane.unmount()
      }
      expect(await board($, 'plan')).toBe(
        'No approved plan with numbered steps in this session. Nothing changed.',
      )
      expect(await modelTool($, {})).toBe('The task list is empty.')
    },
  )

  test(
    'the steps are the first top-level numbered list with two items, without markdown marks',
    withToolIds,
    async ($, on) => {
      const plan = [
        '# Plan',
        '',
        'Context first.',
        '',
        '1. A single item',
        '',
        'More text.',
        '',
        '```sh',
        '1. not a step',
        '2. also not',
        '```',
        '',
        '1. **Read** the `design` and   the [board](docs/mocks.md) sections',
        '   - a nested detail',
        '2) Map the _hooks_ that',
        '   draw the pane',
        '',
        '3. Test it',
        '',
        '## After',
        '',
        '1. Not this list',
        '2. Nor this',
      ].join('\n')
      const seen = world(on, { planAnswer: planOf(plan) })
      await start($)
      await approve($, seen)
      expect(await board($, 'plan')).toBe(
        'Added tasks 1-3 from the approved plan. Claude is told at your next prompt.',
      )
      expect(await modelTool($, {})).toBe(
        'Tasks (0 of 3 done)\n  1  pending      claude   "Read the design and the board sections"\n  2  pending      claude   "Map the hooks that draw the pane"\n  3  pending      claude   "Test it"',
      )
    },
  )

  test(
    '/board plan names a cut step, refuses a bad step and a full list by name, and says when a plan is already added',
    withToolIds,
    async ($, on) => {
      const { seen, answers } = planWorld(on, planOf(`1. ${'x'.repeat(230)}\n2. Short\n`))
      await start($)
      await approve($, seen)
      expect(await board($, 'plan')).toBe(
        'Added tasks 1-2 from the approved plan. Step 1 was cut to 200 characters. Claude is told at your next prompt.',
      )
      expect(await board($, 'plan')).toBe(
        'The approved plan is already tasks 1-2. Nothing changed.',
      )
      answers.current = planOf('1. Fine\n2. Bad \u{202E} step\n')
      await approve($, seen)
      expect(await board($, 'plan')).toBe(
        'Not added: step 2 has a bidi control character. Nothing changed.',
      )
      for (let index = 0; index < 97; index += 1) await board($, `add Task ${String(index)}`)
      await board($, 'done 3')
      await board($, 'done 4')
      answers.current = APPROVED_PLAN
      await approve($, seen)
      expect(await board($, 'plan')).toBe(
        'Not added: the plan has 3 steps and the list has room for 1 of 100 tasks, and 2 of them are done. Run /board clear to remove the done tasks, or remove one first.',
      )
      for (const surface of SURFACES) {
        const pane = await mountTasks($, surface)
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            '  ■ not added: room for 1 of 3 steps',
            '  /board clear removes 2 done tasks',
          ]),
        )
        expect((await pane.find({ type: 'Text', text: '■ not added:' }))?.props.color).toBe('error')
        await pane.press({ key: 'plan-add' })
        await pane.unmount()
      }
      expect(seen.toasts.at(-1)).toEqual([
        '■ Plan not added',
        'room for 1 of 3 steps',
        '/board clear removes 2 done tasks',
      ])
      await board($, 'clear')
      expect(await board($, 'plan')).toBe(
        'Added tasks 100-102 from the approved plan. Claude is told at your next prompt.',
      )
    },
  )

  test(
    'a later plan replaces the offer, an older row says so, and a press on it changes nothing',
    withToolIds,
    async ($, on) => {
      const { seen, answers } = planWorld(on, APPROVED_PLAN)
      engineRows(on)
      await start($)
      const first = await approve($, seen)
      answers.current = planOf('1. Write the tests\n2. Run them\n')
      const second = await approve($, seen)
      for (const surface of SURFACES) {
        expect(await planLine($, surface, first)).toBe('  ○ a later plan replaced this one')
        expect(await planLine($, surface, second)).toBe(
          '  [ add 2 steps as tasks ]  adds them to the board as pending tasks',
        )
      }
      expect(await modelTool($, {})).toBe('The task list is empty.')
      expect(await board($, 'list')).toBe(
        [
          'Approved plan (2 steps, not added yet; /board plan adds them as tasks)',
          '  1  "Write the tests"',
          '  2  "Run them"',
          '',
          'No tasks in this session yet. Work items are not read yet.',
        ].join('\n'),
      )
    },
  )

  test(
    'tasks that Claude adds after the approval raise a warning, and dismiss hides only the block',
    withToolIds,
    async ($, on) => {
      const seen = world(on, { planAnswer: APPROVED_PLAN })
      engineRows(on)
      await start($)
      const call = await approve($, seen)
      await $.tool.call({ tool: TOOL_ADD, titles: ['Create a.txt', 'Create b.txt'] })
      for (const surface of SURFACES) {
        expect(await planLine($, surface, call)).toBe(
          '  [ add 3 steps as tasks ]  Claude added 2 tasks after this plan',
        )
        const pane = await mountTasks($, surface)
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            '  Claude added 2 tasks after the plan.',
            '  Adding it may repeat them.',
          ]),
        )
        await pane.unmount()
      }
      const pane = await mountTasks($, 'desktop')
      await pane.press({ key: 'plan-dismiss' })
      expect(await pane.find({ key: 'plan-add' })).toBeUndefined()
      await pane.unmount()
      expect(await planLine($, 'terminal', call)).toBe(
        '  [ add 3 steps as tasks ]  Claude added 2 tasks after this plan',
      )
      expect(await board($, 'plan')).toBe(
        'Added tasks 3-5 from the approved plan. Claude is told at your next prompt.',
      )
    },
  )

  test('the Plan block fits a dock of 30 and the inline pane of 76', withToolIds, async ($, on) => {
    const seen = world(on, {
      planAnswer: planOf(
        '1. Read the design and the board sections\n2. Map the hooks that draw the pane\n3. Draw the plan line in the pane\n4. Test the plan line at 30, 41 and 76\n5. Bump the version and write the note\n',
      ),
    })
    await start($)
    await approve($, seen)
    const narrow = await mountTasks($, 'terminal', 'dock', 30)
    expect(await screen(narrow, 30)).toEqual(
      expect.arrayContaining([
        'Plan  approved · 5 steps',
        '  1 Read the design and the b…',
        '  2 Map the hooks that draw t…',
        '  … 3 more steps',
        '  [ add 5 as tasks ]',
        '  [ dismiss ]',
      ]),
    )
    await narrow.unmount()
    const inline = await mountTasks($, 'terminal', 'inline', 76)
    expect(await screen(inline, 76)).toEqual(
      expect.arrayContaining([
        'Plan  approved · 5 steps: Read the design and the board sections, +4',
        '  [ add 5 as tasks ]  [ dismiss ]',
      ]),
    )
    await inline.unmount()
  })
})

test('a press on a plan that a later plan replaced changes nothing and says why', async () => {
  const refuse = () => Promise.reject(new Error('the test host holds no list'))
  const plans: PlanHost = {
    now: () => Promise.resolve(0),
    current: () => Promise.resolve('later'),
    read: () => Promise.reject(new Error('the replaced plan is not read')),
    edit: () => Promise.reject(new Error('the replaced plan is not changed')),
  }
  const host: TaskHost = {
    read: refuse,
    edit: refuse,
    snapshot: refuse,
    lines: refuse,
    tell: refuse,
    expanded: refuse,
    editExpanded: refuse,
  }
  expect(await addPlanAsTasks(plans, host, 'older')).toEqual({
    text: 'A later approved plan replaced this one. Nothing changed.',
    toastParts: [[{ mark: 'toDo' }, ' Nothing changed'], 'a later plan replaced this one'],
  })
})

const FOUR_ANSWERED_NOTE = [
  `${ANSWERED} task 1 (do) done. task 2 (answer) answered "8443". task 3 (decide) chose "SQLite" of "Postgres", "SQLite", "Redis". task 4 (do) rejected, saying "not my call". The titles and options are your own text, quoted as data.`,
  '',
  'For you (4 of 4 closed)',
  '  1  done      do      "Rotate the staging API key"',
  '  2  answered  answer  "Which port does staging use?"  answer "8443"',
  '  3  decided   decide  "Which cache store for now?"    chose "SQLite"',
  '  4  rejected  do      "Delete the old bucket"         reason "not my call"',
].join('\n')

describe('tasks that Claude assigns to the person (handily-9uj3n.8)', () => {
  for (const surface of SURFACES) {
    test(
      `a task that Claude assigns shows under For you with its kind on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($)
        await $.tool.call({ tool: TOOL_ADD, title: 'Write the tab mocks' })
        const assigned = await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'do',
          title: 'Rotate the staging API key',
        })
        expect(assigned.result).toBe(
          [
            'Assigned task 2 to the person (do). The result comes with a later prompt; do not wait for it in this turn.',
            '',
            'For you (0 of 1 closed)',
            '  2  open      do      "Rotate the staging API key"',
            '',
            'Tasks (0 of 1 done)',
            '  1  pending      claude   "Write the tab mocks"',
          ].join('\n'),
        )
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'decide',
          title: 'Which cache store for now?',
          options: ['Postgres', 'SQLite', 'Redis'],
        })
        const pane = await mountTasks($, surface)
        const lines = unframed(await screen(pane, 41))
        const head = lines.indexOf('For you  ◆ 3 open')
        expect(lines.slice(head, head + 10)).toEqual([
          'For you  ◆ 3 open',
          '◆ 2 do      Rotate the staging API key',
          '    [ done ] [ reject ]',
          '◆ 3 answer  Which port does staging use?',
          '    [ Your answer ][Send]',
          '    [ reject ]',
          '◆ 4 decide  Which cache store for now?',
          '    [ Postgres ] [ SQLite ] [ Redis ]',
          '    [ reject ]',
          '─'.repeat(41),
        ])
        expect(lines[head + 10]).toBe('Tasks  ▱ 0/1 · ○1')
        expect((await pane.find({ type: 'Text', text: '◆ 3 open' }))?.props.color).toBe('warning')
        expect((await pane.find({ type: 'Text', text: 'answer  ' }))?.props.dimColor).toBe(true)
        expect(
          (await pane.findAll({ type: 'Button' }))
            .map((button) => button.key)
            .filter((key) => key?.startsWith('for-')),
        ).toEqual([
          'for-done:2',
          'for-reject:2',
          'for-reject:3',
          'for-pick:4:1',
          'for-pick:4:2',
          'for-pick:4:3',
          'for-reject:4',
        ])
        await pane.unmount()
        expect(await board($, 'list')).toContain('For you (0 of 3 closed)')
      },
    )

    test(
      `done and a rejection pressed on the pane, and an answer and a choice typed as commands, reach Claude in one note at the next prompt on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await assignFour($)
        const pane = await mountTasks($, surface)
        await pane.press({ key: 'for-done:1' })
        await board($, 'answer 2  8443 ')
        await board($, 'pick 3 2')
        await pane.press({ key: 'for-reject:4' })
        await pane.input({ key: 'reason:4', text: 'not my call' })
        const lines = await screen(pane, 41)
        expect(lines).toEqual(
          expect.arrayContaining([
            'For you  4 to send',
            '✓ 1 do      Rotate the staging API key',
            '    you: done · to send          [ undo ]',
            '    you answered · to send       [ undo ]',
            '    "8443"',
            '    you chose · to send          [ undo ]',
            '    "SQLite"',
            '    you rejected · to send       [ undo ]',
            '    "not my call"',
            'Claude gets them with your next prompt.',
          ]),
        )
        expect(forYouLines(lines).join('\n')).not.toContain('…')
        expect(seen.toasts).toEqual([])
        await pane.unmount()
        expect(await notesAtNextPrompt($)).toEqual([FOUR_ANSWERED_NOTE])
        expect(await notesAtNextPrompt($)).toEqual([])
        const after = await mountTasks($, surface)
        expect((await after.find({ key: 'for-answered' }))?.text).toBe('+4 closed')
        expect(await after.find({ type: 'Text', text: '✓ all 4 closed' })).toBeDefined()
        await after.press({ key: 'for-answered' })
        expect((await after.find({ key: 'for-answered' }))?.text).toBe('hide 4 closed')
        expect(await screen(after, 41)).toEqual(
          expect.arrayContaining([
            '    you: done',
            '    you answered',
            '    "8443"',
            '    you chose',
            '    "SQLite"',
            '    you rejected',
            '    "not my call"',
          ]),
        )
        expect(await after.find({ key: 'for-undo:1' })).toBeUndefined()
        await after.press({ key: 'for-clear' })
        expect(await after.find({ type: 'Text', text: /^For you/ })).toBeUndefined()
        await after.unmount()
        expect(await modelTool($, {})).toBe('The task list is empty.')
      },
    )
  }

  test(
    'the commands answer, pick, reject, done and undo reply as the mock, and one note carries the list changes and the answers',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignFour($)
      await board($, 'add Write the tab mocks')
      expect(await board($, 'answer 2')).toBe(
        'Not sent: the answer is empty. /board answer needs a task number and text, for example /board answer 9 Use port 8443.',
      )
      expect(await board($, 'answer 5 yes')).toBe(
        'Task 5 is not a task for you. /board list prints the tasks for you.',
      )
      expect(await board($, 'answer 1 yes')).toBe(
        'Task 1 is not a question for you. /board list prints the tasks for you.',
      )
      expect(await board($, 'done 2')).toBe(
        'Task 2 asks for an answer. /board answer 2 <text> answers it.',
      )
      expect(await board($, `answer 2 ${'9'.repeat(1001)}`)).toBe(
        'Not sent: the answer has 1001 characters; the limit is 1000. Nothing changed.',
      )
      expect(await board($, 'done 1')).toBe(
        'Task 1 is now done: "Rotate the staging API key". Claude is told at your next prompt.',
      )
      expect(await board($, 'answer 2 8443')).toBe(
        'Answered task 2: "8443". Claude is told at your next prompt.',
      )
      expect(await board($, 'answer 2 8080')).toBe(
        'Task 2 is already answered. /board undo 2 opens it again.',
      )
      expect(await board($, 'pick 3 5')).toBe(
        'Task 3 has options 1-3: Postgres, SQLite, Redis. Nothing changed.',
      )
      expect(await board($, 'pick 3 2')).toBe(
        'Chose "SQLite" for task 3. Claude is told at your next prompt.',
      )
      expect(await board($, 'reject 4 not my call')).toBe(
        'Rejected task 4. Claude is told at your next prompt.',
      )
      expect(await board($, 'start 1')).toBe(
        'Task 1 is for you. /board done 1, /board answer 1, /board pick 1 or /board reject 1 answers it.',
      )
      expect(await board($, 'undo 2')).toBe('Task 2 is open again. Claude was not told yet.')
      expect(await board($, 'answer 2 8443')).toBe(
        'Answered task 2: "8443". Claude is told at your next prompt.',
      )
      expect(await board($, 'edit 2 Which port')).toBe(
        'Not changed: task 2 is a task for you, so Claude keeps its title and its place. /board list prints the tasks for you.',
      )
      expect(await notesAtNextPrompt($)).toEqual([
        [
          `${CHANGED} it added task 5 by the person: Write the tab mocks. ${FOUR_ANSWERED_NOTE.split('\n')[0]?.slice(BOARD_NOTE.length + 1) ?? ''}`,
          ...FOUR_ANSWERED_NOTE.split('\n').slice(1),
          '',
          'Tasks (0 of 1 done)',
          '  5  pending      you      Write the tab mocks',
        ].join('\n'),
      ])
      expect(await board($, 'undo 2')).toBe('Task 2 was already sent to Claude. Nothing changed.')
    },
  )

  test(
    'task_assign refuses a bad input, a subagent and a twenty-first open task by name',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      const deny = async (input: Record<string, unknown>) =>
        (await $.tool.call({ tool: TOOL_ASSIGN, ...input })).deny
      expect(await deny({ kind: 'ask', title: 'Port?' })).toBe(
        'task_assign needs kind: one of do, answer, decide.',
      )
      expect(await deny({ kind: 'do', title: 'Rotate it', options: ['a', 'b'] })).toBe(
        'task_assign takes options only with the kind decide.',
      )
      expect(await deny({ kind: 'decide', title: 'Pick one', options: ['a'] })).toBe(
        'task_assign needs 2 to 4 options for the kind decide; it got 1.',
      )
      expect(await deny({ kind: 'decide', title: 'Pick one', options: ['a', 'a'] })).toBe(
        'task_assign refused: the option "a" is given twice.',
      )
      expect(await deny({ kind: 'do', title: 'Rotate it', agentId: 'agent-1' })).toBe(
        'task_assign works only in the main loop; tell the main agent what you need.',
      )
      for (let index = 0; index < 20; index += 1) {
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: `Step ${String(index)}` })
      }
      expect(await deny({ kind: 'do', title: 'One more' })).toBe(
        'task_assign refused: 20 tasks for the person are open. Wait for the answers, or close one with task_close and how not_needed.',
      )
      expect(await modelTool($, {})).toContain('For you (0 of 20 closed)')
    },
  )

  test(
    'task_assign asks for a decide task with go and not now before a release, a merge, a cleanup or a delete, and keeps the permission prompt',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      const description = seen.descriptions.get('task_assign') ?? ''
      for (const action of ['a release', 'a merge', 'a cleanup', 'a delete']) {
        expect(description).toContain(action)
      }
      expect(description).toContain('waits for the person')
      expect(description).toContain('assign a decide task with the options go and not now')
      expect(description).toContain('act only after the answer go')
      expect(description).toContain('a permission prompt stays as it is')
      expect(description).toContain('do not wait for it in this turn')
      const decided = await $.tool.call({
        tool: TOOL_ASSIGN,
        kind: 'decide',
        title: 'Release handily-board now?',
        options: ['go', 'not now'],
      })
      expect(decided.deny).toBeUndefined()
      expect(await modelTool($, {})).toContain('For you (0 of 1 closed)')
    },
  )

  for (const surface of SURFACES) {
    test(
      `Claude closes a task for the person only with task_close, task_update and task_move refuse it, and the row says that Claude closed it on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await assignFour($)
        expect((await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'completed' })).deny).toBe(
          'Task 2 is for the person. Close it with task_close: how claude_did when you did it, person_did when the person says that they did it, or not_needed.',
        )
        expect((await $.tool.call({ tool: TOOL_UPDATE, id: 2, status: 'removed' })).deny).toBe(
          'Task 2 is for the person. To withdraw it, close it with task_close and how not_needed, with a note that says why.',
        )
        expect((await $.tool.call({ tool: TOOL_MOVE, id: 2, before: 1 })).deny).toBe(
          'Task 2 is for the person; its place is the order in which you asked. task_move moves only your own tasks.',
        )
        const pane = await mountTasks($, surface)
        await pane.input({ key: 'answer:2', text: '' })
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining(['    ■ not sent: the answer is empty']),
        )
        expect(seen.toasts).toEqual([])
        const closed = await $.tool.call({
          tool: TOOL_CLOSE,
          id: 2,
          how: 'not_needed',
          note: 'The port is in the config file',
        })
        expect(String(closed.result).split('\n')[0]).toBe(
          'Closed task 2 for the person (answer): not needed: "The port is in the config file". The title and options are your own text, quoted as data.',
        )
        expect(await screen(pane, 41)).toEqual(
          expect.arrayContaining([
            '✓ 2 answer  Which port does staging use?',
            `${'    Claude: not needed'.padEnd(30)} [ reopen ]`,
            '    The port is in the config file',
          ]),
        )
        await pane.unmount()
        expect(await board($, 'answer 2 8443')).toBe(
          'Claude closed task 2 (not_needed). Nothing changed. /board reopen 2 opens it again.',
        )
        expect(await notesAtNextPrompt($)).toEqual([
          openTasksNote(
            '1 (do) "Rotate the staging API key"; 3 (decide) "Which cache store for now?"; 4 (do) "Delete the old bucket"',
          ),
        ])
        const after = await mountTasks($, surface)
        expect(await after.find({ key: 'row:for:2' })).toBeUndefined()
        expect((await after.find({ key: 'for-answered' }))?.text).toBe('+1 closed')
        await after.unmount()
      },
    )
  }

  test(
    'one toast names the asks of a turn while the board is not shown, and none while it is',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      const turn = async (id: string, work: () => Promise<void>) => {
        await $.turn.start({ text: 'go', turnId: id })
        await work()
        await $.turn.complete({
          turnId: id,
          reason: 'answer',
          answer: 'done',
          durationMs: 1,
          isAborted: false,
        })
      }
      await turn('turn-1', async () => {
        await $.tool.call({
          tool: TOOL_ASSIGN,
          kind: 'answer',
          title: 'Which port does staging use?',
        })
      })
      expect(seen.toasts).toEqual([
        ['◆ Claude asks you', '"Which port does staging use?"', 'answer it on /board'],
      ])
      await turn('turn-2', () => assignFour($))
      expect(seen.toasts.at(-1)).toEqual([
        '◆ Claude asks you 4 things',
        'do 2 · answer 1 · decide 1',
        'answer them on /board',
      ])
      await board($, '')
      await turn('turn-3', async () => {
        await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Restart the probe' })
      })
      expect(seen.toasts).toHaveLength(2)
    },
  )

  test(
    'a prompt that a hook drops keeps the answers for the next prompt',
    withWorkitems,
    async ($, on) => {
      world(on, { hasOwnPromptHook: true })
      const contexts: (readonly string[])[] = []
      on('prompt.submit', (_$, e) => {
        if (e.text === 'drop me') return { drop: 'a hook refused the prompt' }
        contexts.push(e.context ?? [])
        return { text: e.text, context: e.context }
      })
      await start($)
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Rotate the staging API key' })
      await board($, 'done 1')
      const submit = (text: string) =>
        $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
      expect((await submit('drop me')).drop).toBe('a hook refused the prompt')
      expect(await board($, 'undo 1')).toBe('Task 1 is open again. Claude was not told yet.')
      await board($, 'done 1')
      await submit('go on')
      expect(contexts).toEqual([[expect.stringContaining(`${ANSWERED} task 1 (do) done.`)]])
    },
  )

  test(
    'six open tasks fold after three, a narrow dock keeps the buttons, and mobile points to /board answer',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await assignFour($)
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: 'Which region for the probe?' })
      await $.tool.call({ tool: TOOL_ASSIGN, kind: 'do', title: 'Restart the probe' })
      for (const surface of SURFACES) {
        const pane = await mountTasks($, surface)
        expect((await pane.find({ key: 'for-more' }))?.text).toBe('+3 more for you')
        expect(await pane.find({ key: 'row:for:4' })).toBeUndefined()
        await pane.press({ key: 'for-more' })
        expect(await pane.find({ key: 'row:for:6' })).toBeDefined()
        await pane.press({ key: 'for-more' })
        await pane.unmount()
      }
      const narrow = await mountTasks($, 'terminal', 'dock', 30)
      expect(await screen(narrow, 30)).toEqual(
        expect.arrayContaining([
          '◆ 1 do     Rotate the staging',
          '           API key',
          '    [ Answer ][Send]',
          '    [ Postgres ] [ SQLite ]',
          '    [ Redis ]',
        ]),
      )
      await narrow.unmount()
      const mobile = await $.ui.mount({
        plugin: PLUGIN,
        surface: 'mobile',
        component: 'Pane',
        requestId: PANE,
        props: paneProps('inline', 76),
      })
      expect(
        await mobile.find({ type: 'Text', text: 'answer: /board answer 2 <text>' }),
      ).toBeDefined()
      await mobile.unmount()
    },
  )
})

const SENT_ANSWER = 'Answer to task 2, "Which port does staging use?": 8443'
const SENT_CHOICE = 'Decision on task 3, "Which cache store for now?": "SQLite"'

const SEND_CRITERION =
  'When the person presses a decide option or Send on an answer task, the board submits the answer as the person prompt at once, or when the session is idle, and shows the exact text it sent.'

describe(SEND_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `Send and a decide option submit the answer as the person's prompt at once, the row shows the exact text, and the Log has one row for each answer, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on)
        await start($)
        await assignFour($)
        const pane = await mountTasks($, surface)
        await pane.input({ key: 'answer:2', text: ' 8443 ' })
        await pane.press({ key: 'for-pick:3:2' })
        expect(entered).toMatchObject([
          { text: SENT_ANSWER, origin: OWN_PROMPT, context: [] },
          { text: SENT_CHOICE, origin: OWN_PROMPT, context: [] },
        ])
        const lines = await screen(pane, 41)
        expect(lines).toEqual(
          expect.arrayContaining([
            '✓ 2 answer  Which port does staging use?',
            '    sent Answer to task 2, "Which port',
            '         does staging use?": 8443',
            '✓ 3 decide  Which cache store for now?',
            '    sent Decision on task 3, "Which cache',
            '         store for now?": "SQLite"',
          ]),
        )
        expect(lines).not.toContain('Claude gets them with your next prompt.')
        expect(seen.toasts).toEqual([])
        await pane.unmount()
        expect(await board($, 'undo 2')).toBe('Task 2 was already sent to Claude. Nothing changed.')
        await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
        expect(entered.at(-1)?.context.filter((text) => text.startsWith(ANSWERED))).toEqual([])
        await $.prompt.submit({
          text: SENT_CHOICE,
          wait: false,
          origin: { kind: 'plugin', name: PLUGIN, asUser: true },
        })
        const logged = (await board($, 'log you')).split('\n')
        expect(logged.map((line) => line.replace(/^\S+ /u, ''))).toEqual([
          'you go on',
          `you ${SENT_CHOICE}`,
          `you ${SENT_ANSWER}`,
        ])
        const after = await mountTasks($, surface)
        expect(await after.find({ key: 'sent:2' })).toBeUndefined()
        expect((await after.find({ key: 'for-answered' }))?.text).toBe('+2 closed')
        await after.unmount()
      },
    )

    test(
      `a submit that a hook holds back fills the prompt box, says so on the row, and the answer reaches Claude once, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on, 'the session is paused.')
        const fills: string[] = []
        on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
        on('prompt.fill', (_$, e) => {
          fills.push(e.text)
          return { isFilled: true }
        })
        await start($)
        await assignFour($)
        const pane = await mountTasks($, surface)
        await pane.press({ key: 'for-pick:3:2' })
        expect(entered).toEqual([])
        expect(fills).toEqual([SENT_CHOICE])
        const lines = await screen(pane, 41)
        expect(joinedWords(forYouLines(lines))).toContain(
          '■ not sent: the prompt was held back: the session is paused; it waits in your prompt box',
        )
        expect(joinedWords(forYouLines(lines))).toContain(`in your prompt box: ${SENT_CHOICE}`)
        await pane.unmount()
        await $.prompt.submit({ text: SENT_CHOICE, wait: false, origin: { kind: 'composer' } })
        expect(entered.at(-1)?.context.filter((text) => text.startsWith(ANSWERED))).toEqual([])
        expect((await board($, 'log you')).split('\n')).toHaveLength(1)
        expect(await board($, 'undo 3')).toBe('Task 3 was already sent to Claude. Nothing changed.')
        const after = await mountTasks($, surface)
        await after.press({ key: 'for-answered' })
        expect(joinedWords(forYouLines(await screen(after, 41)))).not.toContain('not sent')
        await after.unmount()
      },
    )

    test(
      `a submit that fails and a prompt box that refuses the fill leave the answer for the next prompt, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { hasOwnPromptHook: true })
        const entered = enteredPrompts(on, 'the session is paused.')
        on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
        on('prompt.fill', () => ({ isFilled: false }))
        await start($)
        await assignFour($)
        const pane = await mountTasks($, surface)
        await pane.input({ key: 'answer:2', text: '8443' })
        expect(joinedWords(forYouLines(await screen(pane, 41)))).toContain(
          '■ not sent: the prompt was held back: the session is paused; Claude gets it with your next prompt',
        )
        await pane.unmount()
        await $.prompt.submit({ text: 'go on', wait: false, origin: { kind: 'composer' } })
        expect(entered.at(-1)?.context).toEqual([
          expect.stringContaining(`${ANSWERED} task 2 (answer) answered "8443".`),
          expect.stringContaining(`${OPEN_LINE} 1 (do) "Rotate the staging API key"; 3 (decide)`),
        ])
      },
    )
  }
})

const ASKED_WHY =
  'The probe runs every hour and the bill for the eastern region is half of the bill for the western one'

const WRAP_CRITERION =
  'When a task for the person has a long title, question or options, the rows wrap the whole text at 40 and 120 columns instead of cutting it.'

describe(WRAP_CRITERION, () => {
  for (const surface of SURFACES) {
    for (const columns of [40, 120]) {
      test(
        `a long title, why and options wrap in full and every option keeps its button at ${String(columns)} columns on ${surface}`,
        withWorkitems,
        async ($, on) => {
          world(on, { hasOwnPromptHook: true })
          const entered = enteredPrompts(on)
          await start($)
          await $.tool.call({ tool: TOOL_ASSIGN, kind: 'answer', title: ASKED_TITLE })
          await $.tool.call({
            tool: TOOL_ASSIGN,
            kind: 'decide',
            title: ASKED_TITLE,
            options: ASKED_OPTIONS,
            why: ASKED_WHY,
          })
          const pane = await mountTasks($, surface, 'dock', columns)
          await pane.press({ key: 'open:for:2' })
          const lines = forYouLines(await screen(pane, columns))
          expect(lines.join('\n')).not.toContain('…')
          const text = joinedWords(lines)
          expect(text).toContain(`1 answer ${ASKED_TITLE}`)
          expect(text).toContain(`2 decide ${ASKED_TITLE}`)
          expect(text).toContain(ASKED_WHY)
          for (const option of ASKED_OPTIONS) expect(text).toContain(option)
          expect(lines.filter((line) => line.includes(ASKED_TITLE.slice(0, 20)))).toHaveLength(2)
          for (const at of [1, 2, 3, 4]) {
            expect(await pane.find({ key: `for-pick:2:${String(at)}` })).toBeDefined()
          }
          await pane.press({ key: 'for-pick:2:4' })
          const prompt = `Decision on task 2, "${ASKED_TITLE}": "${ASKED_OPTIONS[3] ?? ''}"`
          expect(entered.map((one) => one.text)).toEqual([prompt])
          const sent = forYouLines(await screen(pane, columns))
          expect(sent.join('\n')).not.toContain('…')
          expect(joinedWords(sent)).toContain(`sent ${prompt}`)
          await pane.unmount()
        },
      )
    }
  }
})

const ONE_PANE_CRITERION =
  'When the person runs /board, the board opens one pane, and one close closes it.'

describe(ONE_PANE_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `/board opens only this session, /board machine shows only this machine, and one close leaves no board pane, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await $.session.start({ cwd: ROOT, surface, isInteractive: true })
        expect(await board($, '')).toBe('Board opened: this session.')
        expect(seen.opens).toEqual([{ ...SESSION_OPEN, focus: true }])
        expect(seen.panes).toEqual(new Set([PANE]))
        expect(await board($, 'machine')).toBe('Board opened: this machine.')
        expect(seen.panes).toEqual(new Set([MACHINE]))
        expect(await board($, 'close')).toBe('Board closed.')
        expect(seen.panes.size).toBe(0)
        expect(await board($, '')).toBe('Board opened: this session.')
        expect(await board($, '')).toBe('Board closed.')
        expect(seen.panes.size).toBe(0)
      },
    )
  }
})
