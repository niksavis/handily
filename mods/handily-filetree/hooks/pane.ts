import type {
  BoxProps,
  ButtonProps,
  ElementConstructor,
  RenderElement,
  TextProps,
} from 'claude-code'
import {
  type EntryRow,
  type Folders,
  type Listing,
  type TreeRow,
  ROOT_PATH,
  childPath,
  entryRow,
} from './tree'
import { displayWidth, fitted } from './width'

export type PaneElements = {
  Box: ElementConstructor<BoxProps>
  Text: ElementConstructor<TextProps>
  Button: ElementConstructor<ButtonProps>
  bodyColumns: number
}

export type PaneActions = {
  toggle: (path: string) => void
  showAll: (path: string) => void
  refresh: () => void
}

export const INLINE_ROWS = 8

const FILES_TITLE = 'Files'
const REFRESH = 'refresh'
const BUTTON_CHROME = 4
const BUTTON_GAP = 1
const INDENT = '  '
const OPEN_MARK = '▾'
const CLOSED_MARK = '▸'
const RULE = '─'
const NOT_LISTED = 'not listed'
const DOCK_HINT = 'a dock (fullscreen, 110 columns) shows the tree'
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

function escapedUnits(text: string): string {
  return Array.from(
    { length: text.length },
    (_, index) => `\\u${text.charCodeAt(index).toString(16).padStart(4, '0')}`,
  ).join('')
}

function shownName(name: string): string {
  return name.replace(UNSAFE, escapedUnits)
}

function countText(count: number): string {
  return count.toLocaleString('en-US')
}

function indentOf(depth: number): string {
  return INDENT.repeat(depth)
}

function drawHeader(elements: PaneElements, rootName: string, width: number): RenderElement {
  const { Box, Text } = elements
  return Box({
    flexDirection: 'row',
    children: [
      Text({ bold: true, children: FILES_TITLE }),
      Text({
        children: fitted(`  ${shownName(rootName)}`, width - displayWidth(FILES_TITLE)),
      }),
    ],
  })
}

function refreshButton(elements: PaneElements, actions: PaneActions): RenderElement {
  return elements.Button({
    key: 'refresh',
    label: REFRESH,
    hotkey: 'r',
    onPress: () => {
      actions.refresh()
    },
  })
}

function folderText(row: { name: string; depth: number }, mark: string): string {
  return `${indentOf(row.depth)}${mark} ${shownName(row.name)}/`
}

function drawFolder(
  elements: PaneElements,
  row: EntryRow & { kind: 'folder' },
  actions: PaneActions,
): RenderElement {
  const { Box, Text, Button, bodyColumns } = elements
  const indent = displayWidth(indentOf(row.depth))
  const mark = row.isOpen ? OPEN_MARK : CLOSED_MARK
  return Box({
    key: `folder:${row.path}`,
    flexDirection: 'row',
    paddingLeft: indent,
    children: [
      Button({
        key: `open:${row.path}`,
        plain: true,
        onPress: () => {
          actions.toggle(row.path)
        },
        children: [
          Text({ children: fitted(`${mark} ${shownName(row.name)}/`, bodyColumns - indent) }),
        ],
      }),
    ],
  })
}

function drawEntry(elements: PaneElements, row: EntryRow, actions: PaneActions): RenderElement {
  const { Text, bodyColumns } = elements
  switch (row.kind) {
    case 'pruned':
      return Text({
        children: fitted(`${folderText(row, CLOSED_MARK)}  ${NOT_LISTED}`, bodyColumns),
      })
    case 'file':
      return Text({
        dimColor: row.isDot,
        children: fitted(`${indentOf(row.depth)}${INDENT}${shownName(row.name)}`, bodyColumns),
      })
    case 'folder':
      return drawFolder(elements, row, actions)
  }
}

