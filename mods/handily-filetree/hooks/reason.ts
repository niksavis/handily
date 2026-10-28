const PERMISSION_DENIED = /\b(EACCES|EPERM)\b/
const GONE = /\bENOENT\b/

export function reasonOf(error: unknown): string {
  const text = String(error)
  if (PERMISSION_DENIED.test(text)) return 'permission denied'
  if (GONE.test(text)) return 'it is not there any more'
  return 'see the transcript log'
}
