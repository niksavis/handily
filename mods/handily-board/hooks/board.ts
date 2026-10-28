import type { PluginOptions } from 'claude-code'

export const TASKS_PANE = { id: 'tasks', title: 'this session' } as const

export const SESSIONS_PANE = { id: 'sessions', title: 'this machine' } as const

export type BoardPane = typeof TASKS_PANE | typeof SESSIONS_PANE

export const BOARD_PANES: readonly BoardPane[] = [TASKS_PANE, SESSIONS_PANE]

export const WAITS_FOR_WIDER_TERMINAL =
  'Board waits for a wider terminal. Run /board to open it here.'

export type BoardMode = 'off' | 'toggle' | 'always'

const BOARD_MODES: readonly BoardMode[] = ['off', 'toggle', 'always']

export function boardMode(options: PluginOptions): BoardMode {
  const mode = options.mode ?? 'toggle'
  const known = BOARD_MODES.find((candidate) => candidate === mode)
  if (!known) {
    throw new Error(
      `handily-board: userConfig mode is ${JSON.stringify(mode)}; set it to off, toggle or always in /config.`,
    )
  }
  return known
}

export type PromptFill = { isFilled: boolean; refusal?: string }

export type PaneOpened = { isPlaced: true } | { isPlaced: false; reason: string }

export type OpenPane = { id: string; isShown: boolean; isPlaced: boolean }

export type PaneUi = {
  open: (pane: BoardPane, focus: boolean) => Promise<PaneOpened>
  close: (id: string) => Promise<void>
  panes: () => Promise<readonly OpenPane[]>
  fillPrompt: (text: string) => Promise<PromptFill>
  openAgents: () => Promise<void>
  focus: (key: string) => Promise<void>
  toast: (text: string) => void
  log: (text: string) => void
}

function isBoardPane(pane: OpenPane): boolean {
  return BOARD_PANES.some((board) => board.id === pane.id)
}

export function isTasksSeen(panes: readonly OpenPane[]): boolean {
  return panes.some((open) => open.id === TASKS_PANE.id && open.isShown && open.isPlaced)
}

async function openUnopened(
  ui: PaneUi,
  panes: readonly BoardPane[],
  before: readonly OpenPane[],
): Promise<void> {
  for (const pane of panes) {
    if (!before.some((open) => open.id === pane.id)) await ui.open(pane, false)
  }
}

export async function showPane(ui: PaneUi, asked: BoardPane): Promise<PaneOpened> {
  const before = await ui.panes()
  const isShown = before.some((open) => open.id === asked.id && open.isShown)
  const at = BOARD_PANES.indexOf(asked)
  await openUnopened(ui, BOARD_PANES.slice(0, at), before)
  const opened = await ui.open(asked, !isShown)
  await openUnopened(ui, BOARD_PANES.slice(at + 1), before)
  return opened
}

export async function openBoard(ui: PaneUi, asked: BoardPane): Promise<string> {
  const opened = await showPane(ui, asked)
  if (opened.isPlaced) return `Board opened: ${asked.title}.`
  return `Board opened, but this session does not show it yet: ${opened.reason} /board list prints the tasks.`
}

export async function closeBoard(ui: PaneUi): Promise<string> {
  const open = (await ui.panes()).filter(isBoardPane)
  if (open.length === 0) return 'The board is not open. Run /board to open it.'
  for (const pane of open) await ui.close(pane.id)
  return 'Board closed.'
}

export async function sessionCommand(ui: PaneUi, mode: BoardMode): Promise<string> {
  if (mode === 'toggle' && isTasksSeen(await ui.panes())) return closeBoard(ui)
  return openBoard(ui, TASKS_PANE)
}

export async function openUnasked(ui: PaneUi): Promise<void> {
  const opened = await ui.open(TASKS_PANE, false)
  await ui.open(SESSIONS_PANE, false)
  if (opened.isPlaced) return
  ui.log(`handily-board: the board waits undrawn: ${opened.reason}`)
  ui.toast(WAITS_FOR_WIDER_TERMINAL)
}
