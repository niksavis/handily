import { TOAST_MARKS, type ToastParts } from './toast'

export type PersonReply = { text: string; toastParts: ToastParts | undefined }

const TRANSCRIPT_SHOWS_WHY = 'the transcript shows why'

export const CLAUDE_NOT_TOLD = 'Claude was not told'

export const CHANGE_FAILED: ToastParts = [
  `${TOAST_MARKS.blocked} The change failed`,
  TRANSCRIPT_SHOWS_WHY,
]

export const AGENTS_VIEW_FAILED: ToastParts = [
  `${TOAST_MARKS.blocked} The agents view did not open`,
  TRANSCRIPT_SHOWS_WHY,
]

export function refusedParts(head: string, why: string, hint?: string): ToastParts {
  const lead = `${TOAST_MARKS.blocked} ${head}`
  return hint === undefined ? [lead, why] : [lead, why, hint]
}

export function unchangedParts(why: string): ToastParts {
  return [`${TOAST_MARKS.toDo} Nothing changed`, why]
}

export function notToldParts(change: string): ToastParts {
  return [`${TOAST_MARKS.blocked} ${CLAUDE_NOT_TOLD}`, change, TRANSCRIPT_SHOWS_WHY]
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
