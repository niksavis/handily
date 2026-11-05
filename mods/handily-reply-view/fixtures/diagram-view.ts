import type { On } from 'claude-code'
import { test, type Engine } from 'claude-code/testing'
import { displayWidth } from '../hooks/width'

export const SURFACES = ['terminal', 'desktop'] as const
export const WIDTHS = [80, 40, 30] as const
export const REMEDY = 'Widen the window or shorten the labels.'
export const CYCLE = ['suggestion', 'planMode', 'merged'] as const

const ENGINE_ROW = { type: 'engine', ref: 0 } as const
const STYLE_PROPS = ['color', 'bold', 'italic', 'underline'] as const

export type Surface = (typeof SURFACES)[number]

export type Style = Partial<Record<(typeof STYLE_PROPS)[number], unknown>>

export type Span = { text: string; style: Style }

export type World = { copies: string[]; toasts: string[] }

type Node = { type?: unknown; props?: Record<string, unknown>; children?: unknown[] }

export function lines(...rows: string[]): string {
  return rows.join('\n')
}

function isNode(value: unknown): value is Node {
  return typeof value === 'object' && value !== null
}

function styleOf(props: Record<string, unknown>): Style {
  return Object.fromEntries(
    STYLE_PROPS.flatMap((name) => (name in props ? [[name, props[name]]] : [])),
  )
}

function spansOf(node: unknown, style: Style = {}): Span[] {
  if (typeof node === 'string') return node === '' ? [] : [{ text: node, style }]
  if (!isNode(node)) return []
  const own = node.type === 'Text' ? { ...style, ...styleOf(node.props ?? {}) } : style
  return (node.children ?? []).flatMap((child) => spansOf(child, own))
}

function engineBeneath(on: On): World {
  const world: World = { copies: [], toasts: [] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [] }))
  on('config.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.render', () => ENGINE_ROW)
  on('ui.copy', (_$, e) => {
    world.copies.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', (_$, e) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  return world
}

export function viewTest(name: string, body: (world: World, $: Engine) => unknown): void {
  test(name, async ($, on) => {
    const world = engineBeneath(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    await body(world, $)
  })
}

export async function mountDiagram($: Engine, source: string, surface: Surface, columns = 80) {
  return $.ui.mount({
    plugin: 'handily-reply-view',
    surface,
    component: 'AssistantMessage',
    props: {
      text: ['The diagram:', '', '```mermaid', source, '```'].join('\n'),
      isFirstOfReply: true,
    },
    requestId: 'message-1',
    viewport: { columns, rows: 40 },
  })
}

export type Mounted = Awaited<ReturnType<typeof mountDiagram>>

export function bodyWidth(surface: Surface, columns: number): number {
  return surface === 'terminal' ? columns - 2 : columns
}

export async function drawnRows(ui: Mounted, surface: Surface): Promise<Span[][]> {
  if (surface === 'desktop') {
    const source = (await ui.find({ type: 'Code' }))?.props.source
    if (typeof source !== 'string') throw new Error('the desktop drew no Code element')
    return source.split('\n').map((text) => [{ text, style: {} }])
  }
  const drawing = await ui.find({ key: 'block-1-drawing-lines' })
  return (drawing?.children ?? []).map((row) => spansOf(row))
}

export function rowText(row: readonly Span[]): string {
  return row.map((span) => span.text).join('')
}

export function tooWideRows(rows: readonly string[], surface: Surface, columns: number): string[] {
  return rows.filter((row) => displayWidth(row) > bodyWidth(surface, columns))
}

export async function titleOf(ui: Mounted): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /── mermaid/ }))?.text
}

export async function noteOf(ui: Mounted): Promise<string | undefined> {
  return (await ui.find({ type: 'Text', text: /^diagram not drawn:/ }))?.text
}

export async function shownSource(ui: Mounted): Promise<string> {
  return (await ui.find({ key: 'block-1-noted' }))?.text ?? ''
}

export function tooWideNote(columns: number, screen: number): string {
  return `diagram not drawn: it takes ${String(columns)} columns, the screen has ${String(screen)}. ${REMEDY}`
}
