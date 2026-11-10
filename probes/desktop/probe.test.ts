import type { On, RenderPropsOf, RenderSurface } from 'claude-code'
import { describe, expect, test, type Engine } from 'claude-code/testing'

const PLUGIN = 'handily-desktop-probe'
const PANE = 'desktop-probe'
const SURFACES: readonly RenderSurface[] = ['terminal', 'desktop']
const GIT_LINE = 'git version 2.53.0'
const CLAUDE_REFUSAL = 'spawn claude ENOENT'
const COLOURS = ['#d97757', '#2e86de', '#27ae60']
const FRAME = ['┌──────────┐', '│  joined  │', '└──────────┘']

type World = { runs: string[][]; toasts: string[]; opens: string[]; commands: string[] }

function world(on: On, surfaces: readonly RenderSurface[]): World {
  const seen: World = { runs: [], toasts: [], opens: [], commands: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    seen.commands.push(e.name)
    return { value: { command: e.name } }
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('process.run', (_$, e) => {
    seen.runs.push([...e.argv])
    if (e.argv[0] === 'git') {
      return {
        value: {
          exitCode: 0,
          stdout: `${GIT_LINE}\n`,
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    }
    return { deny: CLAUDE_REFUSAL }
  })
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.open', (_$, e) => {
    seen.opens.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('ui.log', () => ({ value: undefined }))
  return seen
}

async function probe($: Engine): Promise<string> {
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const result = await $.command.run({
    command: 'probe',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 80 },
  })
  return result.text ?? ''
}

function paneProps(): RenderPropsOf['Pane'] {
  return {
    title: 'desktop probe',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  }
}

async function mountProbe($: Engine, surface: RenderSurface) {
  return $.ui.mount({
    plugin: PLUGIN,
    surface,
    component: 'Pane',
    requestId: PANE,
    props: paneProps(),
  })
}

async function textOf(ui: Awaited<ReturnType<typeof mountProbe>>, start: string) {
  return (await ui.find({ type: 'Text', text: new RegExp(`^${start}`) }))?.text
}

describe('the desktop probe', () => {
  for (const surface of SURFACES) {
    test(`/probe runs only git --version and claude --version, makes one toast and the pane shows rows a to d on ${surface}`, async ($, on) => {
      const seen = world(on, ['terminal', 'desktop'])
      expect(await probe($)).toBe('desktop probe: the pane is open')
      expect(seen.commands).toEqual(['probe'])
      expect(seen.runs).toEqual([
        ['git', '--version'],
        ['claude', '--version'],
      ])
      expect(seen.toasts).toEqual(['handily-desktop-probe: the toast of row d'])
      expect(seen.opens).toEqual([PANE])
      const ui = await mountProbe($, surface)
      expect(await textOf(ui, 'a ')).toBe(
        `a surfaces: terminal, desktop; render surface: ${surface}`,
      )
      expect(await textOf(ui, 'b ')).toBe(`b git --version: exit 0, ${GIT_LINE}`)
      const claudeRow = await textOf(ui, 'c ')
      expect(claudeRow).toMatch(/^c claude --version: threw \S+: /)
      expect(claudeRow).toContain(CLAUDE_REFUSAL)
      expect(await textOf(ui, 'd ')).toBe('d toast: returned undefined')
      await ui.unmount()
    })

    test(`the pane draws a round border, three hex colours with their values, three mono frame rows and a count button with hotkey c on ${surface}`, async ($, on) => {
      world(on, [surface])
      await probe($)
      const ui = await mountProbe($, surface)
      const boxes = await ui.findAll({ type: 'Box', text: 'e a box with a round border' })
      expect(boxes.at(-1)?.props.borderStyle).toBe('round')
      for (const colour of COLOURS) {
        expect((await ui.find({ type: 'Text', text: `■ ${colour}` }))?.props.color).toBe(colour)
      }
      const frame = await Promise.all(FRAME.map((row) => ui.find({ type: 'Text', text: row })))
      expect(frame.map((found) => [found?.text, found?.props.mono])).toEqual(
        FRAME.map((row) => [row, true]),
      )
      const button = await ui.find({ type: 'Button', key: 'count' })
      expect(button?.props.hotkey).toBe('c')
      expect(await textOf(ui, 'h ')).toBe('h presses: 0')
      await ui.unmount()
    })

    test(`a press of the count button raises the visible counter on ${surface}`, async ($, on) => {
      world(on, [surface])
      await probe($)
      const ui = await mountProbe($, surface)
      await ui.press({ key: 'count' })
      await ui.press({ key: 'count' })
      expect(await textOf(ui, 'h ')).toBe('h presses: 2')
      await ui.unmount()
    })
  }

  test('a pane drawn before /probe says to run /probe in rows a to d', async ($, on) => {
    world(on, ['terminal'])
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    const ui = await mountProbe($, 'terminal')
    expect(await textOf(ui, 'b ')).toBe('b git --version: not read yet, run /probe')
    await ui.unmount()
  })
})
