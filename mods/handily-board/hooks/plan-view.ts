import type { BoardPlan } from '../types'
import type { RenderElement } from 'claude-code'
import type { PaneElements } from './pane'
import { addedText, isOffered, stepsText } from './plan'
import { SIGNALS } from './signals'
import { escaped } from './tasks'
import { displayWidth, fitted } from './width'

const INDENT = 2
const STEPS_SHOWN = 2
const NUMBERED_FROM = 36
const BUTTON_GAP = 2
const LINE_KEY = 'plan-line'
const NOT_ADDED = 'not added:'

type LineElements = Pick<PaneElements, 'Box' | 'Text' | 'Button'>

export type PlanActions = { add: () => void; dismiss: () => void }

export function addLabel(plan: BoardPlan): string {
  return `add ${String(plan.steps.length)} as tasks`
}

function warningLines(tasksAfter: number): string[] {
  if (tasksAfter === 0) return []
  const tasks = tasksAfter === 1 ? '1 task' : `${String(tasksAfter)} tasks`
  return [`Claude added ${tasks} after the plan.`, 'Adding it may repeat them.']
}

function headText(plan: BoardPlan, elements: PaneElements): string {
  const count = plan.steps.length
  if (elements.isInline) {
    const first = escaped(plan.steps[0] ?? '')
    return `approved · ${stepsText(count)}: ${first}, +${String(count - 1)}`
  }
  const numbered = elements.bodyColumns >= NUMBERED_FROM ? 'numbered ' : ''
  return `approved · ${String(count)} ${numbered}${count === 1 ? 'step' : 'steps'}`
}

function stepLines(plan: BoardPlan, elements: PaneElements): string[] {
  if (elements.isInline) return []
  const shown = plan.steps.slice(0, STEPS_SHOWN)
  const room = elements.bodyColumns - INDENT
  const lines = shown.map((step, index) => fitted(`${String(index + 1)} ${escaped(step)}`, room))
  const more = plan.steps.length - shown.length
  if (more === 0) return lines
  return [...lines, `… ${String(more)} more ${more === 1 ? 'step' : 'steps'}`]
}

function refusalElements(elements: PaneElements, plan: BoardPlan): RenderElement[] {
  const { Box, Text } = elements
  const [first, ...rest] = plan.refusal ?? []
  if (first === undefined) return []
  const room = elements.bodyColumns - INDENT
  const lead = `${SIGNALS.blocked.mark} ${NOT_ADDED}`
  return [
    Box({
      key: 'plan-refusal',
      flexDirection: 'row',
      paddingLeft: INDENT,
      children: [
        Text({ color: SIGNALS.blocked.color, children: lead }),
        Text({ children: fitted(` ${first}`, Math.max(room - displayWidth(lead), 0)) }),
      ],
    }),
    ...rest.map((line, index) =>
      Box({
        key: `plan-hint:${String(index)}`,
        paddingLeft: INDENT,
        children: [Text({ children: fitted(line, room) })],
      }),
    ),
  ]
}

export function drawPlanBlock(
  elements: PaneElements,
  plan: BoardPlan,
  tasksAfter: number,
  actions: PlanActions,
): RenderElement[] {
  const { Box, Text, Button } = elements
  if (!isOffered(plan) || plan.isDismissed) return []
  const room = elements.bodyColumns - INDENT
  const isOneRow = elements.bodyColumns >= NUMBERED_FROM
  const head = Box({
    key: 'plan-head',
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: 'Plan' }),
      Text({
        dimColor: true,
        children: fitted(`  ${headText(plan, elements)}`, elements.bodyColumns - 'Plan'.length),
      }),
    ],
  })
  const indented = (key: string, text: string, style: { dimColor?: boolean; color?: 'warning' }) =>
    Box({ key, paddingLeft: INDENT, children: [Text({ ...style, children: fitted(text, room) })] })
  const buttons = [
    Button({ key: 'plan-add', label: addLabel(plan), onPress: actions.add }),
    Button({ key: 'plan-dismiss', label: 'dismiss', onPress: actions.dismiss }),
  ]
  return [
    head,
    ...stepLines(plan, elements).map((line, index) =>
      indented(`plan-step:${String(index)}`, line, { dimColor: true }),
    ),
    ...refusalElements(elements, plan),
    ...warningLines(tasksAfter).map((line, index) =>
      indented(`plan-warning:${String(index)}`, line, { color: 'warning' }),
    ),
    Box({
      key: 'plan-actions',
      flexDirection: isOneRow ? 'row' : 'column',
      paddingLeft: INDENT,
      children: buttons.map((button, index) =>
        Box({
          flexShrink: 0,
          marginLeft: isOneRow && index > 0 ? BUTTON_GAP : 0,
          children: [button],
        }),
      ),
    }),
  ]
}

export type PlanLineView = { plan: BoardPlan; isCurrent: boolean; tasksAfter: number }

function lineNote(elements: LineElements, view: PlanLineView): RenderElement {
  const { Box, Text } = elements
  const { plan, tasksAfter } = view
  const [refusal] = plan.refusal ?? []
  if (refusal !== undefined) {
    return Box({
      flexDirection: 'row',
      flexShrink: 1,
      children: [
        Text({ color: SIGNALS.blocked.color, children: `${SIGNALS.blocked.mark} ${NOT_ADDED}` }),
        Text({ wrap: 'truncate-end', children: ` ${refusal}` }),
      ],
    })
  }
  if (tasksAfter > 0) {
    const tasks = tasksAfter === 1 ? '1 task' : `${String(tasksAfter)} tasks`
    return Text({
      color: 'warning',
      wrap: 'truncate-end',
      children: `Claude added ${tasks} after this plan`,
    })
  }
  return Text({
    dimColor: true,
    wrap: 'truncate-end',
    children: 'adds them to the board as pending tasks',
  })
}

export function drawPlanLine(
  elements: LineElements,
  view: PlanLineView,
  add: () => void,
): RenderElement {
  const { Box, Text, Button } = elements
  const { plan } = view
  if (!isOffered(plan)) {
    return Box({
      key: LINE_KEY,
      flexDirection: 'row',
      paddingLeft: INDENT,
      children: [
        Text({ color: SIGNALS.done.color, children: SIGNALS.done.mark }),
        Text({
          dimColor: true,
          wrap: 'truncate-end',
          children: ` added as tasks ${addedText(plan)}`,
        }),
      ],
    })
  }
  if (!view.isCurrent) {
    return Box({
      key: LINE_KEY,
      paddingLeft: INDENT,
      children: [
        Text({
          dimColor: true,
          wrap: 'truncate-end',
          children: `${SIGNALS.toDo.mark} a later plan replaced this one`,
        }),
      ],
    })
  }
  return Box({
    key: LINE_KEY,
    flexDirection: 'row',
    paddingLeft: INDENT,
    children: [
      Box({
        flexShrink: 0,
        children: [
          Button({
            key: 'plan-add',
            label: `add ${stepsText(plan.steps.length)} as tasks`,
            onPress: add,
          }),
        ],
      }),
      Box({ flexShrink: 1, marginLeft: BUTTON_GAP, children: [lineNote(elements, view)] }),
    ],
  })
}
