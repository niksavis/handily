import type {
  On,
  ContextCategoryKind,
  SessionContextBreakdown,
  SessionRateLimit,
} from 'claude-code'
import {
  describe,
  expect,
  mock,
  test,
  type Engine,
  type Mounted,
  type Plugin,
} from 'claude-code/testing'
import { displayWidth } from './hooks/width'
import { agentInfo } from './fixtures/agent-info'
import { EMPTY_CHECKS } from './hooks/checks'
import { detailsText } from './hooks/details'
import { DEFAULT_PALETTE } from './hooks/palette'
import { NO_REQUEST } from './hooks/request'
import { sessionBlockText } from './hooks/session'
import { PLAIN_SIGNALS } from './hooks/toasting'
import { EMPTY_VITALS } from './hooks/vitals'
import { NO_TURN } from './hooks/background'
import {
  ROOT,
  PANE,
  PLUGIN,
  TOOL_ADD,
  TOOL_UPDATE,
  TRACKER_TEXT_IS_DATA,
  fakeWorkitems,
  type World,
  type WorldOptions,
  SKIPPED_COMPACTION,
  SUMMARY,
  world,
  start,
  board,
  modelTool,
  item,
  OPEN_ITEMS,
  okSnapshot,
  publish,
  CHANGED,
  toldAtNextPrompt,
  withWorkitems,
  OWN_SESSION_ID,
  type Drawn,
  drawnOf,
  texts,
  MINUTE,
  START,
  screenOf,
  screen,
  unframed,
  bySurface,
  fromTasks,
  read,
  edit,
  readsOf,
  SURFACES,
  type Surface,
  mockWork,
  mountTab,
  fiveTasks,
  order,
  measure,
  mainTurnStarts,
  mainTurnEnds,
  SESSION_TITLE_LEAD,
  TURN_STATE,
  headRows,
  sessionLine,
  HOUR,
  DAY,
  limitsAt,
  spawnFrom,
  mainTurnTakes,
  compacts,
  stepped,
  stepWorld,
  step,
  startOn,
} from './fixtures/board-kit'

const STATUS_COMMAND_CRITERION =
  'When the person runs /board done 3, /board start 3 or /board open 3, task 3 takes that status and the reply names it'

describe(STATUS_COMMAND_CRITERION, () => {
  test(
    'each status command sets the status and names it in the reply',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await mockWork($, seen)
      const rowOf3 = async () => (String(await modelTool($, {})).split('\n')[3] ?? '').trim()
      expect(await board($, 'done 3')).toBe(
        'Task 3 is now done: "Review the mocks with Codex". Claude is told at your next prompt.',
      )
      expect(await rowOf3()).toBe('3  done         claude   "Review the mocks with Codex"')
      expect(await board($, 'start 3')).toBe(
        'Task 3 is now in progress: "Review the mocks with Codex". Claude is told at your next prompt.',
      )
      expect(await rowOf3()).toBe('3  in progress  claude   "Review the mocks with Codex"')
      expect(await board($, 'open 3')).toBe(
        'Task 3 is now pending: "Review the mocks with Codex". Claude is told at your next prompt.',
      )
      expect(await rowOf3()).toBe('3  pending      claude   "Review the mocks with Codex"')
      expect(await board($, 'open 3')).toBe('Task 3 is already pending. Nothing changed.')
    },
  )

  test(
    'a status command on a tracker task says the tracker text is data',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await publish($, okSnapshot(OPEN_ITEMS))
      await board($, 'add app-cd34')
      expect(await board($, 'start 1')).toBe(
        `Task 1 is now in progress: "app-cd34": "Write the beads reader". Claude is told at your next prompt.\n\n${TRACKER_TEXT_IS_DATA}`,
      )
    },
  )
})

const STATUS_REFUSAL_CRITERION =
  'When the person names a task id that does not exist, the command refuses by name and lists the valid ids'

describe(STATUS_REFUSAL_CRITERION, () => {
  test(
    'a missing number lists the numbers that exist, and a word that is no number names the correct form',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      expect(await board($, 'done 3')).toBe(
        'No task 3. This session has no tasks yet; add one with /board add <text>.',
      )
      await mockWork($, seen)
      await board($, 'rm 2')
      const before = await modelTool($, {})
      for (const word of ['done', 'start', 'open']) {
        expect(await board($, `${word} 9`)).toBe(
          'No task 9. This session has tasks 1, 3-4; /board list prints them.',
        )
        expect(await board($, `${word} three`)).toBe(
          `/board ${word} needs a task number, for example /board ${word} 2.`,
        )
        expect(await board($, word)).toBe(
          `/board ${word} needs a task number, for example /board ${word} 2.`,
        )
      }
      expect(await modelTool($, {})).toBe(before)
    },
  )
})

const ONE_NOTE_CRITERION =
  'When the person changes several statuses in one turn, Claude receives one combined note at the next prompt, not one note per change'

describe(ONE_NOTE_CRITERION, () => {
  test(
    'three changes during a turn reach Claude as one note at the next prompt, and the prompt after it has none',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const session = mock.session(on)
      await start($)
      await mockWork($, seen)
      await toldAtNextPrompt($)
      await $.turn.start({ text: 'write the mocks', turnId: 'turn-2' })
      const ui = await mountTab($, 'desktop', PANE, 'dock', 41)
      await ui.press({ key: 'open:task:3' })
      await ui.press({ key: 'done:3' })
      await ui.unmount()
      await board($, 'start 4')
      await board($, 'open 1')
      expect(session.appended()).toEqual([])
      await $.turn.complete({
        turnId: 'turn-2',
        reason: 'answer',
        answer: 'done',
        durationMs: 1,
        isAborted: false,
      })
      expect(await toldAtNextPrompt($)).toEqual([
        [
          `${CHANGED} it set the status completed on task 3 by claude, titled "Review the mocks with Codex". it set the status in_progress on task 4 by the person: Ask the person about tabs. it set the status pending on task 1 by claude, titled "Read the design".`,
          '',
          'Tasks (1 of 4 done)',
          '  1  pending      claude   "Read the design"',
          '  2  in progress  claude   "Write the tab mocks"',
          '  3  done         claude   "Review the mocks with Codex"',
          '  4  in progress  you      Ask the person about tabs',
        ].join('\n'),
      ])
      expect(await toldAtNextPrompt($)).toEqual([])
    },
  )

  test(
    'a prompt that a hook beneath drops keeps the note, and any next prompt carries it, the plan note only beside a person prompt',
    withWorkitems,
    async ($, on) => {
      world(on, { hasOwnPromptHook: true })
      const rows: { text: string; context: readonly string[] }[] = []
      on('prompt.submit', (_$, e) => {
        if (e.text === 'drop me') return { drop: 'a hook refused the prompt' }
        rows.push({ text: e.text, context: e.context ?? [] })
        return { text: e.text, context: e.context }
      })
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      await readsOf($, 20)
      await board($, 'done 1')
      const submit = (text: string, kind: 'composer' | 'task-notification') =>
        $.prompt.submit({ text, wait: false, origin: { kind } })
      expect((await submit('drop me', 'composer')).drop).toBe('a hook refused the prompt')
      await submit('a background result', 'task-notification')
      await submit('go on', 'composer')
      const note = `${CHANGED} it set the status completed on task 1 by claude, titled "Write the mocks".\n\nTasks (1 of 1 done)\n  1  done         claude   "Write the mocks"`
      expect(rows.map((row) => row.context)).toEqual([
        [note],
        [expect.stringContaining('your task list did not change in 20 tool calls')],
      ])
    },
  )
})

const CLEAR_CRITERION =
  'When the person presses clear done or runs /board clear, every done task leaves the list and the reply names the count'

async function doneWork($: Engine, seen: World): Promise<void> {
  await mockWork($, seen)
  await $.tool.call({ tool: TOOL_ADD, title: 'Draw the narrow dock' })
  await $.tool.call({ tool: TOOL_UPDATE, id: 5, status: 'completed' })
  await toldAtNextPrompt($)
}

describe(CLEAR_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `clear done after the unfolded done tasks removes them on ${surface}, and the next prompt names them`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await doneWork($, seen)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await ui.find({ key: 'clear-done' })).toBeUndefined()
        await ui.press({ key: 'done' })
        const gap = bySurface(surface, '', '    ')
        expect(fromTasks(await screen(ui, 41)).slice(4, 9)).toEqual([
          bySurface(
            surface,
            '○ 4 You: Ask the person about… [ rm ]',
            '○ 4 You: Ask the person about tabs [ rm ]',
          ),
          '[ hide 2 done ]',
          `✓ 1 Read the design            ${gap}[ rm ]`,
          `✓ 5 Draw the narrow dock       ${gap}[ rm ]`,
          '[ clear done ]',
        ])
        const ring = (await ui.findAll({ type: 'Button' })).map((button) => button.key)
        expect(ring.slice(ring.indexOf('done'), ring.indexOf('clear-done') + 1)).toEqual([
          'done',
          'open:task:1',
          'rm:1',
          'open:task:5',
          'rm:5',
          'clear-done',
        ])
        await ui.press({ key: 'clear-done' })
        expect(seen.toasts.at(-1)).toEqual(['✓ Cleared 2 done tasks', 'tasks 1, 5'])
        expect(fromTasks(await screen(ui, 41)).slice(0, 1)).toEqual([
          'Tasks  ▰▱▱ 0/3 · ▶1 ○2 · 14m',
        ])
        expect(await ui.find({ key: 'done' })).toBeUndefined()
        expect(await ui.find({ key: 'clear-done' })).toBeUndefined()
        expect(await toldAtNextPrompt($)).toEqual([
          [
            `${CHANGED} it removed the done tasks 1, 5.`,
            '',
            'Tasks (0 of 3 done)',
            '  2  in progress  claude   "Write the tab mocks"',
            '  3  pending      claude   "Review the mocks with Codex"',
            '  4  pending      you      Ask the person about tabs',
          ].join('\n'),
        ])
        await ui.unmount()
      },
    )
  }

  test('/board clear removes every done task and names the count', withWorkitems, async ($, on) => {
    const seen = world(on)
    await start($)
    await doneWork($, seen)
    await board($, 'done 3')
    expect(await board($, 'clear')).toBe(
      'Cleared 3 done tasks: 1, 3, 5. Claude is told at your next prompt.',
    )
    expect(await modelTool($, {})).toBe(
      [
        'Tasks (0 of 2 done)',
        '  2  in progress  claude   "Write the tab mocks"',
        '  4  pending      you      Ask the person about tabs',
      ].join('\n'),
    )
    await board($, 'done 4')
    expect(await board($, 'clear')).toBe(
      'Cleared 1 done task: 4. Claude is told at your next prompt.',
    )
  })
})

const FULL_LIST_CRITERION =
  'When the list holds 100 tasks of which some are done, adding a task removes no open task and the refusal names /board clear'

describe(FULL_LIST_CRITERION, () => {
  test(
    'a full list with done tasks refuses the person by name with /board clear, Claude with task_update, and keeps every task',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      for (let index = 1; index <= 100; index += 1) {
        await $.tool.call({ tool: TOOL_ADD, title: `Task ${String(index)}` })
      }
      await $.tool.call({ tool: TOOL_UPDATE, id: 7, status: 'completed' })
      await board($, 'done 9')
      const before = String(await modelTool($, {}))
      expect(await board($, 'add One more')).toBe(
        'Not added: the list is full at 100 tasks, and 2 of them are done. Run /board clear to remove the done tasks, or remove one first.',
      )
      expect((await $.tool.call({ tool: TOOL_ADD, title: 'One more' })).deny).toBe(
        `task_add refused: ${MODEL_FULL_REFUSAL}`,
      )
      expect(await modelTool($, {})).toBe(before)
      expect(before.split('\n')).toHaveLength(101)
      expect(await board($, 'clear')).toBe(
        'Cleared 2 done tasks: 7, 9. Claude is told at your next prompt.',
      )
      expect(await board($, 'add One more')).toBe(
        'Added task 101: One more. Claude is told at your next prompt.',
      )
    },
  )
})

const MODEL_FULL_REFUSAL =
  'the list is full at 100 tasks, and 2 of them are done. Remove a done task with task_update and the status removed, then add the task.'

test(
  'a full subagent list with done tasks names task_update, not /board clear, which clears only the list of the main loop',
  withWorkitems,
  async ($, on) => {
    world(on)
    await start($)
    for (let index = 1; index <= 100; index += 1) {
      await $.tool.call({ tool: TOOL_ADD, title: `Task ${String(index)}`, agentId: 'a1' })
    }
    for (const id of [7, 9]) {
      await $.tool.call({ tool: TOOL_UPDATE, id, status: 'completed', agentId: 'a1' })
    }
    expect((await $.tool.call({ tool: TOOL_ADD, title: 'One more', agentId: 'a1' })).deny).toBe(
      `task_add refused: ${MODEL_FULL_REFUSAL}`,
    )
    await $.tool.call({ tool: TOOL_UPDATE, id: 7, status: 'removed', agentId: 'a1' })
    expect(
      (await $.tool.call({ tool: TOOL_ADD, title: 'One more', agentId: 'a1' })).deny,
    ).toBeUndefined()
  },
)

const NOTHING_TO_CLEAR_CRITERION =
  'When there is no done task, /board clear answers that there is nothing to clear and changes nothing'

