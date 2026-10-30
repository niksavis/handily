import type { UiOpenResult, UiPane } from 'claude-code'
import { TESTS_PANE } from './pane'

export type TestsCommand =
  | { kind: 'toggle' }
  | { kind: 'close' }
  | { kind: 'list' }
  | { kind: 'clear' }
  | { kind: 'unknown'; word: string }

export type TestsUi = {
  open: (focus: boolean) => Promise<UiOpenResult>
  close: () => Promise<void>
  panes: () => Promise<readonly UiPane[]>
}

const WORDS: ReadonlyMap<string, TestsCommand> = new Map([
  ['', { kind: 'toggle' }],
  ['close', { kind: 'close' }],
  ['list', { kind: 'list' }],
  ['clear', { kind: 'clear' }],
])

export function parseTestsCommand(args: string): TestsCommand {
  const word = args.trim()
  return WORDS.get(word) ?? { kind: 'unknown', word }
}

export function unknownReply(word: string): string {
  return `Unknown argument ${JSON.stringify(word)}. Use /tests to open or close the tests tab, /tests close, /tests list or /tests clear.`
}

export function clearReply(count: number): string {
  if (count === 0) return 'No test run to clear.'
  return `Cleared ${String(count)} test ${count === 1 ? 'run' : 'runs'}.`
}

export async function testsPane(ui: TestsUi): Promise<UiPane | undefined> {
  return (await ui.panes()).find((pane) => pane.id === TESTS_PANE.id)
}

export async function closeTests(ui: TestsUi): Promise<string> {
  if ((await testsPane(ui)) === undefined)
    return 'The tests tab is not open. Run /tests to open it.'
  await ui.close()
  return 'Tests tab closed.'
}

export async function toggleTests(ui: TestsUi): Promise<string> {
  const pane = await testsPane(ui)
  if (pane?.isShown === true && pane.isPlaced) return closeTests(ui)
  const opened = await ui.open(true)
  if (opened.isPlaced) return 'Tests tab opened.'
  return `Tests tab opened, but this session does not show it yet: ${opened.reason}`
}
