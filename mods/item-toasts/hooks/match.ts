export type ToolUse =
  | { tool: 'Bash'; command: string }
  | { tool: 'Write' | 'Edit'; filePath: string; root: string | null }

const TOOLS_THAT_MAY_WRITE_THE_TRACKER: ReadonlySet<ToolUse['tool']> = new Set([
  'Bash',
  'Write',
  'Edit',
])

export function isTrackerWrite(use: ToolUse): boolean {
  return TOOLS_THAT_MAY_WRITE_THE_TRACKER.has(use.tool)
}
