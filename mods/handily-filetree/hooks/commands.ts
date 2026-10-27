import type { UiOpenResult, UiPane } from 'claude-code'

export const FILES_PANE = { id: 'files', title: 'files' } as const

export type TreeCommand = { kind: 'toggle' } | { kind: 'close' } | { kind: 'unknown'; word: string }

export type TreeUi = {
  open: (focus: boolean) => Promise<UiOpenResult>
  close: () => Promise<void>
  panes: () => Promise<readonly UiPane[]>
}

export function parseTreeCommand(args: string): TreeCommand {
  const word = args.trim()
  if (word === '') return { kind: 'toggle' }
  if (word === 'close') return { kind: 'close' }
  return { kind: 'unknown', word }
}

export function unknownReply(word: string): string {
  return `Unknown argument ${JSON.stringify(word)}. Use /tree to open or close the files tab, or /tree close.`
}

async function filesPane(ui: TreeUi): Promise<UiPane | undefined> {
  return (await ui.panes()).find((pane) => pane.id === FILES_PANE.id)
}

export async function closeTree(ui: TreeUi): Promise<string> {
  if ((await filesPane(ui)) === undefined) return 'The tree is not open. Run /tree to open it.'
  await ui.close()
  return 'Tree closed.'
}

export async function toggleTree(ui: TreeUi): Promise<string> {
  const pane = await filesPane(ui)
  if (pane?.isShown === true && pane.isPlaced) return closeTree(ui)
  const opened = await ui.open(pane?.isShown !== true)
  if (opened.isPlaced) return 'Tree opened: files.'
  return `Tree opened, but this session does not show it yet: ${opened.reason}`
}
