export const CLASSIFIER_DENIAL_START_ON_2_1_296 =
  'Permission for this action was denied by the Claude Code auto mode classifier. Reason: '
export const CLASSIFIER_ADVICE_ON_2_1_296 =
  " If you have other tasks that don't depend on this action, continue working on those. IMPORTANT: You *may* attempt to accomplish this action using other tools that might naturally be used to accomplish this goal, e.g. using head instead of cat. But you *should not* attempt to work around this denial in malicious ways, e.g. do not use your ability to run tests to execute non-test actions. You should only try to work around this restriction in reasonable ways that do not attempt to bypass the intent behind this denial. If you believe this capability is essential to complete the user's request, first try a safer method. Get as much of the rest of the task done as you can, then STOP and explain to the user what you were trying to do and why you need this permission. Let the user decide how to proceed."
export const BASH_RULE_ADVICE_ON_2_1_296 =
  ' To allow this type of action in the future, the user can add a permission rule for Bash to their settings.'
export const SERVER_SIDE_REASON_ON_2_1_311 =
  'The server-side auto mode classifier judged this action dangerous (it gave no explanation).'
export const EDIT_DENIED_ON_2_1_296 = `${CLASSIFIER_DENIAL_START_ON_2_1_296}[Self-Modification].${CLASSIFIER_ADVICE_ON_2_1_296}`
export const BASH_DENIED_ON_2_1_296 = `${EDIT_DENIED_ON_2_1_296}${BASH_RULE_ADVICE_ON_2_1_296}`
export const BASH_DENIED_ON_2_1_311 = `${CLASSIFIER_DENIAL_START_ON_2_1_296}${SERVER_SIDE_REASON_ON_2_1_311}${CLASSIFIER_ADVICE_ON_2_1_296}${BASH_RULE_ADVICE_ON_2_1_296}`

export const RULE_DENIED_BASH_ON_2_1_322 =
  'Permission to use Bash with command touch other.txt has been denied.'

export const PERSON_DENIED_ON_2_1_312 =
  "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
export const PERSON_REJECTED_OUTPUT_ON_2_1_323 = 'User rejected tool use'

export const HOOK_ERROR_ON_2_1_312 = (event: string, tool: string, command: string): string =>
  `${event}:${tool} hook error: [${command}]: `

export const ERRORED_OUTPUT_ON_2_1_332 = (text: string): string => `Error: ${text}`
export const EXIT_CODE_ON_2_1_332 = (code: number): string => `Exit code ${String(code)}`
export const EXITED_ON_2_1_332 = (code: number): string =>
  ERRORED_OUTPUT_ON_2_1_332(EXIT_CODE_ON_2_1_332(code))

export const INTERRUPTED_ON_2_1_332 = 'Interrupted by user'
export const REQUEST_INTERRUPTED_ON_2_1_332 = '[Request interrupted by user for tool use]'

export const FILE_NOT_READ_ON_2_1_332 =
  'File has not been read yet. Read it first before writing to it.'
export const FILE_MODIFIED_ON_2_1_332 =
  'File has been modified since read, either by the user or by a linter. Read it again before attempting to write it.'
export const FILE_MISSING_ON_2_1_332 = (cwd: string): string =>
  `File does not exist. Note: your current working directory is ${cwd}.`
export const TOOL_USE_ERROR_ON_2_1_328 = (text: string): string =>
  `<tool_use_error>${text}</tool_use_error>`
export const UNKNOWN_SKILL_ON_2_1_332 = (skill: string): string => `Unknown skill: ${skill}`
