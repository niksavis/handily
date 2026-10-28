import type { RenderElement } from 'claude-code'
import { type ButtonSpec, buttonRows } from './buttons'
import { diffArgv, takenHunks } from './diff'
import type { GitView } from './gitview'
import {
  type ChangedFile,
  type DiffResult,
  FOLDER_FILES,
  type FileChange,
  type Look,
  type PreviewResult,
} from './look'
import { touchText } from './marks'
import { shellQuoted } from './quoting'
import {
  LETTER_COLORS,
  type PaneActions,
  type PaneElements,
  type Part,
  type TouchDraw,
  drawHeader,
  drawParts,
  fittedParts,
  shownName,
  wrapped,
} from './pane'
import {
  type Budget,
  SHOWN_CHARACTERS,
  addedHunk,
  countText,
  newBudget,
  shownSource,
  sizeText,
} from './source'
import type { GitLetter } from './status'

type LookView = {
  elements: PaneElements
  git: GitView
  actions: PaneActions
  touched: TouchDraw
}

type LookDraw = LookView & { budget: Budget }

type Taken = { source: string; notes: Note[] }

type Tone = 'dim' | 'error' | 'warning' | 'plain'

type Note = { text: string; tone: Tone }

type Shown = { title: Part[]; notes: Note[]; body: RenderElement[] }

const RULE = '─'
const READING = 'Reading…'
const NO_CHANGE = 'no change against HEAD'
const ALL_NEW = 'every file is new; diff shows it whole'
const UNCOUNTED_CHARACTERS = 1000
const CHROME_LINES = 12
const FILE_LINES = 4

function note(text: string, tone: Tone = 'dim'): Note {
  return { text, tone }
}

function letterParts(letter: GitLetter | undefined): Part[] {
  return letter === undefined
    ? []
    : [{ text: '  ' }, { text: letter, color: LETTER_COLORS[letter] }]
}

function titleParts(path: string, letter: GitLetter | undefined, detail: string): Part[] {
  const gap = letter === undefined && detail !== '' ? [{ text: ' ' }] : []
  return [{ text: shownName(path) }, ...letterParts(letter), ...gap, { text: detail }]
}

function linesWord(count: number): string {
  return `${countText(count)} ${count === 1 ? 'line' : 'lines'}`
}

const PANE_FULL = 'not shown; the pane is full'
const FIRST_LINE_CUT = 'the first line is too long; it is cut'

function cutNote(shown: number, whole: number): Note[] {
  if (shown === 0 && whole > 0) return [note(PANE_FULL)]
  return shown < whole ? [note(`first ${countText(shown)} lines shown of ${countText(whole)}`)] : []
}

function hunksNote(shown: number, whole: number): Note[] {
  if (shown === 0 && whole > 0) return [note(PANE_FULL)]
  return shown < whole ? [note(`first ${countText(shown)} of ${countText(whole)} hunks shown`)] : []
}

function markNotes(draw: LookDraw, path: string): Note[] {
  const { touched } = draw
  const mark = touched.fileMark(path)
  if (mark === undefined) return []
  return [note(touchText(mark, (agent) => shownName(touched.labelOf(agent)), touched.now))]
}

function shownPreview(draw: LookDraw, path: string, result: PreviewResult | undefined): Shown {
  const { Code, Markdown } = draw.elements
  const letter = draw.git.marks?.letterOf(path)
  switch (result?.kind) {
    case undefined:
      return { title: titleParts(path, letter, ''), notes: [note(READING)], body: [] }
    case 'text': {
      const { total } = result.source
      const title = titleParts(path, letter, ` · ${linesWord(total)}`)
      if (total === 0) {
        return { title, notes: [...markNotes(draw, path), note('empty file')], body: [] }
      }
      const shown = shownSource(result.source, draw.budget)
      const cut = shown.shownLines === 0 ? [note(FIRST_LINE_CUT)] : cutNote(shown.shownLines, total)
      const notes = [...markNotes(draw, path), ...cut]
      const body = result.isMarkdown
        ? Markdown({ key: 'preview', text: shown.source })
        : Code({ source: shown.source, path, startLine: 1 })
      return { title, notes, body: [body] }
    }
    case 'binary':
      return {
        title: titleParts(path, letter, ` · ${sizeText(result.size)}`),
        notes: [note('binary file, no preview')],
        body: [],
      }
    case 'too-large':
      return {
        title: titleParts(path, letter, ` · ${sizeText(result.size)}`),
        notes: [note('over 4 MiB, no preview')],
        body: [],
      }
    case 'unreadable':
      return {
        title: titleParts(path, letter, ''),
        notes: [note(`Cannot read it: ${result.reason}.`, 'error')],
        body: [],
      }
    case 'deleted':
      return {
        title: titleParts(path, letter, ''),
        notes: [note('deleted; [ diff ] shows what it held')],
        body: [],
      }
  }
}

