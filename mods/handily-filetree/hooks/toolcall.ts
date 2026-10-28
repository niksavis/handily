import type { ToolCallInput, ToolCallResult } from 'claude-code'
import type { TouchKind } from './touches'

export type ToolTouch = { kind: 'file'; touch: TouchKind; path: string } | { kind: 'search' }

const FILE_TOOLS: ReadonlyMap<string, { touch: TouchKind; argument: string }> = new Map([
  ['Read', { touch: 'read', argument: 'file_path' }],
  ['Edit', { touch: 'edit', argument: 'file_path' }],
  ['Write', { touch: 'edit', argument: 'file_path' }],
  ['NotebookEdit', { touch: 'edit', argument: 'notebook_path' }],
])

const SEARCH_TOOL = 'Grep'

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

export function toolTouchOf(e: ToolCallInput): ToolTouch | undefined {
  const tool: string = e.tool
  if (tool === SEARCH_TOOL) return { kind: 'search' }
  const file = FILE_TOOLS.get(tool)
  if (file === undefined) return undefined
  const args: Readonly<Record<string, unknown>> = e
  const path = args[file.argument]
  if (typeof path !== 'string' || path === '') return undefined
  return { kind: 'file', touch: file.touch, path }
}

export function isAnswered(answer: ToolCallResult): boolean {
  return answer.deny === undefined && answer.isError !== true
}

export function searchedFiles(result: unknown): readonly string[] {
  if (!isRecord(result) || !Array.isArray(result.filenames)) return []
  const names: readonly unknown[] = result.filenames
  return names.filter((name): name is string => typeof name === 'string' && name !== '')
}