describe(NOTHING_TO_CLEAR_CRITERION, () => {
  test(
    '/board clear with no done task changes no task and tells Claude nothing',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      expect(await board($, 'clear')).toBe('No done task to clear. Nothing changed.')
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      await $.tool.call({ tool: TOOL_UPDATE, id: 1, status: 'in_progress' })
      await board($, 'add Ask about tabs')
      await toldAtNextPrompt($)
      const before = await modelTool($, {})
      expect(await board($, 'clear')).toBe('No done task to clear. Nothing changed.')
      expect(await modelTool($, {})).toBe(before)
      expect(await toldAtNextPrompt($)).toEqual([])
    },
  )
})

const ONE_PRESS_RM_CRITERION =
  'When the person presses rm on any task row, the task leaves the list with one press'

describe(ONE_PRESS_RM_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `a pending, a done and an in progress task each leave with one press of rm on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await mockWork($, seen)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'done' })
        expect(
          (await ui.findAll({ type: 'Button', text: 'rm' })).map((button) => button.key),
        ).toEqual(['rm:2', 'rm:3', 'rm:4', 'rm:1'])
        await ui.press({ key: 'rm:3' })
        await ui.press({ key: 'rm:1' })
        await ui.press({ key: 'rm:2' })
        expect(seen.toasts).toEqual([])
        expect(fromTasks(await screen(ui, 41))).toEqual([
          'Tasks  ▱ 0/1 · ○1 · 14m',
          bySurface(
            surface,
            '▶ Now  Edit docs/mock… 10 tools · 14m',
            '▶ Now  Edit docs/mocks.md  10 tools · 14m',
          ),
          bySurface(
            surface,
            '○ 4 You: Ask the person about… [ rm ]',
            '○ 4 You: Ask the person about tabs [ rm ]',
          ),
          '',
          '[ Add a task ][Add]',
        ])
        expect(await modelTool($, {})).toBe(
          'Tasks (0 of 1 done)\n  4  pending      you      Ask the person about tabs',
        )
        await ui.unmount()
      },
    )
  }
})

const QUIET_MOVE_CRITERION =
  'When the person moves a task with a pane button and Claude is told, no toast appears'
const CLOSED_ITEM_CRITERION =
  'When the pane adds a tracker item that is closed, the toast starts with the failed mark and names the item id'
const BATCH_NOT_TOLD_CRITERION =
  'When a batch add from the pane is cut short and the note for Claude fails, the toast keeps the refusal and says Claude was not told'
const ONE_LINE_TOAST_CRITERION =
  'When any board toast is shown, its text holds no line break and no tracker notice'

for (const surface of SURFACES) {
  describe(QUIET_MOVE_CRITERION, () => {
    test(
      `up, down, rm and the Input change the list with no toast while Claude is told, and up on the first task still toasts, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await mockWork($, seen)
        await toldAtNextPrompt($)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'open:task:4' })
        await ui.press({ key: 'up:4:3' })
        await ui.press({ key: 'rm:3' })
        await ui.input({ key: 'add', text: 'Write the summary' })
        expect(seen.toasts).toEqual([])
        expect(await toldAtNextPrompt($)).toHaveLength(1)
        await ui.press({ key: 'up:4:2' })
        expect(seen.toasts).toEqual([['○ Nothing changed', 'task 4 is already first']])
        await ui.unmount()
      },
    )
  })

  describe(CLOSED_ITEM_CRITERION, () => {
    test(
      `the Input with the id of a closed item adds nothing and toasts the failed mark, the id and the hint, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await publish($, okSnapshot(OPEN_ITEMS))
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.input({ key: 'add', text: 'app-gh78' })
        expect(seen.toasts).toEqual([
          ['■ Not added', 'app-gh78 is closed in beads', 'Add it as text: /board add -- app-gh78'],
        ])
        expect(seen.toastMs).toEqual([10000])
        expect(await modelTool($, {})).toBe('The task list is empty.')
        await ui.unmount()
      },
    )
  })

  describe(BATCH_NOT_TOLD_CRITERION, () => {
    test(
      `Add N as tasks that the full list cuts short while the note for Claude fails keeps both the refusal and Claude was not told, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        on('state.set', { plugin: 'handily-board', key: 'personChanges' }, () => ({
          deny: 'the state is full',
        }))
        await start($)
        const many = Array.from({ length: 101 }, (_, index) =>
          item(`app-${String(index + 10)}`, `Open item ${String(index + 10)}`, 2, 'open'),
        )
        await publish($, okSnapshot(many))
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'all-items' })
        await ui.press({ key: 'add-all' })
        expect(seen.toasts).toEqual([
          ['■ Not added', 'app-99: the list is full at 100 tasks.…', 'Claude was not told'],
        ])
        expect(seen.toastMs).toEqual([10000])
        expect(String(await modelTool($, {})).split('\n')[0]).toBe('Tasks (0 of 100 done)')
        await ui.unmount()
      },
    )
  })

  describe(ONE_LINE_TOAST_CRITERION, () => {
    test(
      `a tracker task marked done, its id typed again and an empty Input each toast one line of parts with no tracker notice, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await publish($, okSnapshot(OPEN_ITEMS))
        await board($, 'add app-cd34')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'open:task:1' })
        await ui.press({ key: 'done:1' })
        await ui.input({ key: 'add', text: 'app-cd34' })
        await ui.input({ key: 'add', text: '  ' })
        expect(seen.toasts).toEqual([
          ['✓ Task 1 is now done', '"Write the beads reader"'],
          ['○ Nothing changed', 'app-cd34 is already task 1'],
          ['■ Not added', 'type a text or an item id'],
        ])
        for (const text of seen.toastTexts) {
          expect(text).not.toMatch(/[\n\r\u2028\u2029]/)
          expect(text).not.toContain(TRACKER_TEXT_IS_DATA)
          expect(text).not.toContain('not from the person')
        }
        await ui.unmount()
      },
    )
  })
}

const MV_CRITERION =
  'When the person runs /board mv 5 before 2, task 5 sits before task 2, and /board mv 5 top and /board mv 5 bottom move it to the ends'

describe(MV_CRITERION, () => {
  test(
    '/board mv places a task before another task, at the top and at the bottom, and Claude reads every move in one note',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await fiveTasks($)
      expect(await board($, 'mv 5 before 2')).toBe(
        'Moved task 5 before task 2. Claude is told at your next prompt.',
      )
      expect(await order($)).toBe('1 5 2 3 4')
      expect(await board($, 'mv 5 bottom')).toBe(
        'Moved task 5 to the bottom. Claude is told at your next prompt.',
      )
      expect(await order($)).toBe('1 2 3 4 5')
      expect(await board($, 'mv 5 top')).toBe(
        'Moved task 5 to the top. Claude is told at your next prompt.',
      )
      expect(await order($)).toBe('5 1 2 3 4')
      expect(await toldAtNextPrompt($)).toEqual([
        [
          `${CHANGED} it moved task 5 before task 2. it moved task 5 to the bottom. it moved task 5 to the top.`,
          '',
          'Tasks (0 of 5 done)',
          '  5  pending      claude   "Five"',
          '  1  pending      claude   "One"',
          '  2  pending      claude   "Two"',
          '  3  pending      claude   "Three"',
          '  4  pending      claude   "Four"',
        ].join('\n'),
      ])
    },
  )

  test(
    '/board mv to the place a task already has changes nothing and tells Claude nothing',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await fiveTasks($)
      expect(await board($, 'mv 1 top')).toBe('Task 1 is already first. Nothing changed.')
      expect(await board($, 'mv 5 bottom')).toBe('Task 5 is already last. Nothing changed.')
      expect(await board($, 'mv 2 before 3')).toBe(
        'Task 2 is already before task 3. Nothing changed.',
      )
      expect(await order($)).toBe('1 2 3 4 5')
      expect(await toldAtNextPrompt($)).toEqual([])
    },
  )

  test(
    '/board mv refuses a missing task, a wrong form and one task twice by name, with the correct form',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      expect(await board($, 'mv 5 top')).toBe(
        'No task 5. This session has no tasks yet; add one with /board add <text>.',
      )
      await fiveTasks($)
      await board($, 'rm 3')
      expect(await board($, 'mv 3 top')).toBe(
        'No task 3. This session has tasks 1-2, 4-5; /board list prints them.',
      )
      expect(await board($, 'mv 5 before 9')).toBe(
        'No task 9. This session has tasks 1-2, 4-5; /board list prints them.',
      )
      const form =
        '/board mv needs a task number and a place, for example /board mv 5 before 2, /board mv 5 top or /board mv 5 bottom.'
      for (const args of ['mv', 'mv 5', 'mv five top', 'mv 5 up', 'mv 5 before', 'mv 5 top 2']) {
        expect(await board($, args)).toBe(form)
      }
      expect(await board($, 'mv 5 before 5')).toBe(
        '/board mv needs two different tasks, for example /board mv 5 before 2.',
      )
      expect(await order($)).toBe('1 2 4 5')
    },
  )
})

const FOCUS_CRITERION =
  'When the person moves a task with a button, the focus stays on the moved task'

const FOCUS_ASKED = 'handily-board: the focus did not move to '

describe(FOCUS_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `up and down ask for the focus on the same button of the moved task, at its new place, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const asked = () =>
          seen.logs
            .filter((line) => line.startsWith(FOCUS_ASKED))
            .map((line) => line.slice(FOCUS_ASKED.length).split(':', 3).join(':'))
        await start($)
        await mockWork($, seen)
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'open:task:4' })
        const buttons = async () =>
          (await ui.findAll({ type: 'Button' })).map((button) => button.key ?? '')
        const before = await buttons()
        expect(before.slice(before.indexOf('open:task:4'))).toContain('up:4:3')
        await ui.press({ key: 'up:4:3' })
        expect(asked()).toEqual(['up:4:2'])
        const moved = await buttons()
        expect(moved.slice(moved.indexOf('open:task:4'), moved.indexOf('open:task:3'))).toEqual([
          'open:task:4',
          'rm:4',
          'done:4',
          'start:4',
          'up:4:2',
          'down:4:2',
        ])
        await ui.press({ key: 'up:4:2' })
        expect(asked()).toHaveLength(1)
        await ui.press({ key: 'down:4:2' })
        expect(asked()).toEqual(['up:4:2', 'down:4:3'])
        expect(await buttons()).toContain('down:4:3')
        await ui.press({ key: 'open:task:4' })
        await ui.unmount()
      },
    )
  }
})

const QUEUE_CRITERION =
  'Each change of the person reaches Claude exactly once, in order, also when prompts overlap'

type HeldPrompt = { release: (isDropped: boolean) => void }

