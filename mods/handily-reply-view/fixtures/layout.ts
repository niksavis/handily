import type { On, RenderPropsOf } from 'claude-code'
import type { Engine } from 'claude-code/testing'
import { diagramOf, replyTree, type ReplyElements, type ReplyLayout } from '../hooks/draw'
import { blocksOf } from '../hooks/markdown'
import { displayWidth } from '../hooks/width'
import { nodesOf, padded, sketchOf, type DrawnNode } from './sketch'

export const COLUMNS = 120
export const GAP = '   '
const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const DIAGRAM_BUTTONS = '[ copy ] [ copy drawing ]'
const BUTTONS_GAP = 2

export type Surface = 'terminal' | 'desktop'

export type Scene = {
  name: string
  room: number
  options: Record<string, string>
  isFramed: boolean
}

export const SCENES: readonly Scene[] = [
  { name: 'without the frame', room: COLUMNS - 2, options: {}, isFramed: false },
  {
    name: 'with the frame',
    room: COLUMNS - 4,
    options: { replyStyle: 'frame' },
    isFramed: true,
  },
]

export type World = { copies: string[]; debugLogs: string[] }

type Start = { pluginConfigs?: unknown; surface?: Surface }

export type Drawn = { lines: string[]; width: number }

function engineBeneath(on: On, start: Start): World {
  const world: World = { copies: [], debugLogs: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.messages', () => ({ value: [] }))
  on('session.surfaces', () => ({ value: [start.surface ?? 'terminal'] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({
    value: start.pluginConfigs === undefined ? {} : { pluginConfigs: start.pluginConfigs },
  }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', (_$, e) => {
    if (e.to === 'debug') world.debugLogs.push(e.text)
    return { value: undefined }
  })
  return world
}

export async function started($: Engine, on: On, start: Start = {}): Promise<World> {
  const world = engineBeneath(on, start)
  await $.session.start({
    cwd: '/work/app',
    surface: start.surface ?? 'terminal',
    isInteractive: true,
  })
  return world
}

function reply(text: string): RenderPropsOf['AssistantMessage'] {
  return { text, isFirstOfReply: true }
}

export async function mountReply($: Engine, text: string, surface: Surface = 'terminal') {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: reply(text),
    requestId: 'message-1',
    viewport: { columns: COLUMNS, rows: 40 },
  })
}

export async function drawnTree($: Engine, text: string, surface: Surface = 'terminal') {
  const ui = await mountReply($, text, surface)
  const tree = await ui.drawn()
  await ui.unmount()
  return tree
}

export function bodyOf(lines: readonly string[], scene: Scene): string[] {
  return scene.isFramed
    ? lines.slice(1, -1).map((line) => line.slice(2, -2).trimEnd())
    : lines.map((line) => line.slice(2).trimEnd())
}

export async function bodyLines($: Engine, text: string, scene: Scene): Promise<string[]> {
  return bodyOf(sketchOf(await drawnTree($, text), COLUMNS), scene)
}

export async function stackedBlock($: Engine, text: string, scene: Scene): Promise<Drawn> {
  const lines = await bodyLines($, text, scene)
  return { lines, width: Math.max(...lines.map(displayWidth)) }
}

export function tableOf(cell: string, rows = 1): string {
  return [
    '| Name |',
    '| --- |',
    ...Array.from({ length: rows }, (_, index) => `| ${index === 0 ? cell : 'x'} |`),
  ].join('\n')
}

export function fenced(tag: string, source: string): string {
  return ['```' + tag, source, '```'].join('\n')
}

export function together(...blocks: string[]): string {
  return blocks.join('\n\n')
}

export function rowOf(blocks: readonly Drawn[]): string[] {
  const height = Math.max(...blocks.map((block) => block.lines.length))
  return Array.from({ length: height }, (_, row) =>
    blocks
      .map((block, index) =>
        index === blocks.length - 1
          ? (block.lines[row] ?? '')
          : padded(block.lines[row] ?? '', block.width),
      )
      .join(GAP)
      .trimEnd(),
  )
}

export function sharedRowsOf(tree: unknown): DrawnNode[] {
  return nodesOf(tree).filter(
    (node) => node.type === 'Box' && node.props?.flexDirection === 'row' && node.props.gap === 3,
  )
}

function fakeElement(type: string) {
  return (props: Record<string, unknown>) => {
    const { children, ...rest } = props
    return { type, props: rest, children: children === undefined ? [] : [children].flat() }
  }
}

const FAKE_ELEMENTS = {
  Box: fakeElement('Box'),
  Text: fakeElement('Text'),
  Button: fakeElement('Button'),
  Markdown: fakeElement('Markdown'),
  Code: fakeElement('Code'),
  Link: fakeElement('Link'),
} as unknown as ReplyElements

export function treeOf(text: string, layout: Partial<ReplyLayout>): string {
  return JSON.stringify(
    replyTree(
      FAKE_ELEMENTS,
      text,
      blocksOf(text),
      {
        columns: COLUMNS,
        hasBullet: true,
        isFirstOfReply: true,
        surface: 'terminal',
        drawsDiagrams: true,
        tableStyle: 'box',
        headingStyle: 'banner',
        doneGlyph: '✓',
        highlight: true,
        palette: 'theme',
        ...layout,
      },
      'folded',
      { copy: () => undefined, fold: () => undefined },
    ),
  )
}

export function diagramBlock(source: string, room: number): Drawn {
  const outcome = diagramOf(source, room, 'terminal')
  if (outcome.kind !== 'drawing') throw new Error(`the diagram did not draw: ${outcome.reason}`)
  const drawing = outcome.lines.map((line) => line.trimEnd())
  const head = `── mermaid · ${outcome.name} `
  const titleLeast = displayWidth(`${head}──`) + BUTTONS_GAP + displayWidth(DIAGRAM_BUTTONS)
  const width = Math.max(titleLeast, ...drawing.map(displayWidth))
  const rule = '─'.repeat(width - BUTTONS_GAP - displayWidth(DIAGRAM_BUTTONS) - displayWidth(head))
  const title = `${head}${rule}${' '.repeat(BUTTONS_GAP)}${DIAGRAM_BUTTONS}`
  return { lines: [title, ...drawing], width }
}
