import type { UiCopyResult } from 'claude-code'
import { marked, type ToastParts } from './toast'

export type PersonReply = { text: string; toastParts: ToastParts | undefined }

const TRANSCRIPT_SHOWS_WHY = 'the transcript shows why'

export const CLAUDE_NOT_TOLD = 'Claude was not told'

export const CHANGE_FAILED: ToastParts = [
  marked('blocked', 'The change failed'),
  TRANSCRIPT_SHOWS_WHY,
]

export const AGENTS_VIEW_FAILED: ToastParts = [
  marked('blocked', 'The agents view did not open'),
  TRANSCRIPT_SHOWS_WHY,
]

export const FILES_VIEW_FAILED: ToastParts = [
  marked('blocked', 'The files tab did not open'),
  TRANSCRIPT_SHOWS_WHY,
]

type CopyRefusal = Extract<UiCopyResult, { isCopied: false }>['reason']

const COPY_REFUSALS: Readonly<Record<CopyRefusal, string>> = {
  'no-surface': 'no screen is attached to this session',
  'no-clipboard': 'the clipboard took nothing',
  unanswered: 'no app answered the copy',
  refused: 'another plugin refused the copy',
}

const NOT_COPIED = 'Not copied'

export const COPIED_COMMAND: ToastParts = [
  marked('done', 'Copied'),
  'type ! in the prompt, then paste',
]

export const COPY_FAILED: ToastParts = [marked('blocked', NOT_COPIED), TRANSCRIPT_SHOWS_WHY]

export function copyParts(result: UiCopyResult): ToastParts {
  return result.isCopied ? COPIED_COMMAND : refusedParts(NOT_COPIED, COPY_REFUSALS[result.reason])
}

export function refusedParts(head: string, why: string, hint?: string): ToastParts {
  const lead = marked('blocked', head)
  return hint === undefined ? [lead, why] : [lead, why, hint]
}

export function unchangedParts(why: string): ToastParts {
  return [marked('toDo', 'Nothing changed'), why]
}

export function notToldParts(change: string): ToastParts {
  return [marked('blocked', CLAUDE_NOT_TOLD), change, TRANSCRIPT_SHOWS_WHY]
}

export function refusedReply(text: string, head: string, why: string, hint?: string): PersonReply {
  return { text, toastParts: refusedParts(head, why, hint) }
}

export function unchangedReply(text: string, why: string): PersonReply {
  return { text, toastParts: unchangedParts(why) }
}

export function changedReply(
  text: string,
  change: string,
  noteRefusal: string | undefined,
  shown: ToastParts | undefined,
): PersonReply {
  return { text, toastParts: noteRefusal === undefined ? shown : notToldParts(change) }
}