function holdingPrompts(on: On): {
  rows: { text: string; context: readonly string[] }[]
  held: Map<string, HeldPrompt>
} {
  const rows: { text: string; context: readonly string[] }[] = []
  const held = new Map<string, HeldPrompt>()
  on('prompt.submit', async (_$, e) => {
    if (e.text.startsWith('hold ')) {
      const isDropped = await new Promise<boolean>((resolve) => {
        held.set(e.text, { release: resolve })
      })
      if (isDropped) return { drop: 'a hook refused the prompt' }
    }
    rows.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  return { rows, held }
}

async function waitForHold(held: Map<string, HeldPrompt>, text: string): Promise<HeldPrompt> {
  for (let tries = 0; tries < 1000; tries += 1) {
    const prompt = held.get(text)
    if (prompt) return prompt
    await Promise.resolve()
  }
  throw new Error(`the prompt ${text} never reached the hook beneath`)
}

function submitText($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

const DONE_ONE = `${CHANGED} it set the status completed on task 1 by claude, titled "Write the mocks".`
const OPEN_ONE = `${CHANGED} it set the status pending on task 1 by claude, titled "Write the mocks".`

describe(QUEUE_CRITERION, () => {
  test(
    'a change made while an earlier prompt is still entering reaches the next prompt once, and the note of the earlier prompt is not told twice',
    withWorkitems,
    async ($, on) => {
      world(on, { hasOwnPromptHook: true })
      const { rows, held } = holdingPrompts(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      await board($, 'done 1')
      const first = submitText($, 'hold A')
      const holdA = await waitForHold(held, 'hold A')
      await submitText($, 'B')
      await board($, 'open 1')
      holdA.release(false)
      await first
      await submitText($, 'C')
      expect(rows.map((row) => [row.text, row.context.map((note) => note.split('\n')[0])])).toEqual(
        [
          ['B', []],
          ['hold A', [DONE_ONE]],
          ['C', [OPEN_ONE]],
        ],
      )
    },
  )

  test(
    'a prompt dropped while a change was queued puts its changes back in front, so the next prompt names both in order',
    withWorkitems,
    async ($, on) => {
      world(on, { hasOwnPromptHook: true })
      const { rows, held } = holdingPrompts(on)
      await start($)
      await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
      await board($, 'done 1')
      const first = submitText($, 'hold A')
      const holdA = await waitForHold(held, 'hold A')
      await board($, 'open 1')
      holdA.release(true)
      expect((await first).drop).toBe('a hook refused the prompt')
      await submitText($, 'C')
      expect(rows).toEqual([
        {
          text: 'C',
          context: [
            `${DONE_ONE} it set the status pending on task 1 by claude, titled "Write the mocks".\n\nTasks (0 of 1 done)\n  1  pending      claude   "Write the mocks"`,
          ],
        },
      ])
    },
  )

  test('/clear drops the changes that wait for the next prompt', withWorkitems, async ($, on) => {
    world(on)
    await start($)
    await board($, 'add Write the mocks')
    await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
    expect(await toldAtNextPrompt($)).toEqual([])
  })
})

const HUGE = '1000000000000000000000'

test(
  'a task number past the safe integers is refused by name, and a missing number is echoed as typed',
  withWorkitems,
  async ($, on) => {
    world(on)
    await start($)
    await $.tool.call({ tool: TOOL_ADD, title: 'Write the mocks' })
    await $.tool.call({ tool: TOOL_ADD, title: 'Ship it' })
    const tooLarge = `${HUGE} is too large for a task number. /board list prints the task numbers.`
    for (const args of [
      `done ${HUGE}`,
      `start ${HUGE}`,
      `open ${HUGE}`,
      `rm ${HUGE}`,
      `mv ${HUGE} top`,
      `mv 1 before ${HUGE}`,
    ]) {
      expect(await board($, args)).toBe(tooLarge)
    }
    const missing = 'No task 007. This session has tasks 1-2; /board list prints them.'
    expect(await board($, 'done 007')).toBe(missing)
    expect(await board($, 'mv 007 top')).toBe(missing)
    expect(await board($, 'mv 1 before 007')).toBe(missing)
    expect(await board($, 'rm 007')).toBe(missing)
    expect(await toldAtNextPrompt($)).toEqual([])
  },
)

const SESSION_LINE_CRITERION =
  'When session.measure reports a context and a cost, the this session tab draws the Session line with the context percent and the cost, and the tests check it at 30, 41, 76 and 89 columns'
const NO_USAGE_CRITERION =
  'When the host gives no usage, the line reads no context or cost on this host and draws no number'
const CONTEXT_HIGH_CRITERION =
  'When the context reaches 80 percent, the percent shows with the word high in the warning colour'
const TURN_COST_CRITERION =
  'When a main turn runs, the line shows the cost this turn added since it started'

const UNTIL_REPLY = 'ctx — until the first reply'
const LIMITS_UNTIL_REPLY = `${UNTIL_REPLY} · limits — until the first reply`

async function receiptLine(
  $: Engine,
  surface: Surface,
  columns = 41,
  placement: 'dock' | 'inline' = 'dock',
  key = 'session-receipt',
): Promise<string> {
  const ui = await mountTab($, surface, PANE, placement, columns)

  const row = drawnOf(await ui.find({ key }))
  await ui.unmount()
  return row === null ? '' : row.text
}

function sessionRows(lines: readonly string[]): string[] {
  const flat = unframed(lines)
  const rows = flat.slice(
    0,
    flat.findIndex((line) => line.startsWith('Tasks')),
  )
  return lines[0]?.startsWith('╭') === true ? rows.slice(1) : rows
}

async function sessionTexts($: Engine, surface: Surface, columns: number): Promise<Drawn[]> {
  const ui = await mountTab($, surface, PANE, 'dock', columns)
  const root = drawnOf(await ui.find({ type: 'Box' }))
  await ui.unmount()
  return root === null ? [] : headRows(root).flatMap(texts)
}

const CTX_62 = 'ctx ▰▰▰▰▰▰▱▱▱▱ 62%'
const TOKENS_62 = '124k/200k'
const TURN_RECEIPT = 'turn 0s · 0 edits · 0 errors · +$0.31'
const MOCK_GATE = 'gate 10 ▮▮▮▮▮▮▮▮▮▮'
const MOCK_COUNTS = '10 allowed · 0 asked · 0 denied'
const MOCK_FAMILIES = 'f: file 10  s: shell 0  o: other 0'
const CTX_TOKENS = `${CTX_62} · ${TOKENS_62}`
const WORKING = 'Session  ▶ working'

const TURN_LINES: readonly {
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
  framed?: readonly string[]
}[] = [
  {
    placement: 'dock',
    columns: 30,
    lines: [
      WORKING,
      CTX_TOKENS,
      '$4.18',
      'req —',
      'turn 0s · 0 edits · +$0.31',
      MOCK_GATE,
      '10 allowed · 0 asked',
      '0 denied',
      'f: 10  s: 0  o: 0',
    ],
  },
  {
    placement: 'dock',
    columns: 41,
    lines: [
      WORKING,
      `${CTX_TOKENS} · $4.18`,
      'req —',
      TURN_RECEIPT,
      MOCK_GATE,
      MOCK_COUNTS,
      MOCK_FAMILIES,
    ],
    framed: [CTX_TOKENS, '$4.18', 'req —', TURN_RECEIPT, MOCK_GATE, MOCK_COUNTS, MOCK_FAMILIES],
  },
  {
    placement: 'inline',
    columns: 76,
    lines: [
      `${WORKING} · ${CTX_TOKENS} · $4.18`,
      `    req — · ${TURN_RECEIPT}`,
      `    ${MOCK_GATE} ${MOCK_COUNTS}`,
      `    ${MOCK_FAMILIES}`,
    ],
  },
  {
    placement: 'dock',
    columns: 89,
    lines: [
      WORKING,
      `${CTX_TOKENS} · $4.18`,
      'req —',
      TURN_RECEIPT,
      `${MOCK_GATE} ${MOCK_COUNTS}`,
      MOCK_FAMILIES,
    ],
    framed: [
      CTX_TOKENS,
      '$4.18',
      'req —',
      TURN_RECEIPT,
      `${MOCK_GATE} ${MOCK_COUNTS}`,
      MOCK_FAMILIES,
    ],
  },
]

describe(SESSION_LINE_CRITERION, () => {
  for (const { placement, columns, lines, framed } of TURN_LINES) {
    test(
      `a turn that runs draws the Session section first, as mock B1, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await start($)
        await mockWork($, seen)
        await measure($, { percent: 62, usd: 3.87 })
        await mainTurnStarts($, 'turn-1')
        await measure($, { percent: 62, usd: 4.18 })
        for (const surface of SURFACES) {
          const ui = await mountTab($, surface, PANE, placement, columns)
          const shown = await screen(ui, columns)
          const expected = surface === 'terminal' && framed !== undefined ? framed : lines
          expect(sessionRows(shown)).toEqual(expected)
          expect(fromTasks(shown)[0]).toBe('Tasks  ▰▰▱▱ 1/4 · ▶1 ○2 · 14m')
          await ui.unmount()
        }
      },
    )
  }

  test(
    'the head moves whole pieces to the next line as the body narrows, and the context keeps its gauge and percent',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 62, usd: 3.87 })
      await mainTurnStarts($, 'turn-1')
      await measure($, { usd: 4.18 })
      for (const surface of SURFACES) {
        const head = async (columns: number) => {
          const ui = await mountTab($, surface, PANE, 'dock', columns)
          const rows = sessionRows(await screen(ui, columns))
          await ui.unmount()
          return rows.slice(0, -2)
        }
        const title = 'Session  ▶ working'
        expect(await head(40)).toEqual([title, `${CTX_62} · ${TOKENS_62} · $4.18`])
        expect(await head(34)).toEqual([title, `${CTX_62} · ${TOKENS_62}`, '$4.18'])
        expect(await head(24)).toEqual([title, CTX_62, `${TOKENS_62} · $4.18`])
      }
    },
  )

  test(
    'before the first measure the line reads ctx — until the first reply, as mock 8.10a, and draws no number',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          bySurface(surface, LIMITS_UNTIL_REPLY, UNTIL_REPLY),
        )
        expect(await sessionLine($, surface, 'dock', 30)).toBe(UNTIL_REPLY)
      }
    },
  )

  test(
    'a resumed session draws the context and the cost that $.session.usage gives at session start, before any measure',
    withWorkitems,
    async ($, on) => {
      world(on, {
        usage: {
          startedAt: 1_000,
          context: { window: 200_000, tokens: 80_000, percent: 40 },
          rateLimits: [],
          cost: { usd: 2.5 },
        },
      })
      await start($)
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          'ctx ▰▰▰▰▱▱▱▱▱▱ 40% · 80k/200k · $2.50',
        )
      }
    },
  )

  test(
    'a first measure that reports a cost of 0 before any reply still reads ctx — until the first reply, as mock 8.10a',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { usd: 0 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          bySurface(surface, LIMITS_UNTIL_REPLY, UNTIL_REPLY),
        )
        expect(await sessionLine($, surface, 'dock', 89)).toBe(
          bySurface(surface, LIMITS_UNTIL_REPLY, UNTIL_REPLY),
        )
      }
    },
  )

  test(
    '/clear empties the line to ctx — until the first reply, and a turn after it draws no turn cost that it cannot know',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 91, usd: 4.18 })
      await mainTurnStarts($, 'turn-1')
      await measure($, { usd: 4.8 })
      await mainTurnEnds($, 'turn-1')
      expect(await sessionLine($, 'terminal', 'dock', 89)).toBe(
        'ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k · $4.80',
      )
      expect(await receiptLine($, 'terminal', 89)).toBe('last 0s · 0 edits · 0 errors · +$0.62')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          bySurface(surface, LIMITS_UNTIL_REPLY, UNTIL_REPLY),
        )
        expect(await receiptLine($, surface)).toBe('')
      }
      await mainTurnStarts($, 'turn-2')
      await measure($, { percent: 3, usd: 4.85 })
      expect(await sessionLine($, 'terminal', 'dock', 41)).toBe(
        'ctx ▱▱▱▱▱▱▱▱▱▱ 3% · 6k/200k · $4.85',
      )
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors')
      await mainTurnEnds($, 'turn-2')
      expect(await sessionLine($, 'terminal', 'dock', 41)).toBe(
        'ctx ▱▱▱▱▱▱▱▱▱▱ 3% · 6k/200k · $4.85',
      )
      expect(await receiptLine($, 'terminal')).toBe('last 0s · 0 edits · 0 errors')
    },
  )

  test('a measure changes only the units it names in changed', withWorkitems, async ($, on) => {
    world(on)
    await start($)
    await measure($, { percent: 62, usd: 4.18 })
    await measure($, { percent: 70, usd: 9, changed: ['cost'] })
    expect(await sessionLine($, 'terminal', 'dock', 41)).toBe(`${CTX_62} · ${TOKENS_62} · $9.00`)
    await measure($, { percent: 70, usd: 1, changed: ['context'] })
    expect(await sessionLine($, 'terminal', 'dock', 41)).toBe(
      'ctx ▰▰▰▰▰▰▰▱▱▱ 70% · 140k/200k · $9.00',
    )
  })

  test(
    'a measure redraws the board only when the drawn text changes: the whole percent and the cost to the cent',
    withWorkitems,
    async ($, on) => {
      world(on)
      let redraws = 0
      on('ui.invalidate', (_$, e, next) => {
        if (e.event === 'ui.render') redraws += 1
        return next(e)
      })
      await start($)
      await measure($, { percent: 62, usd: 4.18 })
      expect(redraws).toBe(1)
      await measure($, { usd: 4.183 })
      await measure($, { percent: 62 })
      expect(redraws).toBe(1)
      await measure($, { usd: 4.19 })
      expect(redraws).toBe(2)
      await measure($, { percent: 63 })
      expect(redraws).toBe(3)
    },
  )
})

describe(NO_USAGE_CRITERION, () => {
  test(
    'a host whose $.session.usage refuses draws no context or cost on this host, with no number, at 41 and 30 columns',
    withWorkitems,
    async ($, on) => {
      world(on, { usage: 'refused' })
      await start($)
      for (const surface of SURFACES) {
        const wide = await sessionLine($, surface, 'dock', 41)
        expect(wide).toBe('no context or cost on this host')
        const narrow = await sessionLine($, surface, 'dock', 30)
        expect(narrow).toBe('no context or cost on this ho…')
        expect(`${wide}${narrow}`).not.toMatch(/\d/)
      }
    },
  )

  test(
    'a host that gives usage never draws no context or cost on this host',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      expect(await sessionLine($, 'terminal', 'dock', 41)).not.toContain('on this host')
    },
  )
})

describe(CONTEXT_HIGH_CRITERION, () => {
  test(
    'at 80 percent and more the percent and the word high take the warning colour, as mock 8.10h, and at 79 percent neither shows',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 79, usd: 12.4 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          'ctx ▰▰▰▰▰▰▰▱▱▱ 79% · 158k/200k · $12.40',
        )
        const below = await sessionTexts($, surface, 41)
        expect(below.filter((text) => text.props.color === 'warning')).toEqual([])
      }
      await measure($, { percent: 80 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(
          'ctx ▰▰▰▰▰▰▰▰▱▱ 80% high · 160k/200k · $12.40',
        )
        const at = await sessionTexts($, surface, 41)
        expect(
          at.filter((text) => text.props.color === 'warning').map((text) => text.text),
        ).toEqual(['▰▰▰▰▰▰▰▰', '80% high'])
      }
      await measure($, { percent: 91 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 30)).toBe(
          'ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k · $12.40',
        )
        expect(await sessionLine($, surface, 'inline', 76)).toBe(
          'ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k · $12.40',
        )
      }
    },
  )
})

describe(TURN_COST_CRITERION, () => {
  test(
    'a main turn shows turn +$ while it runs and last +$ after it, as mocks 8.10b and 8.10c, and a subagent turn changes neither',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 62, usd: 4.18 })
      await mainTurnStarts($, 'turn-1')
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(`${CTX_62} · ${TOKENS_62} · $4.18`)
        expect(await receiptLine($, surface)).toBe('turn 0s · 0 edits · 0 errors')
      }
      await measure($, { usd: 4.49 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(`${CTX_62} · ${TOKENS_62} · $4.49`)
        expect(await receiptLine($, surface)).toBe('turn 0s · 0 edits · 0 errors · +$0.31')
      }
      await $.turn.start({ text: 'look', turnId: 'agent-turn', agentId: 'a1' })
      await measure($, { usd: 4.8 })
      await $.turn.complete({
        turnId: 'agent-turn',
        reason: 'answer',
        answer: 'found',
        durationMs: 1,
        isAborted: false,
        agentId: 'a1',
      })
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors · +$0.62')
      await mainTurnEnds($, 'turn-1')
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 41)).toBe(`${CTX_62} · ${TOKENS_62} · $4.80`)
        expect(await receiptLine($, surface)).toBe('last 0s · 0 edits · 0 errors · +$0.62')
      }
      await mainTurnStarts($, 'turn-2')
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors')
      await measure($, { usd: 5.05 })
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors · +$0.25')
    },
  )

  test(
    'a cost total that goes down starts the turn again from the new total and never draws a negative cost',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 62, usd: 4.8 })
      await mainTurnStarts($, 'turn-1')
      await measure($, { usd: 0.05 })
      expect(await sessionLine($, 'terminal', 'dock', 41)).toBe(`${CTX_62} · ${TOKENS_62} · $0.05`)
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors · +$0.00')
      await measure($, { usd: 0.3 })
      expect(await receiptLine($, 'terminal')).toBe('turn 0s · 0 edits · 0 errors · +$0.25')
      await mainTurnEnds($, 'turn-1')
      expect(await receiptLine($, 'terminal')).toBe('last 0s · 0 edits · 0 errors · +$0.25')
      await measure($, { usd: 0.1 })
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'dock', 89)).toBe(`${CTX_62} · ${TOKENS_62} · $0.10`)
        const line = await receiptLine($, surface, 89)
        expect(line).toBe('last 0s · 0 edits · 0 errors · +$0.00')
        expect(line).not.toContain('-')
      }
    },
  )

  test(
    'last +$ waits for a measure after the turn when the turn ends first, and shows at once when the measure came first',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 62, usd: 4.18 })
      await mainTurnStarts($, 'turn-1')
      await mainTurnEnds($, 'turn-1')
      for (const surface of SURFACES) {
        expect(await receiptLine($, surface)).toBe('last 0s · 0 edits · 0 errors')
      }
      await measure($, { usd: 4.8 })
      for (const surface of SURFACES) {
        expect(await receiptLine($, surface)).toBe('last 0s · 0 edits · 0 errors · +$0.62')
      }
      await mainTurnStarts($, 'turn-2')
      await measure($, { usd: 5.05 })
      await mainTurnEnds($, 'turn-2')
      for (const surface of SURFACES) {
        expect(await receiptLine($, surface)).toBe('last 0s · 0 edits · 0 errors · +$0.25')
      }
    },
  )
})

const DETAILS_CRITERION =
  'When the person presses the Session line, the details show the context of the window, the compactions, the last turn time, the cost it added, its edits, errors and spawned agents, and the rate limits with their resets'
const NO_LIMITS_CRITERION =
  'When the plan reports no rate limits, the details say limits: none reported'

async function editAs($: Engine, agentId: string, file: string): Promise<void> {
  await $.tool.call({
    tool: 'Edit',
    file_path: `${ROOT}/${file}`,
    old_string: 'a',
    new_string: 'b',
    agentId,
  })
}

async function detailsScene($: Engine, seen: World): Promise<void> {
  await start($)
  await measure($, { percent: 62, usd: 4.18, limits: limitsAt(seen.clock.now()) })
  await compacts($)
  await mainTurnStarts($, 'turn-1')
  await edit($, 'docs/mocks.md')
  await edit($, 'docs/design.md')
  await read($, 'README.md')
  await edit($, 'README.md')
  await spawnFrom($, 'a1')
  await spawnFrom($, 'a2')
  await spawnFrom($, 'a3', 'a1')
  await editAs($, 'a1', 'hooks/pane.tsx')
  await measure($, { usd: 4.8 })
  await mainTurnTakes($, 'turn-1', 3 * MINUTE + 5_000)
}

async function sessionDetails(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const ui = await mountTab($, surface, PANE, placement, columns)
  if ((await ui.find({ key: 'session-details' })) === undefined) {
    await ui.press({ key: 'session' })
  }
  const root = drawnOf(await ui.find({ type: 'Box' }))
  const body = await detailsOf(ui, columns)
  await ui.unmount()
  const head = (root === null ? [] : headRows(root))
    .map((row) => row.text.replace(SESSION_TITLE_LEAD, '').replace(TURN_STATE, ''))
    .filter((text) => text !== '')
    .join(' · ')
  return [`Session  ${head}`, ...body]
}

const COMPACTIONS_ALONE = /^ {4}\d+ compactions?$/u
const CONTEXT_ALONE = /^ {4}context \S+ of \S+$/u

function withContextJoined(lines: readonly string[]): string[] {
  return lines.reduce<string[]>((joined, line) => {
    const previous = joined.at(-1)
    if (previous !== undefined && CONTEXT_ALONE.test(previous) && COMPACTIONS_ALONE.test(line)) {
      return [...joined.slice(0, -1), `${previous} · ${line.trim()}`]
    }
    return [...joined, line]
  }, [])
}

async function detailsOf(ui: { find: Mounted['find'] }, columns: number): Promise<string[]> {
  const lines = await screen(ui, columns)
  const details = drawnOf(await ui.find({ key: 'session-details' }))
  if (details === null) return []
  const isFramed = lines[0]?.startsWith('╭') === true
  const body = unframed(screenOf(details, columns).map((line) => line.trimEnd()))
  return isFramed ? withContextJoined(body.map((line) => `  ${line}`.trimEnd())) : body
}

const DETAIL_SCREENS: readonly {
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
  receipt: string
  receiptKey?: string
}[] = [
  {
    placement: 'dock',
    columns: 30,
    lines: [
      'Session  ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▱▱▱▱ 31% · 7d 13%',
      '    context 124k of 200k',
      '    1 compaction',
      '    trend after 2 turns',
      '    no breakdown on this host',
      '    limits 5h 31% · 7d 13%',
      '    resets 5h in 2h · 7d in 4d',
      '    pace after 15m of readings',
      '    checks 5 · 5 allowed',
      '    file 5 · shell 0 · other 0',
      '    [ last 5 checks ]',
    ],
    receipt: 'last 3m · 3 edits · +$0.62',
  },
  {
    placement: 'dock',
    columns: 41,
    lines: [
      'Session  ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%',
      '    context 124k of 200k · 1 compaction',
      '    trend after 2 turns',
      '    no breakdown on this host',
      '    limits 5h 31% · 7d 13%',
      '    resets 5h in 2h · 7d in 4d',
      '    pace after 15m of readings',
      '    checks 5 · 5 allowed',
      '    file 5 · shell 0 · other 0',
      '    [ last 5 checks ]',
    ],
    receipt: 'last 3m · 3 edits · 0 errors · +$0.62',
  },
  {
    placement: 'inline',
    columns: 76,
    lines: [
      'Session  ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▱▱▱▱ 31% resets 2h · 7d ▱▱▱▱▱ 13% resets 4d',
      '    context 124k of 200k · 1 compaction',
      '    trend after 2 turns',
      '    no breakdown on this host',
      '    limits 5h 31% · 7d 13% · resets 5h in 2h · 7d in 4d',
      '    pace after 15m of readings',
      '    checks 5 · 5 allowed',
      '    file 5 · shell 0 · other 0',
      '    [ last 5 checks ]',
    ],
    receipt: 'req — · last 3m · 3 edits · 0 errors · +$0.62 · 2 agents spawned',
    receiptKey: 'session-request',
  },
]

describe(DETAILS_CRITERION, () => {
  for (const { placement, columns, lines, receipt, receiptKey } of DETAIL_SCREENS) {
    test(
      `a press on the Session line opens the context, the compactions and the limits, and the receipt row keeps the last turn, as mock B3, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await detailsScene($, seen)
        for (const surface of SURFACES) {
          expect(await sessionDetails($, surface, placement, columns)).toEqual(lines)
          expect(await receiptLine($, surface, columns, placement, receiptKey)).toBe(receipt)
          const ui = await mountTab($, surface, PANE, placement, columns)
          await ui.press({ key: 'session' })
          expect(await ui.find({ key: 'session-details' })).toBeUndefined()
          await ui.unmount()
        }
      },
    )
  }

  test(
    'near the limit the details add that /compact or /clear frees the context, as mock 8.10h, and at 79 percent they do not',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await measure($, { percent: 79, usd: 10.5 })
      await compacts($)
      await compacts($)
      await mainTurnStarts($, 'turn-1')
      for (let index = 0; index < 9; index += 1) await edit($, `docs/file${String(index)}.md`)
      await measure($, { percent: 91, usd: 12.4 })
      await mainTurnTakes($, 'turn-1', 6 * MINUTE)
      for (const surface of SURFACES) {
        expect((await sessionDetails($, surface, 'dock', 41)).slice(0, 7)).toEqual([
          'Session  ctx ▰▰▰▰▰▰▰▰▰▱ 91% high · 182k/200k · $12.40',
          '    context 182k of 200k · 2 compactions',
          '    trend after 2 turns',
          '    no breakdown on this host',
          '    Claude Code compacts it near the',
          '    limit. /compact or /clear frees it.',
          '    limits: none reported',
        ])
        expect(await receiptLine($, surface)).toBe('last 6m · 9 edits · 0 errors · +$1.90')
        expect((await sessionDetails($, surface, 'inline', 76)).slice(1, 5)).toEqual([
          '    context 182k of 200k · 2 compactions',
          '    trend after 2 turns',
          '    no breakdown on this host',
          '    Claude Code compacts it near the limit. /compact or /clear frees it.',
        ])
      }
      await measure($, { percent: 79 })
      for (const surface of SURFACES) {
        const lines = await sessionDetails($, surface, 'dock', 41)
        expect(lines.slice(1, 5)).toEqual([
          '    context 158k of 200k · 2 compactions',
          '    trend after 2 turns',
          '    no breakdown on this host',
          '    limits: none reported',
        ])

        expect(lines.join('\n')).not.toContain('/compact')
      }
    },
  )

  test(
    'only the main loop counts: an error of the main loop takes the error colour, and a subagent call, a subagent compaction, a precompute and a skipped compaction count nothing',
    withWorkitems,
    async ($, on) => {
      world(on, { failingTool: 'Bash' })
      await start($)
      await measure($, { percent: 40, usd: 1 })
      await $.session.compact({ trigger: 'precompute', messages: [SUMMARY] })
      await $.session.compact({ trigger: 'auto', messages: [SUMMARY], agentId: 'a1' })
      await $.session.compact({
        trigger: 'manual',
        messages: [SUMMARY],
        instructions: SKIPPED_COMPACTION,
      })
      await mainTurnStarts($, 'turn-1')
      await $.tool.call({ tool: 'Bash', command: 'npm test' })
      await $.tool.call({ tool: 'Bash', command: 'npm test', agentId: 'a1' })
      await editAs($, 'a1', 'docs/mocks.md')
      await spawnFrom($, 'a2', 'a1')
      await measure($, { usd: 1.25 })
      await mainTurnTakes($, 'turn-1', 45_000)
      for (const surface of SURFACES) {
        expect(await sessionDetails($, surface, 'dock', 41)).toEqual([
          'Session  ctx ▰▰▰▰▱▱▱▱▱▱ 40% · 80k/200k · $1.25',
          '    context 80k of 200k · 0 compactions',
          '    trend after 2 turns',
          '    no breakdown on this host',
          '    limits: none reported',
          '    checks 3 · 3 allowed',
          '    file 1 · shell 2 · other 0',
          '    [ last 3 checks ]',
        ])
        expect(await receiptLine($, surface)).toBe('last 45s · 0 edits · 1 error · +$0.25')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        const errors = await ui.find({ type: 'Text', text: '1 error' })
        expect(errors?.props.color).toBe('error')
        const edits = await ui.find({ type: 'Text', text: '0 edits' })
        expect(edits?.props.color).toBeUndefined()
        await ui.unmount()
      }
    },
  )

  test(
    'while the next turn runs the details keep the last turn and its cost, and /clear empties them',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await detailsScene($, seen)
      await mainTurnStarts($, 'turn-2')
      await edit($, 'docs/mocks.md')
      await measure($, { usd: 5.05 })
      for (const surface of SURFACES) {
        expect((await sessionDetails($, surface, 'dock', 41)).slice(0, 2)).toEqual([
          'Session  ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $5.05 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%',
          '    context 124k of 200k · 1 compaction',
        ])
        expect(await receiptLine($, surface)).toBe('turn 0s · 1 edit · 0 errors · +$0.25')
      }
      await mainTurnTakes($, 'turn-2', 20_000)
      expect(await receiptLine($, 'terminal')).toBe('last 20s · 1 edit · 0 errors · +$0.25')
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await ui.find({ type: 'Button', key: 'session' })).toBeUndefined()
        await ui.unmount()
      }
    },
  )

  test(
    'a compaction and a moved rate limit redraw the board, because the details changed',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      let redraws = 0
      on('ui.invalidate', (_$, e, next) => {
        if (e.event === 'ui.render') redraws += 1
        return next(e)
      })
      await start($)
      await measure($, { percent: 62, usd: 4.18 })
      const before = redraws
      await compacts($)
      expect(redraws).toBe(before + 1)
      await measure($, { limits: limitsAt(seen.clock.now()) })
      expect(redraws).toBe(before + 2)
    },
  )
})

