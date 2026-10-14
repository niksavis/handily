import { shownLine } from './fold'
import { FILE_TOOLS, isRecord } from './output'
import { READING_TOOLS } from './reading'

const RICH_TOOLS: ReadonlySet<string> = new Set(['Bash', ...FILE_TOOLS, ...READING_TOOLS])

const ENGINE_ROW_TOOLS: ReadonlySet<string> = new Set([
  'AskUserQuestion',
  'EnterPlanMode',
  'ExitPlanMode',
  'ProposeGoal',
  'TodoWrite',
  'SendUserMessage',
  'SendUserFile',
  'PushNotification',
  'ReportFindings',
  'propose_skills',
  'PublishPlugin',
  'SuggestPluginInstall',
  'SuggestSkills',
  'SuggestConnectors',
  'OfferChromeSetup',
  'ShowOnboardingRolePicker',
  'request_computer',
])

const ENGINE_HIDDEN_TOOLS: ReadonlySet<string> = new Set(['ToolSearch'])

const SUMMARY_FIELDS = [
  'title',
  'subject',
  'description',
  'summary',
  'url',
  'query',
  'pattern',
  'skill',
  'command',
  'file_path',
  'filePath',
  'notebook_path',
  'path',
  'uri',
  'prompt',
  'message',
  'name',
] as const

const MCP_PREFIX = 'mcp__'
const MCP_SEPARATOR = '__'
const SUMMARY_SOURCE_LIMIT = 2000

export function isRichTool(tool: string): boolean {
  return RICH_TOOLS.has(tool)
}

export function isHiddenByEngine(tool: string): boolean {
  return ENGINE_HIDDEN_TOOLS.has(tool)
}

export function drawsGenericRow(tool: string): boolean {
  return !RICH_TOOLS.has(tool) && !ENGINE_ROW_TOOLS.has(tool) && !ENGINE_HIDDEN_TOOLS.has(tool)
}

export function toolLabel(tool: string): string {
  if (!tool.startsWith(MCP_PREFIX)) return shownLine(tool)
  const named = tool.slice(MCP_PREFIX.length)
  const split = named.indexOf(MCP_SEPARATOR)
  if (split <= 0 || split + MCP_SEPARATOR.length >= named.length) return shownLine(tool)
  const server = named.slice(0, split)
  const name = named.slice(split + MCP_SEPARATOR.length)
  return `${shownLine(server)} · ${shownLine(name)}`
}

function oneLine(value: unknown): string {
  if (typeof value !== 'string') return ''
  const head = Array.from(value).slice(0, SUMMARY_SOURCE_LIMIT).join('')
  return shownLine(head.replace(/\s+/g, ' ').trim())
}

export function inputSummary(input: unknown): string {
  if (!isRecord(input)) return ''
  for (const field of SUMMARY_FIELDS) {
    const named = oneLine(input[field])
    if (named !== '') return named
  }
  for (const value of Object.values(input)) {
    const first = oneLine(value)
    if (first !== '') return first
  }
  return ''
}
