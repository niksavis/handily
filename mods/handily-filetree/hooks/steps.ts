import type { RenderElement, RenderSurface } from 'claude-code'
import { BUTTON_GAP, type ButtonSpec, buttonOf, buttonRows, rowWidth } from './buttons'
import { takenHunks } from './diff'
import {
  EDITS_KEPT,
  type EditChange,
  type EditPatch,
  type LastTurn,
  PATCH_LINES,
  type TurnEdit,
  isLaterEdited,
} from './edits'
import type { GitView } from './gitview'
import { CHROME_LINES, chromeBudget } from './lookpane'
import { ageText } from './marks'
import {
  INLINE_ROWS,
  type PaneElements,
  type TouchDraw,
  drawHeader,
  shownName,
  wrapped,
} from './pane'
import { countText } from './source'
import { displayWidth, fitted } from './width'

export type StepActions = {
  move: (at: number) => void
  back: () => void
  copy: (text: string, surface: RenderSurface) => void
}

export type StepView = {
  elements: PaneElements
  git: GitView
  touched: TouchDraw
  last: LastTurn
  at: number
  actions: StepActions
}

type Shown = { edit: TurnEdit; path: string; label: string }

const RULE = '─'
const EDIT_MARK = '✎'
const PART_GAP = ' · '
const TITLE_GAP = '  '
const LAST_TURN = 'last turn'
const THIS_EDIT_ONLY = 'this edit only, not the file vs HEAD'
const HELD = 'held for your review; the file is unchanged until you accept it'
const USER_MODIFIED = 'you changed this edit before it ran'
const NO_PATCH = 'the diff was too large or timed out'
const NOTEBOOK = 'a notebook cell changed; diff in the tree shows the file against HEAD'
const LATER = 'a later edit changed this file again'
const PANE_FULL = 'the pane is full; the rest of this edit is not shown'
const DOCK_HINT = 'a dock (fullscreen, 110 columns) shows the whole patch'
const INLINE_TOP_ROWS = 2

function detailOf(change: EditChange): string {
  switch (change.kind) {
    case 'patch':
      return change.isNew ? 'new' : `+${countText(change.added)} -${countText(change.removed)}`
    case 'held':
      return 'held'
    case 'no-patch':
      return 'no patch'
    case 'notebook':
      return ''
  }
}

function headParts(view: StepView, isShort: boolean): string[] {
  const { last, at, touched } = view
  const kept = last.edits.length
  const isCut = last.total > kept
  const edit = last.edits[at - 1]
  const first = kept > 1 && at === 1 && !isCut ? ['first'] : []
  const final = kept > 1 && at === kept ? ['last'] : []
  const turn = isCut ? `first ${String(EDITS_KEPT)} kept` : LAST_TURN
  const age = edit === undefined ? [] : [ageText(touched.now - edit.at)]
  const whole = isShort ? [] : [turn]
  return [`edit ${String(at)} of ${String(kept)}`, ...first, ...final, ...whole, ...age]
}

function headText(view: StepView, width: number): string {
  const full = headParts(view, false).join(PART_GAP)
  if (displayWidth(full) <= width) return full
  return fitted(headParts(view, true).join(PART_GAP), width)
}

function tailText(shown: Shown, isShort: boolean): string {
  const { edit, label } = shown
  const detail = detailOf(edit.change)
  if (isShort) return `${TITLE_GAP}${EDIT_MARK} ${label}${detail === '' ? '' : ` ${detail}`}`
  const words = detail === '' ? [edit.tool] : [edit.tool, detail]
  return `${TITLE_GAP}${EDIT_MARK} ${label}${PART_GAP}${words.join(PART_GAP)}`
}

function titleText(shown: Shown, width: number): string {
  const full = `${shown.path}${tailText(shown, false)}`
  if (displayWidth(full) <= width) return full
  const tail = tailText(shown, true)
  const room = width - displayWidth(tail)
  return fitted(`${fitted(shown.path, Math.max(room, 1))}${tail}`, width)
}

function notesOf(view: StepView, change: EditChange): string[] {
  const later = isLaterEdited(view.last, view.at) ? [LATER] : []
  switch (change.kind) {
    case 'patch':
      return [...(change.isUserModified ? [USER_MODIFIED] : []), ...later]
    case 'held':
      return [HELD, ...later]
    case 'no-patch':
      return [...(change.isUserModified ? [USER_MODIFIED] : []), NO_PATCH, ...later]
    case 'notebook':
      return [NOTEBOOK, ...later]
  }
}

function shownOf(view: StepView): Shown | undefined {
  const edit = view.last.edits[view.at - 1]
  if (edit === undefined) return undefined
  const { touched } = view
  return {
    edit,
    path: shownName(touched.shownPath(edit.path)),
    label: shownName(touched.labelOf(edit.agent)),
  }
}