describe('the Session details keep only the facts of the session that runs now', () => {
  test(
    'a failed Edit of the main loop counts as an error and not as an edit',
    withWorkitems,
    async ($, on) => {
      world(on, { failingTool: 'Edit' })
      await start($)
      await measure($, { percent: 40, usd: 1 })
      await mainTurnStarts($, 'turn-1')
      await edit($, 'docs/mocks.md')
      await mainTurnTakes($, 'turn-1', 45_000)
      for (const surface of SURFACES) {
        expect(await receiptLine($, surface)).toBe('last 45s · 0 edits · 1 error')
      }
    },
  )

  test(
    'the limits stay after /clear when the next measure carries them and names only the context and the cost',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      const limits = limitsAt(seen.clock.now())
      await measure($, { percent: 62, usd: 4.18, limits })
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      await measure($, { percent: 3, usd: 4.2, limits, changed: ['context', 'cost'] })
      for (const surface of SURFACES) {
        expect(await sessionDetails($, surface, 'dock', 41)).toEqual([
          'Session  ctx ▱▱▱▱▱▱▱▱▱▱ 3% · 6k/200k · $4.20 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%',
          '    context 6k of 200k · 0 compactions',
          '    trend after 2 turns',
          '    no breakdown on this host',
          '    limits 5h 31% · 7d 13%',
          '    resets 5h in 2h · 7d in 4d',
          '    pace after 15m of readings',
        ])
      }
    },
  )

  test(
    'a resume starts the figures over: no context, no limits, no compaction and no last turn of the session before',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await detailsScene($, seen)
      await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
      await start($)
      for (const surface of SURFACES) {
        expect(await sessionDetails($, surface, 'dock', 41)).toEqual([
          `Session  ${bySurface(surface, LIMITS_UNTIL_REPLY, UNTIL_REPLY)}`,
          '    checks 5 · 5 allowed',
          '    file 5 · shell 0 · other 0',
          '    [ last 5 checks ]',
        ])
      }
    },
  )

  test('a limit whose reset time is past reads now, not in 0s', withWorkitems, async ($, on) => {
    const seen = world(on)
    await start($)
    const now = seen.clock.now()
    const limits = [
      { kind: 'five_hour', percentUsed: 31, resetsAt: new Date(now - 3 * HOUR).toISOString() },
      {
        kind: 'seven_day',
        percentUsed: 13,
        resetsAt: new Date(now + 4 * DAY + HOUR).toISOString(),
      },
    ]
    await measure($, { percent: 62, usd: 4.18, limits })
    for (const surface of SURFACES) {
      const lines = await sessionDetails($, surface, 'dock', 41)
      expect(lines.slice(-3)).toEqual([
        '    limits 5h 31% · 7d 13%',
        '    resets 5h now · 7d in 4d',
        '    pace after 15m of readings',
      ])
    }
  })

  test(
    'a measure that carries the limits and no context fill still shows the limits',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await start($)
      await measure($, { usd: 2, limits: limitsAt(seen.clock.now()) })
      for (const surface of SURFACES) {
        expect(await sessionDetails($, surface, 'dock', 41)).toEqual([
          bySurface(
            surface,
            'Session  ctx — · $2.00 · 5h ▰▱▱▱▱ 31% · 7d ▱▱▱▱▱ 13%',
            'Session  ctx — · $2.00 · 5h ▰▱▱▱▱ 31% · 7d 13%',
          ),

          '    limits 5h 31% · 7d 13%',
          '    resets 5h in 2h · 7d in 4d',
          '    pace after 15m of readings',
        ])
      }
    },
  )
})

