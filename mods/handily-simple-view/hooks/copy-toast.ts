import { TOAST_MARKS, type ToastParts } from './toast'

type CopyRefusal = 'no-surface' | 'no-clipboard' | 'refused'

const NOT_COPIED = `${TOAST_MARKS.blocked} Not copied`

const COPY_REFUSALS: Readonly<Record<CopyRefusal, readonly [string] | readonly [string, string]>> =
  {
    'no-surface': ['no screen is attached to this session'],
    'no-clipboard': ['the clipboard took nothing', 'a long text may not fit this terminal'],
    refused: ['another plugin refused the copy'],
  }

export const COPY_FAILED: ToastParts = [NOT_COPIED, 'the transcript shows why']

export function copiedParts(what: string, lines: string): ToastParts {
  return [`${TOAST_MARKS.done} Copied ${what}`, lines]
}

export function copyRefusalParts(reason: CopyRefusal): ToastParts {
  return [NOT_COPIED, ...COPY_REFUSALS[reason]]
}
