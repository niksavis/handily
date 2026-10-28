export const MASK = '***'

const SECRET_WORDS =
  'token|secret|passw(?:or)?d|pwd|api[_-]?key|credentials?|private[_-]?key|access[_-]?key|authorization|cookie'

const URL_USER_INFO = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi

const SECRET_VALUE = `(?:"[^"]*"|'[^']*'|(?:(?:bearer|basic)\\s+)?[^\\s"'&]+)`

const SECRET_ASSIGNMENT = new RegExp(
  `(\\b[\\w.-]*(?:${SECRET_WORDS})[\\w.-]*)(\\s*[=:]\\s*)${SECRET_VALUE}`,
  'gi',
)

const SECRET_FLAG_VALUE = new RegExp(
  `(--?[\\w-]*(?:${SECRET_WORDS})[\\w-]*)(\\s+)${SECRET_VALUE}`,
  'gi',
)

const USER_FLAG_PASSWORD = /(\s(?:-u|--user)\s+["']?[^\s:"']+):[^\s"']+/g

const AUTH_SCHEME_VALUE = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi

const TOKEN_SHAPES = new RegExp(
  [
    'gh[pousr]_[A-Za-z0-9]{20,}',
    'github_pat_[A-Za-z0-9_]{20,}',
    'glpat-[A-Za-z0-9_-]{20,}',
    'xox[abprs]-[A-Za-z0-9-]{10,}',
    'sk-[A-Za-z0-9_-]{20,}',
    'AKIA[0-9A-Z]{16}',
    'eyJ[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}\\.[A-Za-z0-9_-]{8,}',
  ]
    .map((shape) => `\\b${shape}`)
    .join('|'),
  'g',
)

export function maskedCredentials(text: string): string {
  return text
    .replace(URL_USER_INFO, `$1${MASK}@`)
    .replace(SECRET_ASSIGNMENT, `$1$2${MASK}`)
    .replace(SECRET_FLAG_VALUE, `$1$2${MASK}`)
    .replace(USER_FLAG_PASSWORD, `$1:${MASK}`)
    .replace(AUTH_SCHEME_VALUE, `$1 ${MASK}`)
    .replace(TOKEN_SHAPES, MASK)
}