const TREND_CRITERION =
  'When the person opens the Session line after two main turns, the board shows the trend line with the token growth for each turn, and the auto-compact line with the turns left.'
const PARTS_CRITERION =
  'When the person presses the context parts button, the board shows each used breakdown row with its engine name, its tokens and its percent of the compaction window, at most 7 rows before a fold button.'
const NO_BREAKDOWN_CRITERION =
  'When the host gives no breakdown, the board shows the words no breakdown on this host and no number.'
const AUTO_COMPACT_OFF_CRITERION =
  'When auto-compact is off, the line reads auto-compact is off and shows no turn count.'
const TREND_RESTART_CRITERION =
  'When a compaction happens, the trend starts again from the next reading.'
const SOON_CRITERION =
  'When two turns or fewer remain, the auto-compact line shows the word soon in the warning colour.'
const PARTS_STATS_CRITERION =
  'When the person runs /board stats, the reply prints the trend, the auto-compact line and the parts as text.'
const PARTS_WIDTH_CRITERION = 'Every new line fits body 41, 30 and 76 in the board width tests.'

type BreakdownRow = readonly [name: string, tokens: number, kind: ContextCategoryKind]

const MOCK_ROWS: readonly BreakdownRow[] = [
  ['System prompt', 3_000, 'used'],
  ['System tools', 18_000, 'used'],
  ['MCP tools', 12_000, 'used'],
  ['Custom agents', 5_000, 'used'],
  ['Memory files', 9_000, 'used'],
  ['Skills', 4_000, 'used'],
  ['Plugins', 2_000, 'used'],
  ['Messages', 71_000, 'used'],
  ['Free space', 43_000, 'free'],
  ['Autocompact buffer', 33_000, 'buffer'],
]

const MOCK_PERCENTS = [5, 20, 47, 50, 53, 56, 59, 62]

function breakdownOf(
  rows: readonly BreakdownRow[],
  threshold: number | null = 167_000,
): SessionContextBreakdown {
  const used = rows
    .filter(([, , kind]) => kind === 'used')
    .reduce((sum, [, tokens]) => sum + tokens, 0)
  return {
    categories: rows.map(([name, tokens, kind]) => ({
      name,
      tokens,
      kind,
      color: 'inactive',
      isDeferred: kind === 'deferred',
    })),
    totalTokens: used,
    maxTokens: 200_000,
    rawMaxTokens: 200_000,
    autocompactSource: 'model-default',
    percentage: Math.round((used / 200_000) * 100),
    gridRows: [],
    model: 'opus',
    memoryFiles: [],
    mcpTools: [],
    agents: [],
    ...(threshold === null ? {} : { autoCompactThreshold: threshold }),
    isAutoCompactEnabled: threshold !== null,
    apiUsage: null,
  }
}

async function turnsAt($: Engine, percents: readonly number[], from = 0): Promise<void> {
  for (const [index, percent] of percents.entries()) {
    const turnId = `trend-${String(from + index)}`
    await mainTurnStarts($, turnId)
    await measure($, { percent, usd: 1 + (from + index) / 10 })
    await mainTurnTakes($, turnId, MINUTE)
  }
}

async function contextLines(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const lines = await sessionDetails($, surface, placement, columns)
  const end = lines.findIndex((line) => /^ {4}(limits|resets|checks)/u.test(line))
  return lines.slice(1, end === -1 ? undefined : end)
}

async function openParts(ui: Awaited<ReturnType<typeof mountTab>>): Promise<void> {
  if ((await ui.find({ key: 'session-details' })) === undefined) {
    await ui.press({ key: 'session' })
  }
  await ui.press({ key: 'session:parts' })
}

const MOCK_PARTS_41 = [
  '    context 124k of 200k · 0 compactions',
  '    trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn',
  '    auto-compact at 167k · in ~7 turns',
  '    [ hide parts ]',
  '    Messages              71k  36%',
  '    System tools          18k   9%',
  '    MCP tools             12k   6%',
  '    Memory files           9k   5%',
  '    Custom agents          5k   3%',
  '    Skills                 4k   2%',
  '    System prompt          3k   2%',
  '    [ +1 more part ]',
  '    free 43k · compact buffer 33k',
  '    estimated; /context counts exactly',
]

