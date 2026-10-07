export type CommandCase = {
  command: string
  isWrite: boolean
  expect: 'write' | 'opaque' | 'none'
  tracker?: string
  verb?: string
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
    expect: 'write',
    tracker: 'br',
    verb: 'close',
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
    expect: 'write',
    tracker: 'br',
    verb: 'close',
  },
  {
    command: 'for i in a b; do br close $i; done',
    isWrite: true,
    expect: 'opaque',
    tracker: 'br',
    verb: 'close',
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
    expect: 'write',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'assign',
  },
  {
    command: 'python3 ./.basicly/core/kit/tracker/cli.py close h-1',
    isWrite: true,
    expect: 'write',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'close',
  },
  {
    command: 'python3 /abs/repo/.basicly/core/kit/tracker/cli.py close x',
    isWrite: true,
    expect: 'write',
    tracker: '.basicly/core/kit/tracker/cli.py',
    verb: 'close',
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
