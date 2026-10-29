import { type Hunk, takenHunks } from './diff'
import { SHOWN_CHARACTERS, drawable, linesOf } from './source'

export const EDITS_KEPT = 50
export const PATCH_LINES = 400

export type EditTool = 'Edit' | 'Write' | 'NotebookEdit'

export type EditPatch = {
  kind: 'patch'
  hunks: readonly Hunk[]
  added: number
  removed: number
  dropped: number
  isNew: boolean
  isUserModified: boolean
}

export type EditChange =
  | EditPatch
  | { kind: 'held' }
  | { kind: 'no-patch'; isUserModified: boolean }
  | { kind: 'notebook' }

export type TurnEdit = {
  path: string
  agent: string
  tool: EditTool
  at: number
  change: EditChange
}

export type LastTurn = { edits: readonly TurnEdit[]; total: number }

export type Edits = {
  open: TurnEdit[]
  openTotal: number
  last: LastTurn | undefined
  at: number | undefined
  isNoteShown: boolean
}

type PatchPart = { oldStart: number; oldLines: number; newStart: number; newLines: number }

type RawHunk = PatchPart & { lines: readonly string[] }

const EDIT_TOOLS: ReadonlySet<string> = new Set<EditTool>(['Edit', 'Write', 'NotebookEdit'])

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function rawHunkOf(value: unknown): RawHunk | undefined {
  if (!isRecord(value)) return undefined
  const { oldStart, oldLines, newStart, newLines, lines } = value
  if (!isCount(oldStart) || !isCount(oldLines) || !isCount(newStart) || !isCount(newLines)) {
    return undefined
  }
  if (!Array.isArray(lines)) return undefined
  const texts: readonly unknown[] = lines
  if (!texts.every((line): line is string => typeof line === 'string')) return undefined
  return { oldStart, oldLines, newStart, newLines, lines: texts }
}

function rawHunksOf(value: unknown): RawHunk[] | undefined {
  if (!Array.isArray(value)) return undefined
  const parts: readonly unknown[] = value
  const hunks = parts.map(rawHunkOf)
  return hunks.every((hunk) => hunk !== undefined) ? hunks : undefined
}

function counted(lines: readonly string[], mark: string): number {
  return lines.filter((line) => line.startsWith(mark)).length
}

function hunkOf(raw: RawHunk): Hunk {
  const header = `@@ -${String(raw.oldStart)},${String(raw.oldLines)} +${String(raw.newStart)},${String(raw.newLines)} @@`
  return { text: drawable([header, ...raw.lines].join('\n')), lines: raw.lines.length + 1 }
}

function bodyLines(hunks: readonly Hunk[]): number {
  return hunks.reduce((sum, hunk) => sum + hunk.lines - 1, 0)
}

function keptHunks(hunks: readonly Hunk[]): Hunk[] {
  const budget = { lines: PATCH_LINES + hunks.length, characters: SHOWN_CHARACTERS }
  const kept: Hunk[] = []
  for (const hunk of hunks) {
    const taken = takenHunks([hunk], budget)
    if (taken.shownHunks === 0) break
    if (taken.cut === undefined) {
      kept.push(hunk)
      continue
    }
    kept.push({ text: taken.source, lines: taken.cut.shownLines + 1 })
    break
  }
  return kept
}

type Patched = { raws: readonly RawHunk[]; total: number; added: number }

function createdPatch(content: string): Patched {
  const lines = linesOf(content)
  const kept = lines.slice(0, PATCH_LINES).map((line) => `+${line}`)
  const raw: RawHunk = { oldStart: 0, oldLines: 0, newStart: 1, newLines: kept.length, lines: kept }
  return { raws: [raw], total: lines.length, added: lines.length }
}

function resultPatch(raws: readonly RawHunk[]): Patched {
  const all = raws.flatMap((raw) => raw.lines)
  return { raws, total: all.length, added: counted(all, '+') }
}

function patchOf(patched: Patched, flags: { isNew: boolean; isUserModified: boolean }): EditPatch {
  const all = patched.raws.flatMap((raw) => raw.lines)
  const kept = keptHunks(patched.raws.map(hunkOf))
  return {
    kind: 'patch',
    hunks: kept,
    added: patched.added,
    removed: counted(all, '-'),
    dropped: Math.max(patched.total - bodyLines(kept), 0),
    ...flags,
  }
}

function isCreate(tool: EditTool, result: Readonly<Record<string, unknown>>): boolean {
  return tool === 'Write' && result.type === 'create'
}

export function editChangeOf(tool: EditTool, result: unknown): EditChange {
  if (tool === 'NotebookEdit') return { kind: 'notebook' }
  if (!isRecord(result)) return { kind: 'no-patch', isUserModified: false }
  if (result.staged === true) return { kind: 'held' }
  const isUserModified = result.userModified === true
  const isNew = isCreate(tool, result)
  const raws = rawHunksOf(result.structuredPatch) ?? []
  if (raws.length === 0 && isNew && typeof result.content === 'string') {
    return patchOf(createdPatch(result.content), { isNew, isUserModified })
  }
  if (raws.length === 0) return { kind: 'no-patch', isUserModified }
  return patchOf(resultPatch(raws), { isNew, isUserModified })
}

export function isEditTool(tool: string): tool is EditTool {
  return EDIT_TOOLS.has(tool)
}

export function newEdits(): Edits {
  return { open: [], openTotal: 0, last: undefined, at: undefined, isNoteShown: false }
}

export function clearEdits(edits: Edits): void {
  edits.open = []
  edits.openTotal = 0
  edits.last = undefined
  closeSteps(edits)
}

export function closeSteps(edits: Edits): void {
  edits.at = undefined
  edits.isNoteShown = false
}

export function noteEdit(edits: Edits, edit: TurnEdit): void {
  edits.openTotal += 1
  if (edits.open.length < EDITS_KEPT) edits.open.push(edit)
}

export function endMainTurn(edits: Edits): void {
  edits.last = { edits: edits.open, total: edits.openTotal }
  edits.open = []
  edits.openTotal = 0
  edits.isNoteShown = false
  if (edits.at !== undefined) edits.at = shownStep(edits.last, edits.at)
}

export function shownStep(last: LastTurn | undefined, at: number): number | undefined {
  const count = last?.edits.length ?? 0
  if (count === 0) return undefined
  return Math.min(Math.max(at, 1), count)
}

export function isLaterEdited(last: LastTurn, at: number): boolean {
  const edit = last.edits[at - 1]
  if (edit === undefined) return false
  return last.edits.slice(at).some((later) => later.path === edit.path)
}
