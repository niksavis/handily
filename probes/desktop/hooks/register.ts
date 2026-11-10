import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  EngineInterface,
  Register,
  RenderElement,
  TextProps,
} from 'claude-code'

export const PROBE_PANE = { id: 'desktop-probe', title: 'desktop probe' } as const
export const PROBE_COMMAND = 'probe'
export const GIT_ARGV = ['git', '--version'] as const
export const CLAUDE_ARGV = ['claude', '--version'] as const
export const TOAST_TEXT = 'handily-desktop-probe: the toast of row d'
export const COLOURS = ['#d97757', '#2e86de', '#27ae60'] as const
export const FRAME = ['┌──────────┐', '│  joined  │', '└──────────┘'] as const
export const COUNT_KEY = 'count'
export const COUNT_HOTKEY = 'c'

type Readings = { surfaces: string; git: string; claude: string; toast: string }

type Elements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
}

type Probe = { readings: Readings | undefined; presses: number }

type Shown = { surface: string; readings: Readings | undefined; presses: number }

function failureText(error: unknown): string {
  return error instanceof Error ? `threw ${error.name}: ${error.message}` : `threw ${String(error)}`
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0]?.trim() ?? ''
}

async function runText($: EngineInterface, argv: readonly string[]): Promise<string> {
  try {
    const { exitCode, stdout, stderr } = await $.process.run(argv)
    const out = firstLine(stdout)
    const shown = out === '' ? `stderr ${firstLine(stderr) || 'empty'}` : out
    return `exit ${String(exitCode)}, ${shown}`
  } catch (error) {
    return failureText(error)
  }
}

async function surfacesText($: EngineInterface): Promise<string> {
  try {
    const surfaces = await $.session.surfaces()
    return surfaces.length === 0 ? 'none' : surfaces.join(', ')
  } catch (error) {
    return failureText(error)
  }
}

function toastText($: EngineInterface): string {
  try {
    const returned: unknown = $.ui.toast(TOAST_TEXT)
    return `returned ${String(returned)}`
  } catch (error) {
    return failureText(error)
  }
}

async function readingsOf($: EngineInterface): Promise<Readings> {
  return {
    surfaces: await surfacesText($),
    git: await runText($, GIT_ARGV),
    claude: await runText($, CLAUDE_ARGV),
    toast: toastText($),
  }
}

function line(elements: Elements, text: string): RenderElement {
  return elements.Text({ children: text })
}

function readingRows(elements: Elements, shown: Shown): RenderElement[] {
  const { readings } = shown
  const unread = 'not read yet, run /probe'
  return [
    line(elements, `a surfaces: ${readings?.surfaces ?? unread}; render surface: ${shown.surface}`),
    line(elements, `b git --version: ${readings?.git ?? unread}`),
    line(elements, `c claude --version: ${readings?.claude ?? unread}`),
    line(elements, `d toast: ${readings?.toast ?? unread}`),
  ]
}

function borderRow(elements: Elements): RenderElement {
  return elements.Box({
    borderStyle: 'round',
    children: line(elements, 'e a box with a round border'),
  })
}

function colourRow(elements: Elements): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    gap: 1,
    children: [
      line(elements, 'f colours:'),
      ...COLOURS.map((colour) => Text({ color: colour, children: `■ ${colour}` })),
    ],
  })
}

function frameRows(elements: Elements): RenderElement[] {
  const { Box, Text } = elements
  return [
    line(elements, 'g three mono rows that join into one frame:'),
    Box({
      flexDirection: 'column',
      children: FRAME.map((row) => Text({ mono: true, children: row })),
    }),
  ]
}

function counterRow(elements: Elements, presses: number, onPress: () => void): RenderElement {
  const { Box, Button } = elements
  return Box({
    flexDirection: 'row',
    gap: 1,
    children: [
      Button({ key: COUNT_KEY, label: 'count', hotkey: COUNT_HOTKEY, onPress }),
      line(elements, `h presses: ${String(presses)}`),
    ],
  })
}

export function drawProbe(elements: Elements, shown: Shown, onPress: () => void): RenderElement {
  return elements.Box({
    flexDirection: 'column',
    children: [
      ...readingRows(elements, shown),
      borderRow(elements),
      colourRow(elements),
      ...frameRows(elements),
      counterRow(elements, shown.presses, onPress),
    ],
  })
}

export const register: Register = (on) => {
  const probe: Probe = { readings: undefined, presses: 0 }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: PROBE_COMMAND,
      description: 'handily desktop probe · Open one pane of desktop readings',
    })
    return next(e)
  })

  on('command.run', { command: PROBE_COMMAND }, async ($) => {
    probe.readings = await readingsOf($)
    const opened = await $.ui.open({ ...PROBE_PANE, focus: true })
    $.ui.invalidate('ui.render')
    return {
      text: opened.isPlaced
        ? 'desktop probe: the pane is open'
        : `desktop probe: the pane is not placed: ${opened.reason}`,
    }
  }).catch(($, _e, next) => {
    $.ui.log(
      `handily-desktop-probe: /probe failed (${next.error.kind}): ${next.error.message ?? 'no message'}`,
    )
    return { text: 'desktop probe: /probe failed; see the transcript log.' }
  })

  on('ui.render', { component: 'Pane', requestId: PROBE_PANE.id }, ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const shown = { surface: e.surface, readings: probe.readings, presses: probe.presses }
    return drawProbe({ Box, Text, Button }, shown, () => {
      probe.presses += 1
      $.ui.invalidate('ui.render')
    })
  })
}
