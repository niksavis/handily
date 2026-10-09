import type { EngineInterface } from 'claude-code'

export type TrackerRules = Pick<EngineInterface['workitems'], 'classify' | 'trackerFile'>

export type ToolUse =
  { tool: 'Bash'; command: string } | { tool: 'Write' | 'Edit'; filePath: string; root: string }

export async function isTrackerWrite(rules: TrackerRules, use: ToolUse): Promise<boolean> {
  if (use.tool === 'Bash') return (await rules.classify(use.command)).kind !== 'none'
  return (await rules.trackerFile({ path: use.filePath, root: use.root })) !== null
}