function changeDetail(change: FileChange): string {
  switch (change.kind) {
    case 'hunks':
      return ` +${countText(change.added)} -${countText(change.removed)}`
    case 'new':
      return ` new, ${linesWord(change.source.total)}`
    case 'new-folder':
      return ' new folder'
    case 'too-large':
      return ` ${sizeText(change.size)}`
    default:
      return ''
  }
}

function takenChange(change: FileChange, budget: Budget): Taken {
  switch (change.kind) {
    case 'hunks': {
      const taken = takenHunks(change.hunks, budget)
      const cut =
        taken.cut === undefined
          ? []
          : [
              note(
                `hunk cut: ${countText(taken.cut.shownLines)} of ${countText(taken.cut.lines)} lines shown`,
              ),
            ]
      return {
        source: taken.source,
        notes: [...cut, ...hunksNote(taken.shownHunks, change.hunks.length)],
      }
    }
    case 'new': {
      if (change.source.total === 0) return { source: '', notes: [note('new empty file')] }
      const taken = addedHunk(change.source, budget)
      return { source: taken.source, notes: cutNote(taken.shownLines, change.source.total) }
    }
    default:
      return { source: '', notes: changeNotes(change) }
  }
}

function changeNotes(change: FileChange): Note[] {
  switch (change.kind) {
    case 'hunks':
    case 'new':
      return []
    case 'new-folder':
      return [note('its files are not listed by git status')]
    case 'binary':
      return [note('binary file changed')]
    case 'cut':
      return [note('not shown; git diff was cut at 4 MiB')]
    case 'none':
      return [note(NO_CHANGE)]
    case 'too-large':
      return [note('over 4 MiB, no diff')]
    case 'unreadable':
      return [note(`Cannot read it: ${change.reason}.`, 'error')]
  }
}

function changeCode(draw: LookDraw, file: ChangedFile, taken: Taken): RenderElement[] {
  if (taken.source === '') return []
  return [draw.elements.Code({ source: taken.source, path: file.path, format: 'diff' })]
}

function failedShown(path: string, reason: string): Shown {
  return {
    title: [{ text: shownName(path) }],
    notes: [
      note(`git diff failed: ${reason}.`, 'error'),
      note('Run git diff in a shell to see why.', 'plain'),
    ],
    body: [],
  }
}

function shownFileDiff(draw: LookDraw, path: string, result: DiffResult | undefined): Shown {
  const letter = draw.git.marks?.letterOf(path)
  if (result === undefined) {
    return { title: titleParts(path, letter, ''), notes: [note(READING)], body: [] }
  }
  if (result.kind === 'failed') return failedShown(path, result.reason)
  const file = result.files[0]
  if (file === undefined) {
    return { title: titleParts(path, letter, ''), notes: [note(NO_CHANGE)], body: [] }
  }
  const detail = changeDetail(file.change)
  const suffix = file.change.kind === 'hunks' ? `${detail} vs HEAD` : detail
  const taken = takenChange(file.change, draw.budget)
  return {
    title: titleParts(path, letter, suffix === '' ? '' : ` ·${suffix}`),
    notes: [
      ...(result.isInitial ? [note(ALL_NEW)] : []),
      ...cutDiffNote(result.isCut),
      ...taken.notes,
    ],
    body: changeCode(draw, file, taken),
  }
}

function cutDiffNote(isCut: boolean): Note[] {
  return isCut ? [note('git diff is over 4 MiB; the rest is not shown.', 'warning')] : []
}

function folderTitle(path: string, result: DiffResult | undefined): Part[] {
  const name = `${shownName(path)}/`
  if (result?.kind !== 'files') return [{ text: name }]
  if (result.isInitial) return [{ text: `${name}  · no commits yet` }]
  const files = result.total === 1 ? 'file' : 'files'
  return [{ text: `${name}  ${countText(result.total)} changed ${files} vs HEAD` }]
}

function noteLines(draw: LookDraw, notes: readonly Note[]): RenderElement[] {
  const { Text, bodyColumns } = draw.elements
  return notes.flatMap(({ text, tone }) =>
    wrapped(text, bodyColumns).map((part) =>
      Text({
        color: tone === 'error' || tone === 'warning' ? tone : undefined,
        dimColor: tone === 'dim' ? true : undefined,
        children: part,
      }),
    ),
  )
}

