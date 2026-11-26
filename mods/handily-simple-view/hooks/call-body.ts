import type { RenderSurface } from 'claude-code'
import { keptParts } from './detail'
import { diffPieces, fileLines, oneLineLog, pieceLines, type DiffPiece } from './diff-lines'
import { DRAWN_CHARACTERS_AT_MOST } from './fold'
import { grepLines } from './grep-lines'
import { jsonLines } from './json-lines'
import { kindOf, type Kind, type OutputKind } from './kinds'
import { shownLine } from './shown'
import { lineText, plainLine, type StyledLine } from './wrap'

export type BodyBlock =
  | { kind: 'rows'; lines: StyledLine[] }
  | { kind: 'code'; source: string; path: string }
  | { kind: 'markdown'; text: string }

export type CallBody = { kind: OutputKind; blocks: BodyBlock[]; left: number }

export const KIND_WORDS: Readonly<Record<OutputKind, string>> = {
  grep: 'grep',
  log: 'git log',
  diff: 'diff',
  json: 'json',
  markdown: 'markdown',
  plain: '',
}

const FULL_COMMIT = /^[*|\\/ ]*commit [0-9a-f]{40}/
const JSON_CHARACTERS_AT_MOST = 1_000_000

type SourceCut = { lines: string[]; left: number }

function sourceCut(lines: readonly string[]): SourceCut {
  let characters = 0
  for (const [index, line] of lines.entries()) {
    characters += line.length + 1
    if (characters > DRAWN_CHARACTERS_AT_MOST) {
      return { lines: lines.slice(0, index), left: lines.length - index }
    }
  }
  return { lines: [...lines], left: 0 }
}

function jsonSource(lines: readonly string[]): string {
  const size = lines.reduce((sum, line) => sum + line.length + 1, 0)
  return size > JSON_CHARACTERS_AT_MOST ? '' : lines.join('\n')
}

type Budget = { left: number }

function spend(budget: Budget, characters: number): boolean {
  if (characters > budget.left) {
    budget.left = -1
    return false
  }
  budget.left -= characters
  return true
}

function keptRows(lines: readonly StyledLine[], budget: Budget): StyledLine[] {
  const kept: StyledLine[] = []
  for (const line of lines) {
    if (budget.left < 0 || !spend(budget, lineText(line).length + 1)) break
    kept.push(line)
  }
  return kept
}

function styledLines(kind: Kind, lines: readonly string[]): StyledLine[] {
  switch (kind.kind) {
    case 'grep':
      return grepLines(kind.rows, kind.query)
    case 'log':
      return isFullLog(lines) ? pieceLines(diffPieces(lines)) : oneLineLog(lines)
    case 'diff':
      return pieceLines(diffPieces(lines))
    case 'json':
      return jsonLines(kind.text) ?? lines.map((line) => plainLine(line))
    default:
      return lines.map((line) => plainLine(line))
  }
}

type Drawn = { blocks: BodyBlock[]; left: number }

function sourceCount(piece: DiffPiece): number {
  return piece.kind === 'lines' ? piece.lines.length : piece.head.length + piece.hunks.length
}

function pieceBlocks(pieces: readonly DiffPiece[], budget: Budget): Drawn {
  const blocks: BodyBlock[] = []
  let left = 0
  const rows = (lines: readonly StyledLine[]) => {
    const kept = keptRows(lines, budget)
    if (kept.length > 0) blocks.push({ kind: 'rows', lines: kept })
    left += lines.length - kept.length
  }
  for (const piece of pieces) {
    if (piece.kind === 'lines') {
      rows(piece.lines)
      continue
    }
    const source = piece.hunks.join('\n')
    if (piece.isWhole && budget.left >= 0 && spend(budget, piece.path.length + source.length + 2)) {
      blocks.push({ kind: 'rows', lines: [[{ text: piece.path, isBold: true }]] })
      blocks.push({ kind: 'code', source, path: piece.path })
      continue
    }
    if (budget.left < 0) {
      left += sourceCount(piece)
      continue
    }
    rows(fileLines(piece))
  }
  return { blocks, left }
}

function isFullLog(lines: readonly string[]): boolean {
  return FULL_COMMIT.test(lines.find((line) => line.trim() !== '') ?? '')
}

function isCodeDiff(kind: Kind, lines: readonly string[], surface: RenderSurface): boolean {
  if (surface === 'terminal') return false
  return kind.kind === 'diff' || (kind.kind === 'log' && isFullLog(lines))
}

function bodyOf(kind: Kind, lines: readonly string[], surface: RenderSurface): Drawn {
  const budget: Budget = { left: DRAWN_CHARACTERS_AT_MOST }
  if (kind.kind === 'markdown') {
    const kept = keptRows(
      lines.map((line) => plainLine(line)),
      budget,
    )
    return {
      blocks: [{ kind: 'markdown', text: kept.map(lineText).join('\n') }],
      left: lines.length - kept.length,
    }
  }
  if (isCodeDiff(kind, lines, surface)) return pieceBlocks(diffPieces(lines), budget)
  const styled = styledLines(kind, lines)
  const kept = keptRows(styled, budget)
  return { blocks: [{ kind: 'rows', lines: kept }], left: styled.length - kept.length }
}

export function callBody(
  command: string | null,
  lines: readonly string[],
  surface: RenderSurface,
): CallBody {
  const { before, body, after } = keptParts(lines)
  const cut = sourceCut(body)
  const shown = cut.lines.map(shownLine)
  const kind = kindOf(command, shown, jsonSource(body))
  const drawn = bodyOf(kind, shown, surface)
  const dim = (part: readonly string[]): BodyBlock[] =>
    part.length === 0
      ? []
      : [{ kind: 'rows', lines: part.map((line) => plainLine(shownLine(line), true)) }]
  return {
    kind: kind.kind,
    blocks: [...dim(before), ...drawn.blocks, ...dim(after)],
    left: (kind.kind === 'json' ? 0 : cut.left) + drawn.left,
  }
}