describe(TREND_CRITERION, () => {
  test(
    'after one main turn the lines wait for a second, and after two they show the growth for each turn and the turns left',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, [31])
      for (const surface of SURFACES) {
        expect(await contextLines($, surface, 'dock', 41)).toEqual([
          '    context 62k of 200k · 0 compactions',
          '    trend after 2 turns',
          '    auto-compact at 167k',
          '    [ context parts ]',
        ])
      }
      await turnsAt($, [34], 1)
      for (const surface of SURFACES) {
        expect(await contextLines($, surface, 'dock', 41)).toEqual([
          '    context 68k of 200k · 0 compactions',
          '    trend ▃▃ 2 turns · +6k a turn',
          '    auto-compact at 167k · in ~16 turns',
          '    [ context parts ]',
        ])
      }
    },
  )

  test(
    'the growth is the mean of the last 5 main turns, a subagent turn adds no reading, and a flat trend says no growth',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, MOCK_PERCENTS)
      await $.turn.start({ text: 'look', turnId: 'agent-turn', agentId: 'a1' })
      await measure($, { percent: 90 })
      await $.turn.complete({
        turnId: 'agent-turn',
        reason: 'answer',
        answer: 'found',
        durationMs: 1,
        isAborted: false,
        agentId: 'a1',
      })
      await measure($, { percent: 62 })
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41)).slice(1, 3)).toEqual([
          '    trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn',
          '    auto-compact at 167k · in ~7 turns',
        ])
      }
      await turnsAt($, [62, 61, 62, 60, 59], 8)
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41)).slice(1, 3)).toEqual([
          '    trend ▁▂▄▄▅▅▅▅▅▅▅▅▅ no growth',
          '    auto-compact at 167k · no growth',
        ])
      }
    },
  )

  for (const surface of SURFACES) {
    test(
      `the breakdown is counted when the details open and at each main turn end while the board shows them, never while the board is closed or the details are, and once when the board shows them again, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        await turnsAt($, [31, 34])
        expect(seen.breakdownCalls).toBe(0)
        await board($, '')
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'session' })
        expect(seen.breakdownCalls).toBe(1)
        await turnsAt($, [37], 2)
        expect(seen.breakdownCalls).toBe(2)
        await ui.unmount()
        await board($, 'close')
        await turnsAt($, [40, 43], 3)
        expect(seen.breakdownCalls).toBe(2)
        await board($, '')
        const shown = await mountTab($, surface, PANE, 'dock', 41)
        expect(seen.breakdownCalls).toBe(3)
        expect((await detailsOf(shown, 41))[2]).toBe('    auto-compact at 167k · in ~13 turns')
        await shown.press({ key: 'session' })
        await turnsAt($, [46], 5)
        expect(seen.breakdownCalls).toBe(3)
        await shown.unmount()
      },
    )

    test(
      `an answered turn whose measure comes after turn.complete gives its own reading, and the last measure of the turn is the reading, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        for (const [index, percent] of [31, 34, 37].entries()) {
          const turnId = `late-${String(index)}`
          await mainTurnStarts($, turnId)
          await measure($, { percent: percent - 2 })
          await mainTurnTakes($, turnId, MINUTE)
          await measure($, { percent })
        }
        expect((await contextLines($, surface, 'dock', 41)).slice(1, 3)).toEqual([
          '    trend ▃▃▃ 3 turns · +6k a turn',
          '    auto-compact at 167k · in ~15 turns',
        ])
      },
    )

    test(
      `a main turn that ends with no new context measure, as an aborted or failed turn, adds no reading, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        await turnsAt($, [31, 34])
        await mainTurnStarts($, 'aborted')
        await $.turn.complete({
          turnId: 'aborted',
          reason: 'answer',
          answer: '',
          durationMs: 1,
          isAborted: true,
        })
        await mainTurnStarts($, 'failed')
        await measure($, { usd: 2 })
        await mainTurnTakes($, 'failed', MINUTE)
        expect((await contextLines($, surface, 'dock', 41)).slice(1, 3)).toEqual([
          '    trend ▃▃ 2 turns · +6k a turn',
          '    auto-compact at 167k · in ~16 turns',
        ])
        await turnsAt($, [37], 2)
        expect((await contextLines($, surface, 'dock', 41))[1]).toBe(
          '    trend ▃▃▃ 3 turns · +6k a turn',
        )
      },
    )

    test(
      `more than 99 turns left read over 99 turns, and 99 turns left read ~99 turns, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        await turnsAt($, [33, 33.5])
        const over = [
          { placement: 'dock', columns: 41, line: '    compact at 167k · over 99 turns' },
          { placement: 'dock', columns: 30, line: '    compact 167k · 99+ turns' },
          { placement: 'inline', columns: 76, line: '    auto-compact at 167k · in over 99 turns' },
        ] as const
        for (const { placement, columns, line } of over) {
          const lines = await contextLines($, surface, placement, columns)
          expect(lines.find((text) => /^ {4}(auto-)?compact /.test(text))).toBe(line)
        }
        await turnsAt($, [34], 2)
        expect((await contextLines($, surface, 'dock', 41))[2]).toBe(
          '    auto-compact at 167k · in ~99 turns',
        )
      },
    )

    test(
      `after a resume the board counts the parts once when it draws the details that stayed open, so the auto-compact line shows with no press, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        await turnsAt($, [31, 34])
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await ui.press({ key: 'session' })
        await ui.unmount()
        expect(seen.breakdownCalls).toBe(1)
        await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
        await startOn($, surface)
        await turnsAt($, [10, 13], 2)
        const shown = await mountTab($, surface, PANE, 'dock', 41)
        expect(seen.breakdownCalls).toBe(2)
        expect((await detailsOf(shown, 41)).slice(0, 3)).toEqual([
          '    context 26k of 200k · 0 compactions',
          '    trend ▁▂ 2 turns · +6k a turn',
          '    auto-compact at 167k · in ~23 turns',
        ])
        await shown.unmount()
      },
    )
  }
})

describe(PARTS_CRITERION, () => {
  test(
    'a press on context parts lists the used rows by tokens with the engine names and the percent of the compaction window, 7 rows before a fold, as mock 8.14b',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, MOCK_PERCENTS)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await openParts(ui)
        const lines = await detailsOf(ui, 41)
        expect(lines.slice(0, MOCK_PARTS_41.length)).toEqual(MOCK_PARTS_41)
        expect(await ui.find({ type: 'Button', key: 'session:parts' })).toBeDefined()
        await ui.press({ key: 'session:parts:all' })
        const all = await detailsOf(ui, 41)
        expect(all.slice(10, 13)).toEqual([
          '    System prompt          3k   2%',
          '    Plugins                2k   1%',
          '    [ fewer parts ]',
        ])
        await ui.press({ key: 'session:parts:all' })
        await ui.press({ key: 'session:parts' })
        const closed = await detailsOf(ui, 41)
        expect(closed[3]).toBe('    [ context parts ]')
        expect(closed.join('\n')).not.toContain('Messages')
        await ui.unmount()
      }
    },
  )

  test(
    'the rows follow the kind of each row and never its name: a used row named Free space is a part, and a free row named Messages is free space',
    withWorkitems,
    async ($, on) => {
      world(on, {
        breakdown: breakdownOf([
          ['Free space', 50_000, 'used'],
          ['Messages', 40_000, 'free'],
          ['Autocompact buffer', 33_000, 'buffer'],
          ['MCP tools', 20_000, 'deferred'],
        ]),
      })
      await start($)
      await turnsAt($, [25, 28])
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        await openParts(ui)
        const lines = await detailsOf(ui, 41)
        expect(lines.slice(3, 8)).toEqual([
          '    [ hide parts ]',
          '    Free space            50k  25%',
          '    free 40k · compact buffer 33k',
          '    on demand 20k, not in the window',
          '    estimated; /context counts exactly',
        ])
        await ui.press({ key: 'session:parts' })
        await ui.unmount()
      }
    },
  )
})

describe(NO_BREAKDOWN_CRITERION, () => {
  test(
    'a host that answers with no breakdown shows no breakdown on this host, with no number and no parts button',
    withWorkitems,
    async ($, on) => {
      world(on)
      await start($)
      await turnsAt($, [31, 34])
      for (const surface of SURFACES) {
        for (const columns of [41, 30]) {
          const lines = await contextLines($, surface, 'dock', columns)
          const line = lines.find((text) => text.includes('breakdown'))
          expect(line).toBe('    no breakdown on this host')
          expect(line).not.toMatch(/\d/)
          expect(lines.join('\n')).not.toContain('context parts')
        }
      }
    },
  )

  test(
    'a breakdown call that fails says parts failed and where /context shows them, logs the cause, and a press asks again',
    withWorkitems,
    async ($, on) => {
      const options: WorldOptions = { breakdown: 'refused' }
      const seen = world(on, options)
      await start($)
      await turnsAt($, [31, 34])
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41)).slice(2)).toEqual([
          '    parts failed; /context shows them',
          '    [ context parts ]',
        ])
        expect((await contextLines($, surface, 'dock', 30)).slice(3)).toEqual([
          '    parts failed; see /context',
          '    [ context parts ]',
        ])
      }
      expect(seen.logs.some((log) => log.includes('the context parts were not counted'))).toBe(true)
      options.breakdown = breakdownOf(MOCK_ROWS)
      const ui = await mountTab($, 'terminal', PANE, 'dock', 41)
      await ui.press({ key: 'session:parts' })
      expect((await detailsOf(ui, 41))[2]).toBe('    auto-compact at 167k · in ~16 turns')
      await ui.unmount()
    },
  )
})

describe(AUTO_COMPACT_OFF_CRITERION, () => {
  test(
    'with auto-compact off the line reads auto-compact is off, with no threshold and no turn count',
    withWorkitems,
    async ($, on) => {
      world(on, {
        breakdown: breakdownOf(
          MOCK_ROWS.filter(([, , kind]) => kind !== 'buffer'),
          null,
        ),
      })
      await start($)
      await turnsAt($, [31, 34])
      for (const surface of SURFACES) {
        for (const columns of [41, 30]) {
          const lines = await contextLines($, surface, 'dock', columns)
          const line = lines.find((text) => text.includes('auto-compact'))
          expect(line).toBe('    auto-compact is off')
          expect(lines.join('\n')).not.toMatch(/turns? left|~\d|in ~/)
        }
      }
    },
  )
})

describe(TREND_RESTART_CRITERION, () => {
  test(
    'a compaction empties the trend, a turn end before a new reading adds nothing, and the readings after it start a new trend',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, [20, 30, 40])
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41))[1]).toBe(
          '    trend ▂▃▄ 3 turns · +20k a turn',
        )
      }
      await mainTurnStarts($, 'turn-compacted')
      await compacts($)
      await mainTurnTakes($, 'turn-compacted', MINUTE)
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41)).slice(0, 3)).toEqual([
          '    context 80k of 200k · 1 compaction',
          '    trend after 2 turns',
          '    auto-compact at 167k',
        ])
      }
      await turnsAt($, [10, 13], 3)
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41)).slice(1, 3)).toEqual([
          '    trend ▁▂ 2 turns · +6k a turn',
          '    auto-compact at 167k · in ~23 turns',
        ])
      }
    },
  )

  test(
    'a skipped compaction and a compaction of a subagent keep the trend',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, [20, 30])
      await $.session.compact({ trigger: 'auto', messages: [SUMMARY], agentId: 'a1' })
      await $.session.compact({
        trigger: 'manual',
        messages: [SUMMARY],
        instructions: SKIPPED_COMPACTION,
      })
      await turnsAt($, [40], 2)
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41))[1]).toBe(
          '    trend ▂▃▄ 3 turns · +20k a turn',
        )
      }
    },
  )
})

describe(SOON_CRITERION, () => {
  test(
    'from 2 turns left the line says soon in the warning colour, and at 3 turns left it does not',
    withWorkitems,
    async ($, on) => {
      world(on, { breakdown: breakdownOf(MOCK_ROWS) })
      await start($)
      await turnsAt($, [71.5, 74.5])
      for (const surface of SURFACES) {
        expect((await contextLines($, surface, 'dock', 41))[2]).toBe(
          '    auto-compact at 167k · in ~3 turns',
        )
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await ui.find({ type: 'Text', text: 'soon' })).toBeUndefined()
        await ui.unmount()
      }
      const steps: readonly { percent: number; wide: string; narrow: string }[] = [
        { percent: 77.5, wide: 'auto-compact soon: ~2 turns', narrow: 'compact soon: ~2 turns' },
        { percent: 80.5, wide: 'auto-compact soon: ~1 turn', narrow: 'auto-compact soon: ~1 turn' },
        { percent: 83.5, wide: 'auto-compact soon: next turn', narrow: 'compact soon: next turn' },
      ]
      for (const [index, { percent, wide, narrow }] of steps.entries()) {
        await turnsAt($, [percent], 2 + index)
        for (const surface of SURFACES) {
          expect((await contextLines($, surface, 'dock', 41))[2]).toBe(`    ${wide}`)
          expect((await contextLines($, surface, 'dock', 30))[3]).toBe(`    ${narrow}`)
          const ui = await mountTab($, surface, PANE, 'dock', 41)
          const soon = await ui.find({ type: 'Text', text: 'soon' })
          expect(soon?.props.color).toBe('warning')
          await ui.unmount()
        }
      }
    },
  )
})

for (const surface of SURFACES) {
  describe(PARTS_STATS_CRITERION, () => {
    test(
      `the reply prints the trend, the auto-compact line and every part with the free space, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await startOn($, surface)
        await turnsAt($, MOCK_PERCENTS)
        expect(await board($, 'stats')).toBe(
          [
            'Session  ctx 62% · $1.70',
            '    last 1m · 0 edits · 0 errors · +$0.10',
            '    context 124k of 200k · 0 compactions',
            '    trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn',
            '    auto-compact at 167k · in ~7 turns',
            '    Messages              71k  36%',
            '    System tools          18k   9%',
            '    MCP tools             12k   6%',
            '    Memory files           9k   5%',
            '    Custom agents          5k   3%',
            '    Skills                 4k   2%',
            '    System prompt          3k   2%',
            '    Plugins                2k   1%',
            '    free 43k · compact buffer 33k',
            '    estimated; /context counts exactly',
            '    limits: none reported',
            '    Context 124k of 200k tokens.',
            'No agents yet.',
          ].join('\n'),
        )
        expect(seen.breakdownCalls).toBe(1)
      },
    )

    test(
      `the reply keeps at most 20 readings and says no breakdown on this host where the host gives none, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await startOn($, surface)
        await turnsAt(
          $,
          Array.from({ length: 25 }, (_, index) => index + 1),
        )
        const lines = (await board($, 'stats')).split('\n')
        expect(lines.slice(2, 5)).toEqual([
          '    context 50k of 200k · 0 compactions',
          '    trend ▁▁▁▁▁▁▁▂▂▂▂▂▂▂▂▂▂▂▂▂ 20 turns · +2k a turn',
          '    no breakdown on this host',
        ])
      },
    )
  })
}

const PARTS_SCREENS: readonly {
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
}[] = [
  { placement: 'dock', columns: 41, lines: MOCK_PARTS_41 },
  {
    placement: 'dock',
    columns: 30,
    lines: [
      '    context 124k of 200k',
      '    0 compactions',
      '    trend ▁▂▄▄▅▅▅▅ +6k/turn',
      '    compact at 167k · ~7 turns',
      '    [ hide parts ]',
      '    Messages          71k  36%',
      '    System tools      18k   9%',
      '    MCP tools         12k   6%',
      '    Memory files       9k   5%',
      '    Custom agents      5k   3%',
      '    Skills             4k   2%',
      '    System prompt      3k   2%',
      '    [ +1 more part ]',
      '    free 43k · buffer 33k',
      '    estimated; /context exact',
    ],
  },
  {
    placement: 'inline',
    columns: 76,
    lines: [
      '    context 124k of 200k · 0 compactions',
      '    trend ▁▂▄▄▅▅▅▅ 8 turns · +6k a turn',
      '    auto-compact at 167k · in ~7 turns',
      '    [ hide parts ]',
      '    Messages              71k  36%     System tools          18k   9%',
      '    MCP tools             12k   6%     Memory files           9k   5%',
      '    Custom agents          5k   3%     Skills                 4k   2%',
      '    System prompt          3k   2%     Plugins                2k   1%',
      '    free 43k · compact buffer 33k',
      '    estimated; /context counts exactly',
    ],
  },
]

describe(PARTS_WIDTH_CRITERION, () => {
  for (const { placement, columns, lines } of PARTS_SCREENS) {
    test(
      `the trend, the auto-compact line and the open parts fit body ${String(columns)}, ${placement}`,
      withWorkitems,
      async ($, on) => {
        world(on, { breakdown: breakdownOf(MOCK_ROWS) })
        await start($)
        await turnsAt($, MOCK_PERCENTS)
        for (const surface of SURFACES) {
          const ui = await mountTab($, surface, PANE, placement, columns)
          await openParts(ui)
          const drawn = await screen(ui, columns)
          expect((await detailsOf(ui, columns)).slice(0, lines.length)).toEqual(lines)
          for (const line of drawn) expect(displayWidth(line)).toBeLessThanOrEqual(columns)

          await ui.press({ key: 'session:parts' })
          await ui.unmount()
        }
      },
    )
  }

  test(
    'a long trend, a long engine name and the state lines fit body 30 and 24',
    withWorkitems,
    async ($, on) => {
      world(on, {
        breakdown: breakdownOf([
          ['A very long category name from a later engine', 60_000, 'used'],
          ['Free space', 100_000, 'free'],
          ['Autocompact buffer', 33_000, 'buffer'],
          ['Deferred tools', 20_000, 'deferred'],
        ]),
      })
      await start($)
      await turnsAt(
        $,
        Array.from({ length: 20 }, (_, index) => 10 + index),
      )
      for (const surface of SURFACES) {
        for (const columns of [30, 24]) {
          const ui = await mountTab($, surface, PANE, 'dock', columns)
          await openParts(ui)
          const drawn = await screen(ui, columns)
          for (const line of drawn) expect(displayWidth(line)).toBeLessThanOrEqual(columns)
          expect(
            drawn.some((line) => line.startsWith('    trend ') && line.endsWith('/turn')),
          ).toBe(true)
          expect(drawn.some((line) => line.startsWith('    A very l'))).toBe(true)
          await ui.press({ key: 'session:parts' })
          await ui.unmount()
        }
      }
    },
  )
})

describe(NO_LIMITS_CRITERION, () => {
  for (const { placement, columns } of DETAIL_SCREENS) {
    test(
      `a plan that reports no rate limits shows limits: none reported, as mock 8.10i, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        world(on)
        await start($)
        await measure($, { percent: 62, usd: 4.18 })
        for (const surface of SURFACES) {
          const lines = await sessionDetails($, surface, placement, columns)
          expect(lines.at(-1)).toBe('    limits: none reported')
          expect(lines.join('\n')).not.toContain('resets')
        }
      },
    )
  }

  test(
    'on a host with no usage the details say nothing about the context and the limits',
    withWorkitems,
    async ($, on) => {
      world(on, { usage: 'refused' })
      await start($)
      await mainTurnStarts($, 'turn-1')
      await mainTurnTakes($, 'turn-1', 5_000)
      for (const surface of SURFACES) {
        const ui = await mountTab($, surface, PANE, 'dock', 41)
        expect(await ui.find({ type: 'Button', key: 'session' })).toBeUndefined()
        expect(await ui.find({ key: 'session-details' })).toBeUndefined()
        await ui.unmount()
        expect(await sessionLine($, surface, 'dock', 41)).toBe('no context or cost on this host')
        expect(await receiptLine($, surface)).toBe('last 5s · 0 edits · 0 errors')
      }
    },
  )
})