function titleLine(draw: LookDraw, parts: readonly Part[], key: string): RenderElement {
  const { Box, Text, bodyColumns } = draw.elements
  return Box({
    key,
    flexDirection: 'row',
    children: drawParts(Text, fittedParts(parts, bodyColumns)),
  })
}

function folderFile(draw: LookDraw, file: ChangedFile): RenderElement[] {
  const title: Part[] = [
    { text: shownName(file.path), bold: true },
    ...letterParts(file.letter),
    { text: changeDetail(file.change) },
  ]
  const taken = takenChange(file.change, draw.budget)
  return [
    titleLine(draw, title, `file:${file.path}`),
    ...noteLines(draw, taken.notes),
    ...changeCode(draw, file, taken),
  ]
}

function shownFolderDiff(draw: LookDraw, path: string, result: DiffResult | undefined): Shown {
  const title = folderTitle(path, result)
  if (result === undefined) return { title, notes: [note(READING)], body: [] }
  if (result.kind === 'failed') return failedShown(`${path}/`, result.reason)
  if (result.files.length === 0) return { title, notes: [note(NO_CHANGE)], body: [] }
  const shownCount = Math.min(result.total, FOLDER_FILES)
  const cut =
    result.total > shownCount
      ? [note(`first ${countText(shownCount)} of ${countText(result.total)} changed files shown`)]
      : []
  return {
    title,
    notes: [...(result.isInitial ? [note(ALL_NEW)] : []), ...cut, ...cutDiffNote(result.isCut)],
    body: result.files.flatMap((file) => folderFile(draw, file)),
  }
}

function diffCommand(path: string): string {
  return diffArgv([path]).map(shellQuoted).join(' ')
}

function lookButtons(draw: LookDraw, look: Look): ButtonSpec[] {
  const { actions } = draw
  const back: ButtonSpec = {
    key: 'back',
    label: 'back',
    onPress: () => {
      actions.back()
    },
  }
  const copy: ButtonSpec = {
    key: 'copy-path',
    label: 'copy path',
    onPress: (e) => {
      actions.copy(look.path, e.surface)
    },
  }
  if (look.kind === 'preview') {
    const diff: ButtonSpec[] = draw.git.isRepo
      ? [
          {
            key: 'diff',
            label: 'diff',
            onPress: () => {
              actions.diff(look.path, false)
            },
          },
        ]
      : []
    return [back, ...diff, copy]
  }
  if (look.isFolder) return [back, copy]
  return [
    back,
    {
      key: 'preview',
      label: 'preview',
      onPress: () => {
        actions.preview(look.path)
      },
    },
    copy,
  ]
}

function commandButton(draw: LookDraw, look: Look): RenderElement[] {
  if (look.kind !== 'diff' || look.result?.kind !== 'files') return []
  if (look.result.total <= FOLDER_FILES) return []
  const { actions, elements } = draw
  const command = diffCommand(look.path)
  const spec: ButtonSpec = {
    key: 'copy-command',
    label: 'copy the git diff command',
    onPress: (e) => {
      actions.copy(command, e.surface)
    },
  }
  return buttonRows(elements, [spec], { room: elements.bodyColumns, indent: 0, key: 'command' })
}

function shownOf(draw: LookDraw, look: Look): Shown {
  if (look.kind === 'preview') return shownPreview(draw, look.path, look.result)
  if (look.isFolder) return shownFolderDiff(draw, look.path, look.result)
  return shownFileDiff(draw, look.path, look.result)
}

function reservedLines(look: Look): number {
  const files = look.kind === 'diff' && look.result?.kind === 'files' ? look.result.files.length : 1
  return CHROME_LINES + FILE_LINES * files
}

function budgetOf(look: Look, bodyColumns: number): Budget {
  const reserved = reservedLines(look) * Math.max(bodyColumns, 1) + UNCOUNTED_CHARACTERS
  return newBudget(SHOWN_CHARACTERS - reserved)
}

export function drawLook(view: LookView, rootName: string, look: Look): RenderElement {
  const { Box, Text, bodyColumns } = view.elements
  const draw: LookDraw = { ...view, budget: budgetOf(look, bodyColumns) }
  const shown = shownOf(draw, look)
  return Box({
    flexDirection: 'column',
    children: [
      drawHeader(draw.elements, rootName, draw.git.header, bodyColumns),
      ...buttonRows(draw.elements, lookButtons(draw, look), {
        room: bodyColumns,
        indent: 0,
        key: 'look',
      }),
      titleLine(draw, shown.title, 'title'),
      ...noteLines(draw, shown.notes),
      ...commandButton(draw, look),
      Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) }),
      ...shown.body,
    ],
  })
}
