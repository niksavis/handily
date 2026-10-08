import { parseCommand, trackerFileOf, type WriteVerbs } from './parse'

export type ToolUse =
  | { tool: 'Bash'; command: string; verbs: WriteVerbs }
  | { tool: 'Write' | 'Edit'; filePath: string; root: string | null }

export function isTrackerWrite(use: ToolUse): boolean {
  if (use.tool === 'Bash') return parseCommand(use.command, use.verbs).kind !== 'none'
  if (use.root === null) return true
  return trackerFileOf(use.filePath, use.root) !== null
}
