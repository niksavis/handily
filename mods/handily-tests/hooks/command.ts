const SEGMENTS = /&&|\|\||[;|()&\n]/
const ENV_ASSIGNMENT = /^\w+=/
const FLAG = /^-/
const RUNNERS: ReadonlySet<string> = new Set(['vitest', 'jest', 'pytest', 'py.test'])
const PACKAGE_MANAGERS: ReadonlySet<string> = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const BIN_RUNNERS: ReadonlySet<string> = new Set(['pnpm', 'yarn', 'bun'])
const EXEC_WORDS: ReadonlySet<string> = new Set(['exec', 'x', 'dlx'])
const LAUNCHERS: ReadonlySet<string> = new Set(['npx', 'bunx', 'time'])
const RUN_TOOLS: ReadonlySet<string> = new Set(['uv', 'poetry', 'pipenv', 'hatch'])
const PYTHONS = /^python(?:\d+(?:\.\d+)?)?$/
const TEST_SCRIPT = /^test(?::\S*)?$/
const NODE_TEST_FLAG = /^--test(?:=|$)/

function baseName(word: string): string {
  return word.split(/[\\/]/).at(-1) ?? word
}

function withoutFlags(words: readonly string[]): string[] {
  const at = words.findIndex((word) => !FLAG.test(word))
  return at < 0 ? [] : words.slice(at)
}

function runsPackageTests(words: readonly string[]): boolean {
  const [manager = '', ...rest] = words
  const [verb = '', script = ''] = withoutFlags(rest)
  if (verb === 't' || TEST_SCRIPT.test(verb)) return true
  if (verb === 'run' || verb === 'run-script') return TEST_SCRIPT.test(script)
  if (EXEC_WORDS.has(verb)) return runsTests(withoutFlags(rest).slice(1))
  return BIN_RUNNERS.has(manager) && runsTests(withoutFlags(rest))
}

function runsTests(words: readonly string[]): boolean {
  const [first = '', second = ''] = words
  const name = baseName(first)
  if (LAUNCHERS.has(name)) return runsTests(withoutFlags(words.slice(1)))
  if (PACKAGE_MANAGERS.has(name)) return runsPackageTests(words)
  if (PYTHONS.test(name)) return second === '-m' && runsTests(words.slice(2))
  if (RUN_TOOLS.has(name)) return second === 'run' && runsTests(withoutFlags(words.slice(2)))
  if (name === 'node') return words.some((word) => NODE_TEST_FLAG.test(word))
  return RUNNERS.has(name)
}

function commandWords(segment: string): string[] {
  const words = segment
    .trim()
    .split(/\s+/)
    .filter((word) => word !== '')
  const at = words.findIndex((word) => !ENV_ASSIGNMENT.test(word))
  return at < 0 ? [] : words.slice(at)
}

export function isTestCommand(command: string): boolean {
  return command.split(SEGMENTS).some((segment) => runsTests(commandWords(segment)))
}