const PACE_CRITERION =
  'When the 5 hour or weekly usage rises over at least 15 minutes of readings and reaches 100 percent before its reset at that pace, the Session line shows full with a tilde and the projected time, such as full ~1h, as the mocks recorded on this record on 2026-11-12.'
const NO_PACE_CRITERION =
  'When there are fewer than 2 readings, less than 15 minutes of readings, flat or falling use, or a last reading over 30 minutes old, the Session line shows no projection, and when Claude Code reports no limits the details read limits: none reported; no number is invented.'
const LIMIT_WARN_CRITERION =
  'When the usage crosses 80 or 95 percent, the sessions of this machine show one toast per level and cycle through one store key per limit kind, with the known limit that two sessions passing the read-back at once can both warn.'

const PACE_START = START
const PACE_RESET = PACE_START + 2 * HOUR + 30 * MINUTE
const WEEK_RESET = PACE_START + 4 * DAY + 2 * HOUR
const CLAIM_WAIT_AT_MOST = 800
const FIVE_HOUR_KEY = 'limit-warned:five_hour'
const OTHER_SESSION_ID = '00000000-0000-4000-8000-00000000000b'
const NO_PACE_LINE =
  'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▱▱ 62% resets 2h · 7d ▱▱▱▱▱ 13% resets 4d'

function paceLimits(fiveHour: number, fiveReset: number | null = PACE_RESET): SessionRateLimit[] {
  return [
    {
      kind: 'five_hour',
      percentUsed: fiveHour,
      ...(fiveReset === null ? {} : { resetsAt: new Date(fiveReset).toISOString() }),
    },
    { kind: 'seven_day', percentUsed: 12.6, resetsAt: new Date(WEEK_RESET).toISOString() },
  ]
}

async function paceReadings(
  $: Engine,
  seen: World,
  readings: readonly { after: number; fiveHour: number; reset?: number | null }[],
): Promise<void> {
  await seen.clock.set(PACE_START)
  await start($)
  for (const reading of readings) {
    await seen.clock.advance(reading.after)
    await measure($, {
      percent: 62,
      usd: 4.8,
      limits: paceLimits(
        reading.fiveHour,
        reading.reset === undefined ? PACE_RESET : reading.reset,
      ),
    })
  }
}

const RISING = [
  { after: 0, fiveHour: 54 },
  { after: 8 * MINUTE, fiveHour: 58 },
  { after: 8 * MINUTE, fiveHour: 62 },
]

function paceRows(lines: readonly string[]): string[] {
  const first = lines.findIndex((line) => line.startsWith('    pace'))
  return first === -1 ? [] : lines.slice(first)
}

function sharedStore(
  on: On,
  entries: Readonly<Record<string, unknown>> = {},
): Map<string, unknown> {
  const store = new Map<string, unknown>(Object.entries(entries))
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
  return store
}

function warnedKey(level: number, by: string, cycle: number | null = PACE_RESET) {
  return {
    v: 1,
    kind: 'five_hour',
    cycle: cycle === null ? null : new Date(cycle).toISOString(),
    level,
    at: PACE_START,
    by,
  }
}

describe(PACE_CRITERION, () => {
  test(
    'rising readings over 16 minutes show full ~1h before the resets on the Session line and in the details, as the mock of handily-cver9',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, RISING)
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'inline', 76)).toBe(
          'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▱▱ 62% full ~1h resets 2h · 7d ▱▱▱▱▱ 13% resets 4d',
        )
        const lines = await sessionDetails($, surface, 'dock', 41)
        expect(paceRows(lines)).toEqual(['    pace 5h full ~1h · 7d no growth'])
      }
    },
  )

  test(
    'at 80 percent or more the limit keeps the word high before the projection, as the mock of handily-cver9',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, [
        { after: 0, fiveHour: 78 },
        { after: 15 * MINUTE, fiveHour: 84 },
      ])
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'inline', 76)).toBe(
          'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▰▱ 84% high full ~40m resets 2h · 7d ▱▱▱▱▱ 13% resets 4d',
        )
      }
    },
  )

  test(
    'below 56 columns the resets drop, a line with no room drops the gauge before the projection, and the projection stays, at 40 and 30 columns',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, RISING)
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'inline', 40)).toBe(
          'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h 62% full ~1h · 7d ▱▱▱▱▱ 13%',
        )
        expect(await sessionLine($, surface, 'dock', 30)).toBe(
          'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▱▱ 62% full ~1h · 7d ▱▱▱▱▱ 13%',
        )
      }
    },
  )

  test(
    'a /clear keeps the readings, so the next measure of the limits keeps the projection',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, RISING.slice(0, 2))
      await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
      await seen.clock.advance(8 * MINUTE)
      await measure($, { percent: 62, usd: 4.8, limits: paceLimits(62) })
      for (const surface of SURFACES) {
        const lines = await sessionDetails($, surface, 'dock', 41)
        expect(paceRows(lines)).toEqual(['    pace 5h full ~1h · 7d no growth'])
      }
    },
  )
})

describe(NO_PACE_CRITERION, () => {
  const cases: readonly {
    name: string
    readings: readonly { after: number; fiveHour: number; reset?: number }[]
    later?: number
    pace: readonly string[]
    line?: string
  }[] = [
    {
      name: 'one reading',
      readings: [{ after: 0, fiveHour: 62 }],
      pace: ['    pace after 15m of readings'],
    },
    {
      name: 'two readings 10 minutes apart',
      readings: [
        { after: 0, fiveHour: 54 },
        { after: 10 * MINUTE, fiveHour: 62 },
      ],
      pace: ['    pace after 15m of readings'],
    },
    {
      name: 'flat use over 16 minutes',
      readings: [
        { after: 0, fiveHour: 62 },
        { after: 8 * MINUTE, fiveHour: 62 },
        { after: 8 * MINUTE, fiveHour: 62 },
      ],
      pace: ['    pace 5h no growth · 7d no growth'],
    },
    {
      name: 'falling use',
      readings: [
        { after: 0, fiveHour: 66 },
        { after: 8 * MINUTE, fiveHour: 68 },
        { after: 8 * MINUTE, fiveHour: 62 },
      ],
      pace: ['    pace 5h no pace yet · 7d no growth'],
    },
    {
      name: 'a last reading 31 minutes old',
      readings: RISING,
      later: 31 * MINUTE,
      pace: ['    pace: no reading for 31m'],
      line: 'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▱▱ 62% resets 1h · 7d ▱▱▱▱▱ 13% resets 4d',
    },
    {
      name: 'a pace that fills after the reset',
      readings: RISING.map((reading) => ({ ...reading, reset: PACE_START + 46 * MINUTE })),
      pace: ['    pace 5h full after reset', '    7d no growth'],
      line: 'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▱▱ 62% resets 30m · 7d ▱▱▱▱▱ 13% resets 4d',
    },
  ]
  for (const { name, readings, later, pace, line } of cases) {
    test(
      `${name} shows no projection on the Session line and says why in the details`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        await paceReadings($, seen, readings)
        if (later !== undefined) await seen.clock.advance(later)
        for (const surface of SURFACES) {
          expect(await sessionLine($, surface, 'inline', 76)).toBe(line ?? NO_PACE_LINE)
          const lines = await sessionDetails($, surface, 'dock', 41)
          expect(paceRows(lines)).toEqual(pace)
          expect(lines.join('\n')).not.toContain('full ~')
        }
      },
    )
  }

  test(
    'a projected time that passed with no new reading shows no projection and names the age of the last reading',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, [
        { after: 0, fiveHour: 80 },
        { after: 15 * MINUTE, fiveHour: 90 },
      ])
      await seen.clock.advance(20 * MINUTE)
      for (const surface of SURFACES) {
        expect(await sessionLine($, surface, 'inline', 76)).toBe(
          'ctx ▰▰▰▰▰▰▱▱▱▱ 62% · 124k/200k · $4.80 · 5h ▰▰▰▰▱ 90% high resets 1h · 7d ▱▱▱▱▱ 13% resets 4d',
        )
        const lines = await sessionDetails($, surface, 'dock', 41)
        expect(paceRows(lines)).toEqual(['    pace 5h no reading for 20m', '    7d no growth'])
      }
    },
  )

  test(
    'with no rate limits the details read limits: none reported and draw no pace line',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await seen.clock.set(PACE_START)
      await start($)
      await measure($, { percent: 62, usd: 4.18 })
      await seen.clock.advance(16 * MINUTE)
      await measure($, { percent: 64, usd: 4.3 })
      for (const surface of SURFACES) {
        const lines = await sessionDetails($, surface, 'dock', 41)
        expect(lines.at(-1)).toBe('    limits: none reported')
        expect(paceRows(lines)).toEqual([])
      }
    },
  )

  test('a vitals value with limits and no readings draws no projection', () => {
    const vitals = {
      ...EMPTY_VITALS,
      percent: 62,
      tokens: 124_000,
      window: 200_000,
      usd: 4.8,
      limits: paceLimits(62),
    }
    const view = {
      vitals,
      background: NO_TURN,
      waits: 0,
      checks: EMPTY_CHECKS,
      request: NO_REQUEST,
      now: PACE_START,
      signals: PLAIN_SIGNALS,
      palette: DEFAULT_PALETTE,
      hasResets: true,
    }
    expect(sessionBlockText(view)).not.toContain('full ~')
    expect(detailsText(vitals, PACE_START).split('\n')).toContain('pace after 15m of readings')
  })
})