function drawFailed(
  elements: PaneElements,
  failed: { name: string; depth: number; reason: string },
): RenderElement {
  const text = `${indentOf(failed.depth)}Cannot list ${shownName(failed.name)}/: ${failed.reason}.`
  return elements.Text({ color: 'error', children: fitted(text, elements.bodyColumns) })
}

function drawMore(
  elements: PaneElements,
  row: TreeRow & { kind: 'more' },
  actions: PaneActions,
): RenderElement {
  const { Box, Button, bodyColumns } = elements
  const indent = displayWidth(indentOf(row.depth) + INDENT)
  const label = `+${countText(row.hidden)} more in ${shownName(row.name)}/`
  return Box({
    key: `more-row:${row.path}`,
    paddingLeft: indent,
    children: [
      Button({
        key: `more:${row.path}`,
        label: fitted(label, bodyColumns - indent - BUTTON_CHROME),
        onPress: () => {
          actions.showAll(row.path)
        },
      }),
    ],
  })
}

function drawRow(elements: PaneElements, row: TreeRow, actions: PaneActions): RenderElement {
  switch (row.kind) {
    case 'more':
      return drawMore(elements, row, actions)
    case 'failed':
      return drawFailed(elements, row)
    case 'empty':
      return elements.Text({ dimColor: true, children: 'This folder is empty.' })
    default:
      return drawEntry(elements, row, actions)
  }
}

export function drawTree(
  elements: PaneElements,
  rootName: string,
  rows: readonly TreeRow[],
  actions: PaneActions,
): RenderElement {
  const { Box, Text, bodyColumns } = elements
  return Box({
    flexDirection: 'column',
    children: [
      drawHeader(elements, rootName, bodyColumns),
      Box({ flexDirection: 'row', children: [refreshButton(elements, actions)] }),
      Text({ children: RULE.repeat(Math.max(bodyColumns, 0)) }),
      ...rows.map((row) => drawRow(elements, row, actions)),
    ],
  })
}

function flatRow(elements: PaneElements, row: EntryRow): RenderElement {
  const { Text, bodyColumns } = elements
  const name = shownName(row.name)
  switch (row.kind) {
    case 'pruned':
      return Text({ children: fitted(`${name}/  ${NOT_LISTED}`, bodyColumns) })
    case 'folder':
      return Text({ children: fitted(`${name}/`, bodyColumns) })
    case 'file':
      return Text({ dimColor: row.isDot, children: fitted(name, bodyColumns) })
  }
}

function inlineRows(elements: PaneElements, root: Listing, rootName: string): RenderElement[] {
  const { Text, bodyColumns } = elements
  if (root.kind === 'failed') {
    return [drawFailed(elements, { name: rootName, depth: 0, reason: root.reason })]
  }
  if (root.sorted.length === 0) {
    return [Text({ dimColor: true, children: 'This folder is empty.' })]
  }
  const closed: Folders = { open: new Set(), whole: new Set() }
  const rows = root.sorted.map((entry) =>
    entryRow(entry, childPath(ROOT_PATH, entry.name), 0, closed),
  )
  if (rows.length <= INLINE_ROWS) return rows.map((row) => flatRow(elements, row))
  const shown = rows.slice(0, INLINE_ROWS - 1)
  const hidden = countText(rows.length - shown.length)
  return [
    ...shown.map((row) => flatRow(elements, row)),
    Text({ dimColor: true, children: fitted(`+${hidden} more: ${DOCK_HINT}`, bodyColumns) }),
  ]
}

export function drawInline(
  elements: PaneElements,
  rootName: string,
  root: Listing,
  actions: PaneActions,
): RenderElement {
  const { Box, bodyColumns } = elements
  const headerWidth = bodyColumns - displayWidth(REFRESH) - BUTTON_CHROME - BUTTON_GAP
  return Box({
    flexDirection: 'column',
    children: [
      Box({
        flexDirection: 'row',
        justifyContent: 'space-between',
        children: [drawHeader(elements, rootName, headerWidth), refreshButton(elements, actions)],
      }),
      ...inlineRows(elements, root, rootName),
    ],
  })
}
