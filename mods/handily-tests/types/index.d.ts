export type TestsRunner = 'vitest' | 'jest' | 'node' | 'pytest'

export type TestsFailure = {
  name: string
  file: string | null
  line: number | null
  message: string
  diff: readonly string[]
}

export type TestsOutcome =
  | {
      kind: 'tests'
      runner: TestsRunner
      passed: number
      failed: number
      total: number
      failures: readonly TestsFailure[]
      isCut: boolean
    }
  | { kind: 'broken'; runner: TestsRunner; reason: string }
  | { kind: 'interrupted'; runner: TestsRunner | null }
  | { kind: 'background'; runner: null }
  | { kind: 'unreadable'; runner: TestsRunner }

export type TestsRun = {
  id: string
  command: string
  agent: string | null
  endedAt: number
  tookMs: number
  outcome: TestsOutcome
}

export type TestsRuns = readonly TestsRun[]

export type TestsGlyphs = 'plain' | 'nerd'

declare module 'claude-code' {
  interface PluginState {
    'handily-tests': {
      runs: TestsRuns
      ready: { root: string }
      glyphs: TestsGlyphs
    }
  }
}
