export const RECORDED_AGENTS = `[
  {
    "id": "0000a001",
    "cwd": "/work/docs",
    "kind": "background",
    "startedAt": 1787489181095,
    "sessionId": "00000000-0000-4000-8000-000000000001",
    "name": "docs-pass",
    "state": "blocked"
  },
  {
    "pid": 1001,
    "cwd": "/work/api",
    "kind": "interactive",
    "startedAt": 1791394899761,
    "sessionId": "00000000-0000-4000-8000-000000000002",
    "name": "api-login",
    "status": "busy"
  },
  {
    "pid": 1002,
    "cwd": "/work/app",
    "kind": "interactive",
    "startedAt": 1791398802857,
    "sessionId": "00000000-0000-4000-8000-000000000003",
    "name": "mocks",
    "status": "busy"
  },
  {
    "pid": 1003,
    "cwd": "/work/app.wt/lane-a1",
    "kind": "interactive",
    "startedAt": 1791404109915,
    "sessionId": "00000000-0000-4000-8000-000000000004",
    "name": "lane-a1",
    "status": "idle"
  }
]
`

export type AgentEntry = Record<string, string | number>

export const MACHINE_NOW = 1_791_400_000_000

const HOUR = 60 * 60_000

export const MACHINE_AGENTS: readonly AgentEntry[] = [
  {
    id: '0000b004',
    cwd: '/work/docs',
    kind: 'background',
    startedAt: MACHINE_NOW - 5 * HOUR,
    sessionId: '00000000-0000-4000-8000-00000000000d',
    name: 'docs-pass',
    state: 'done',
  },
  {
    id: '0000b002',
    cwd: '/work/app.wt/lane-a1',
    kind: 'background',
    startedAt: MACHINE_NOW - HOUR,
    sessionId: '00000000-0000-4000-8000-00000000000b',
    name: 'lane-a1',
    state: 'working',
  },
  {
    pid: 2001,
    cwd: '/work/app',
    kind: 'interactive',
    startedAt: MACHINE_NOW - 3 * HOUR,
    sessionId: '00000000-0000-4000-8000-00000000000a',
    name: 'mocks',
    status: 'busy',
  },
  {
    pid: 2003,
    cwd: '/work/api',
    kind: 'interactive',
    startedAt: MACHINE_NOW - 2 * HOUR,
    sessionId: '00000000-0000-4000-8000-00000000000c',
    name: 'api-login',
    status: 'waiting',
    waitingFor: 'permission',
  },
  {
    id: '0000b009',
    cwd: '/work/docs',
    kind: 'background',
    startedAt: MACHINE_NOW - 46 * 24 * HOUR,
    sessionId: '00000000-0000-4000-8000-000000000009',
    name: 'factory loop',
    state: 'blocked',
  },
]