function stepButtons(view: StepView, shown: Shown): ButtonSpec[] {
  const { actions, at } = view
  return [
    {
      key: 'back',
      label: 'back',
      hotkey: 'b',
      onPress: () => {
        actions.back()
      },
    },
    {
      key: 'prev-edit',
      label: 'prev',
      hotkey: 'p',
      onPress: () => {
        actions.move(at - 1)
      },
    },
    {
      key: 'next-edit',
      label: 'next',
      hotkey: 'n',
      autoFocus: true,
      onPress: () => {
        actions.move(at + 1)
      },
    },
    {
      key: 'copy-path',
      label: 'copy path',
      hotkey: 'y',
      onPress: (e) => {
        actions.copy(view.touched.shownPath(shown.edit.path), e.surface)
      },
    },
  ]
}

function dimLines(elements: PaneElements, texts: readonly string[]): RenderElement[] {
  const { Text, bodyColumns } = elements
  return texts.flatMap((text) =>
    wrapped(text, bodyColumns).map((part) => Text({ dimColor: true, children: part })),
  )
}

function droppedNote(patch: EditPatch): string[] {
  if (patch.dropped === 0) return []
  return [`+${countText(patch.dropped)} lines not kept; ${String(PATCH_LINES)} per edit`]
}

function patchBody(view: StepView, shown: Shown, patch: EditPatch): RenderElement[] {
  const { elements } = view
  const { Code, Text, bodyColumns } = elements
  const budget = chromeBudget(CHROME_LINES, bodyColumns)
  const taken = takenHunks(patch.hunks, budget)
  const isFull = taken.cut !== undefined || taken.shownHunks < patch.hunks.length
  const rule = Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) })
  const code =
    taken.source === ''
      ? []
      : [Code({ source: taken.source, path: shown.path, format: 'diff' as const })]
  return [
    rule,
    ...code,
    ...dimLines(elements, [...droppedNote(patch), ...(isFull ? [PANE_FULL] : [])]),
    Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) }),
    ...dimLines(elements, [THIS_EDIT_ONLY]),
  ]
}

export function drawSteps(view: StepView, rootName: string): RenderElement {
  const { elements, git } = view
  const { Box, Text, bodyColumns } = elements
  const shown = shownOf(view)
  const top = drawHeader(elements, rootName, git.header, bodyColumns)
  if (shown === undefined) return Box({ flexDirection: 'column', children: [top] })
  const { change } = shown.edit
  return Box({
    flexDirection: 'column',
    children: [
      top,
      ...buttonRows(elements, stepButtons(view, shown), {
        room: bodyColumns,
        indent: 0,
        key: 'steps',
      }),
      Text({ children: headText(view, bodyColumns) }),
      Text({ children: titleText(shown, bodyColumns) }),
      ...dimLines(elements, notesOf(view, change)),
      ...(change.kind === 'patch' ? patchBody(view, shown, change) : []),
    ],
  })
}

function inlineLine(view: StepView, shown: Shown): string {
  const { bodyColumns } = view.elements
  const head = `${headParts(view, false).join(PART_GAP)}${PART_GAP}`
  return fitted(`${head}${titleText(shown, bodyColumns - displayWidth(head))}`, bodyColumns)
}

function inlinePatch(view: StepView, shown: Shown, room: number): RenderElement[] {
  const { change } = shown.edit
  if (change.kind !== 'patch' || room <= 0) return []
  const { Code, Text, bodyColumns } = view.elements
  const whole = change.hunks.reduce((sum, hunk) => sum + hunk.lines, 0) + change.dropped
  const lines = whole <= room ? room : room - 1
  const taken = takenHunks(change.hunks, {
    lines,
    characters: chromeBudget(0, bodyColumns).characters,
  })
  const drawn = taken.source === '' ? 0 : taken.source.split('\n').length
  const hidden = whole - drawn
  const code =
    taken.source === ''
      ? []
      : [Code({ source: taken.source, path: shown.path, format: 'diff' as const })]
  const more =
    hidden > 0
      ? [
          Text({
            dimColor: true,
            children: fitted(`+${countText(hidden)} more: ${DOCK_HINT}`, bodyColumns),
          }),
        ]
      : []
  return [...code, ...more]
}

export function drawInlineSteps(view: StepView, rootName: string): RenderElement {
  const { elements, git } = view
  const { Box, Text, Button, bodyColumns } = elements
  const shown = shownOf(view)
  if (shown === undefined) {
    return Box({
      flexDirection: 'column',
      children: [drawHeader(elements, rootName, git.header, bodyColumns)],
    })
  }
  const specs = stepButtons(view, shown)
  const headerWidth = bodyColumns - rowWidth(specs) - BUTTON_GAP
  const notes = notesOf(view, shown.edit.change)
    .slice(0, INLINE_ROWS - INLINE_TOP_ROWS)
    .map((text) => Text({ dimColor: true, children: fitted(text, bodyColumns) }))
  const room = INLINE_ROWS - INLINE_TOP_ROWS - notes.length
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [
          drawHeader(elements, rootName, git.header, headerWidth),
          Box({
            flexDirection: 'row',
            children: specs.flatMap((spec, at) => [
              ...(at === 0 ? [] : [Text({ children: ' ' })]),
              buttonOf(Button, spec, bodyColumns),
            ]),
          }),
        ],
      }),
      Text({ children: inlineLine(view, shown) }),
      ...notes,
      ...inlinePatch(view, shown, room),
    ],
  })
}
