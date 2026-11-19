import { maskedCredentials } from './credentials'
import { PLAN_TOOL } from './plan'

export const QUESTION_TOOL = 'AskUserQuestion'

type TextAskKind = 'question' | 'waits'

export type AskedCall = { tool: string; target: string | null; question: string | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function askedQuestion(tool: string, input: unknown): string | null {
  if (tool !== QUESTION_TOOL || !isRecord(input) || !Array.isArray(input.questions)) return null
  const first: unknown = input.questions[0]
  if (!isRecord(first) || typeof first.question !== 'string') return null
  const line = first.question.split(/\r?\n/, 1)[0]?.trim() ?? ''
  return line === '' ? null : maskedCredentials(line)
}

export type AskSight = { kind: 'permission' } | { kind: TextAskKind; title: string }

export function askSight(call: AskedCall): AskSight {
  if (call.tool === QUESTION_TOOL) return { kind: 'question', title: call.question ?? call.tool }
  if (call.tool === PLAN_TOOL) return { kind: 'waits', title: call.tool }
  return { kind: 'permission' }
}