describe(LIMIT_WARN_CRITERION, () => {
  for (const surface of SURFACES) {
    test(
      `crossing 80 and then 95 percent shows one toast for each level and writes one store key for the limit, on ${surface}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on, { surfaces: [surface] })
        const store = sharedStore(on)
        await paceReadings($, seen, [
          { after: 0, fiveHour: 78 },
          { after: MINUTE, fiveHour: 81 },
          { after: 100, fiveHour: 82 },
        ])
        await seen.clock.advance(CLAIM_WAIT_AT_MOST)
        await measure($, { percent: 62, usd: 4.8, limits: paceLimits(83) })
        await seen.clock.advance(CLAIM_WAIT_AT_MOST)
        expect(seen.toasts).toEqual([['◆ 5h limit at 80%', 'no pace yet · resets in 2h']])
        expect(store.get(FIVE_HOUR_KEY)).toEqual({
          ...warnedKey(80, OWN_SESSION_ID),
          at: PACE_START + MINUTE,
        })
        expect([...store.keys()].filter((key) => key.startsWith('limit-warned:'))).toEqual([
          FIVE_HOUR_KEY,
        ])
        await measure($, { percent: 62, usd: 4.8, limits: paceLimits(96) })
        await seen.clock.advance(CLAIM_WAIT_AT_MOST)
        expect(seen.toasts).toEqual([
          ['◆ 5h limit at 80%', 'no pace yet · resets in 2h'],
          ['◆ 5h limit at 95% nearly full', 'no pace yet · resets in 2h'],
        ])
        expect(seen.toastMs).toEqual([10000, 10000])
      },
    )
  }

  test(
    'a toast after 15 minutes of rising readings names the projection and the reset',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      sharedStore(on)
      await paceReadings($, seen, [
        { after: 0, fiveHour: 74 },
        { after: 15 * MINUTE, fiveHour: 80 },
      ])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([['◆ 5h limit at 80%', 'full ~50m at this pace · resets in 2h']])
    },
  )

  test(
    'with glyphs nerd the toast draws the nerd mark of waitsForYou on the terminal',
    withWorkitems,
    async ($, on) => {
      const seen = world(on, { glyphs: 'nerd' })
      sharedStore(on)
      await paceReadings($, seen, [{ after: 0, fiveHour: 81 }])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([['\u{EAA2} 5h limit at 80%', 'no pace yet · resets in 2h']])
    },
  )

  test(
    'two measures that cross 80 percent at once in one session show one toast',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      sharedStore(on)
      await paceReadings($, seen, [{ after: 0, fiveHour: 78 }])
      await Promise.all([
        measure($, { percent: 62, usd: 4.8, limits: paceLimits(84) }),
        measure($, { percent: 62, usd: 4.8, limits: paceLimits(85) }),
      ])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([['◆ 5h limit at 80%', 'no pace yet · resets in 2h']])
    },
  )

  test(
    'a limit whose reset time is past shows no toast and keeps the key of another session',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const claimed = warnedKey(80, OTHER_SESSION_ID, PACE_RESET)
      const store = sharedStore(on, { [FIVE_HOUR_KEY]: claimed })
      await paceReadings($, seen, [{ after: 0, fiveHour: 84, reset: PACE_START - HOUR }])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      await measure($, { percent: 62, usd: 4.8, limits: paceLimits(85, PACE_START - HOUR) })
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([])
      expect(store.get(FIVE_HOUR_KEY)).toEqual(claimed)
    },
  )

  test(
    'a session that finds the key of this cycle claimed by another session shows no toast',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const claimed = warnedKey(80, OTHER_SESSION_ID)
      const store = sharedStore(on, { [FIVE_HOUR_KEY]: claimed })
      await paceReadings($, seen, [{ after: 0, fiveHour: 84 }])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([])
      expect(store.get(FIVE_HOUR_KEY)).toEqual(claimed)
    },
  )

  test(
    'a session whose claim another session overwrote before the read-back shows no toast',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const store = sharedStore(on)
      await paceReadings($, seen, [{ after: 0, fiveHour: 84 }])
      expect(store.get(FIVE_HOUR_KEY)).toMatchObject({ by: OWN_SESSION_ID, level: 80 })
      store.set(FIVE_HOUR_KEY, warnedKey(80, OTHER_SESSION_ID))
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([])
    },
  )

  test('a new cycle after the reset warns again at 80 percent', withWorkitems, async ($, on) => {
    const seen = world(on)
    const store = sharedStore(on)
    await paceReadings($, seen, [{ after: 0, fiveHour: 81 }])
    await seen.clock.advance(CLAIM_WAIT_AT_MOST)
    await seen.clock.set(PACE_RESET + MINUTE)
    const nextReset = PACE_RESET + 5 * HOUR
    await measure($, { percent: 62, usd: 4.8, limits: paceLimits(85, nextReset) })
    await seen.clock.advance(CLAIM_WAIT_AT_MOST)
    expect(seen.toasts).toEqual([
      ['◆ 5h limit at 80%', 'no pace yet · resets in 2h'],
      ['◆ 5h limit at 80%', 'no pace yet · resets in 4h'],
    ])
    expect(store.get(FIVE_HOUR_KEY)).toMatchObject({
      cycle: new Date(nextReset).toISOString(),
      by: OWN_SESSION_ID,
    })
  })

  test(
    'with no reset time a fall of 20 points starts a new cycle that warns again',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      sharedStore(on)
      await paceReadings($, seen, [{ after: 0, fiveHour: 85, reset: null }])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      await measure($, { percent: 62, usd: 4.8, limits: paceLimits(60, null) })
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      await measure($, { percent: 62, usd: 4.8, limits: paceLimits(82, null) })
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([
        ['◆ 5h limit at 80%', 'no pace yet'],
        ['◆ 5h limit at 80%', 'no pace yet'],
      ])
    },
  )

  test(
    'at session start a key of a past cycle and a key it cannot read are deleted, and a key of this cycle stays',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const current = {
        ...warnedKey(80, OTHER_SESSION_ID),
        kind: 'seven_day',
        cycle: new Date(WEEK_RESET).toISOString(),
      }
      const store = sharedStore(on, {
        [FIVE_HOUR_KEY]: warnedKey(95, OTHER_SESSION_ID, PACE_START - HOUR),
        'limit-warned:spend_limit': { v: 2, kind: 'spend_limit' },
        'limit-warned:seven_day': current,
      })
      await seen.clock.set(PACE_START)
      await start($)
      expect(store.has(FIVE_HOUR_KEY)).toBe(false)
      expect(store.has('limit-warned:spend_limit')).toBe(false)
      expect(store.get('limit-warned:seven_day')).toEqual(current)
    },
  )

  test(
    'a session whose store fails shows no toast and logs the cause',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      await paceReadings($, seen, [{ after: 0, fiveHour: 84 }])
      await seen.clock.advance(CLAIM_WAIT_AT_MOST)
      expect(seen.toasts).toEqual([])
      expect(seen.logs.some((line) => line.includes('the limit warning'))).toBe(true)
    },
  )
})

const AGENT_TOKENS_CRITERION =
  'When a subagent step completes, the opened row shows that agent context and its output tokens'
const MAX_TOKENS_CRITERION =
  'When a step stops at max_tokens, the opened row says stopped at max_tokens'
const MAIN_STEP_CRITERION =
  'When a main loop step streams, the hook passes the stream on without reading its chunks'

const STEP_AGENT = 'a0000007explore'

async function stepAgentWorks($: Engine, seen: World, calls: number): Promise<void> {
  await start($)
  await spawnFrom($, STEP_AGENT)
  seen.agents.push(
    agentInfo({
      id: STEP_AGENT,
      type: 'Explore',
      status: 'running',
      description: 'find the element table',
    }),
  )
  for (let index = 0; index < calls; index += 1) {
    await $.tool.call({
      tool: 'Read',
      file_path: `${ROOT}/hooks/file${String(index)}.ts`,
      agentId: STEP_AGENT,
    })
  }
}

const OPENED_HEAD = /^(?:\d: )?▶ Expl|^\d Explore, opened:/u

async function openedAgent(
  $: Engine,
  surface: Surface,
  placement: 'dock' | 'inline',
  columns: number,
): Promise<string[]> {
  const ui = await mountTab($, surface, PANE, placement, columns)
  if ((await ui.find({ key: `under:agent:${STEP_AGENT}` })) === undefined) {
    await ui.press({ key: `open:agent:${STEP_AGENT}` })
  }
  const lines = unframed(await screen(ui, columns))
  await ui.unmount()
  const after = lines.slice(lines.findIndex((line) => OPENED_HEAD.test(line)) + 1)
  const end = after.findIndex((line) => !line.startsWith(' '))
  return (end < 0 ? after : after.slice(0, end)).map((line) => line.trimStart())
}

const TOKEN_SCREENS: readonly {
  placement: 'dock' | 'inline'
  columns: number
  lines: readonly string[]
}[] = [
  { placement: 'dock', columns: 30, lines: ['7 tool calls · ctx 48k', 'out 6.1k'] },
  { placement: 'dock', columns: 41, lines: ['7 tool calls · ctx 48k · out 6.1k'] },
  { placement: 'inline', columns: 76, lines: ['7 tool calls · ctx 48k · out 6.1k'] },
]

describe(AGENT_TOKENS_CRITERION, () => {
  for (const { placement, columns, lines } of TOKEN_SCREENS) {
    test(
      `the opened row shows the context of the latest step and its output tokens, as mock 8.10g, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const steps = stepWorld(on)
        await stepAgentWorks($, seen, 7)
        const early = { fresh: 300, written: 900, read: 3_000, output: 450 }
        await step($, steps, STEP_AGENT, stepped('turn-1', early, 'tool_use'))
        const late = { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 }
        await step($, steps, STEP_AGENT, stepped('turn-1', late, 'tool_use'))
        await step($, steps, STEP_AGENT, stepped('turn-1', null, null))
        await step($, steps, undefined, stepped('turn-main', late, 'end_turn'))
        for (const surface of SURFACES) {
          const opened = await openedAgent($, surface, placement, columns)
          expect(opened.slice(2, 2 + lines.length)).toEqual(lines)
        }
      },
    )
  }

  test(
    'an agent with no step yet keeps the tool count alone, and a main loop step adds no agent row and no tokens',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const steps = stepWorld(on)
      await stepAgentWorks($, seen, 1)
      const usage = { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 }
      await step($, steps, undefined, stepped('turn-main', usage, 'end_turn'))
      await step($, steps, 'a0000099other', stepped('turn-9', usage, 'end_turn'))
      for (const surface of SURFACES) {
        const opened = await openedAgent($, surface, 'dock', 41)
        expect(opened[2]).toBe('1 tool call')
        expect(opened.join('\n')).not.toContain('ctx')
      }
    },
  )
})

describe('the tokens of an agent step redraw the board only when they change, and a session end clears them', () => {
  test(
    'a step redraws the board when the drawn tokens change, a step with the same drawn tokens or no usage does not, and a main loop step redraws for its request count',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const steps = stepWorld(on)
      let redraws = 0
      on('ui.invalidate', (_$, e, next) => {
        if (e.event === 'ui.render') redraws += 1
        return next(e)
      })
      await stepAgentWorks($, seen, 1)
      await step($, steps, undefined, stepped('turn-main', null, null))
      const before = redraws
      const usage = { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 }
      await step($, steps, STEP_AGENT, stepped('turn-1', usage, 'tool_use'))
      expect(redraws).toBe(before + 1)
      const same = { ...usage, read: 40_200, output: 6_120 }
      await step($, steps, STEP_AGENT, stepped('turn-1', same, 'end_turn'))
      await step($, steps, STEP_AGENT, stepped('turn-1', null, null))
      expect(redraws).toBe(before + 1)
      await step($, steps, undefined, stepped('turn-main', { ...usage, read: 90_000 }, 'end_turn'))
      expect(redraws).toBe(before + 2)
      await step($, steps, STEP_AGENT, stepped('turn-1', { ...usage, read: 90_000 }, 'tool_use'))
      expect(redraws).toBe(before + 3)
    },
  )

  test(
    'a session end clears the tokens, so an agent that the engine still lists shows no old tokens',
    withWorkitems,
    async ($, on) => {
      const seen = world(on)
      const steps = stepWorld(on)
      await stepAgentWorks($, seen, 1)
      const usage = { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 }
      await step($, steps, STEP_AGENT, stepped('turn-1', usage, 'tool_use'))
      expect((await openedAgent($, 'terminal', 'dock', 41)).join('\n')).toContain('ctx 48k')
      await $.session.end({ reason: 'resume', sessionId: 's1', resume: { id: 's1' } })
      await start($)
      for (const surface of SURFACES) {
        const opened = await openedAgent($, surface, 'dock', 41)
        expect(opened.length).toBeGreaterThan(0)
        expect(opened.join('\n')).not.toContain('ctx')
      }
    },
  )
})

describe(MAX_TOKENS_CRITERION, () => {
  for (const { placement, columns } of TOKEN_SCREENS) {
    test(
      `a step that stopped at max_tokens shows stopped at max_tokens with the context in the warning colour, as mock 8.10i, at ${String(columns)} columns, ${placement}`,
      withWorkitems,
      async ($, on) => {
        const seen = world(on)
        const steps = stepWorld(on)
        await stepAgentWorks($, seen, 7)
        const full = { fresh: 1_000, written: 5_000, read: 192_000, output: 32_000 }
        await step($, steps, STEP_AGENT, stepped('turn-1', full, 'max_tokens'))
        const wide = columns > 30
        for (const surface of SURFACES) {
          const opened = await openedAgent($, surface, placement, columns)
          expect(opened.slice(2, wide ? 4 : 5)).toEqual(
            wide
              ? ['7 tool calls', 'stopped at max_tokens · ctx 198k']
              : ['7 tool calls', 'stopped at max_tokens', 'ctx 198k'],
          )
          const ui = await mountTab($, surface, PANE, placement, columns)
          const stopped = await ui.find({ type: 'Text', text: 'stopped at max_tokens' })
          expect(stopped?.props.color).toBe('warning')
          await ui.unmount()
        }
        const next = { fresh: 1_000, written: 5_000, read: 150_000, output: 900 }
        await step($, steps, STEP_AGENT, stepped('turn-1', next, 'end_turn'))
        for (const surface of SURFACES) {
          const opened = await openedAgent($, surface, placement, columns)
          expect(opened.join('\n')).not.toContain('max_tokens')
          expect(opened.join(' ')).toContain('ctx 156k')
        }
      },
    )
  }
})

const STEP_LINKS_LOG = 'step links '

const watchSteps: Plugin = {
  name: 'watch-steps',
  tier: 'prepend',
  register(on) {
    on('turn.step', async function* ($, e, next) {
      const result = yield* next(e)
      const links = next.trace.map((link) => ({ plugin: link.plugin, outcome: link.outcome }))
      $.ui.log(`step links ${JSON.stringify({ agentId: e.agentId ?? null, links })}`)
      return result
    })
  },
}

type StepLinks = {
  agentId: string | null
  links: { plugin: string; outcome: string }[]
}

function stepLinks(seen: World): StepLinks[] {
  return seen.logs
    .filter((text) => text.startsWith(STEP_LINKS_LOG))
    .map((text) => JSON.parse(text.slice(STEP_LINKS_LOG.length)) as StepLinks)
}

const STREAM_LOOPS: readonly { loop: string; agentId: string | undefined }[] = [
  { loop: 'a main loop step', agentId: undefined },
  { loop: 'a subagent step', agentId: STEP_AGENT },
]

describe(MAIN_STEP_CRITERION, () => {
  for (const { loop, agentId } of STREAM_LOOPS) {
    test(
      `${loop} passes each chunk on as it arrives and the result unchanged, through the board link that the chain ran`,
      { plugins: [fakeWorkitems, watchSteps] },
      async ($, on) => {
        const seen = world(on)
        const steps = stepWorld(on)
        await start($)
        let open = (): void => undefined
        steps.gate = new Promise((resolve) => {
          open = resolve
        })
        steps.chunks = [
          { kind: 'text', index: 0, text: 'one' },
          { kind: 'text', index: 0, text: ' two' },
          { kind: 'text', index: 0, text: ' three' },
        ]
        const usage = { fresh: 2_000, written: 6_000, read: 40_000, output: 6_100 }
        steps.next = stepped('turn-1', usage, 'end_turn')
        const stream = $.turn.step({
          turnId: 'turn-1',
          index: 0,
          model: 'opus',
          messageCount: 3,
          ...(agentId === undefined ? {} : { agentId }),
        })
        const first = await stream.next()
        expect(first.value).toEqual({ kind: 'text', index: 0, text: 'one' })
        open()
        const rest: unknown[] = []
        let read = await stream.next()
        while (read.done !== true) {
          rest.push(read.value)
          read = await stream.next()
        }
        expect(rest).toEqual([
          { kind: 'text', index: 0, text: ' two' },
          { kind: 'text', index: 0, text: ' three' },
        ])
        expect(read.value).toEqual(stepped('turn-1', usage, 'end_turn'))
        const [watched] = stepLinks(seen)
        expect(watched?.agentId).toBe(agentId ?? null)
        expect(watched?.links.map((link) => [link.plugin, link.outcome])).toEqual([
          [PLUGIN, 'returned'],
          ['test', 'returned'],
        ])
      },
    )
  }
})
