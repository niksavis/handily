import type { ThemeKey } from 'claude-code'
import { BAR_EMPTY, BAR_FILLED } from './bar'
import type { Part } from './parts'
import { highText, isHighPercent } from './vitals'

export const CONTEXT_CELLS = 10
export const LIMIT_CELLS = 5

const FILL_COLOR: ThemeKey = 'claude'
const HIGH_COLOR: ThemeKey = 'warning'
const EMPTY_COLOR: ThemeKey = 'subtle'
const FULL_PERCENT = 100

function filledCells(percent: number, cells: number): number {
  const filled = Math.floor((percent * cells) / FULL_PERCENT)
  return Math.min(Math.max(filled, 0), cells)
}

function percentParts(percent: number): Part[] {
  const shown = Math.round(percent)
  return isHighPercent(shown)
    ? [{ text: highText(shown), color: HIGH_COLOR }]
    : [{ text: `${String(shown)}%` }]
}

function gaugeParts(percent: number, cells: number): Part[] {
  const filled = filledCells(percent, cells)
  const isHigh = isHighPercent(Math.round(percent))
  return [
    { text: BAR_FILLED.repeat(filled), color: isHigh ? HIGH_COLOR : FILL_COLOR },
    { text: BAR_EMPTY.repeat(cells - filled), color: EMPTY_COLOR },
  ].filter((part) => part.text !== '')
}

export function gaugeForms(label: string, percent: number, cells: number): Part[][] {
  const percentText = percentParts(percent)
  return [
    [{ text: `${label} ` }, ...gaugeParts(percent, cells), { text: ' ' }, ...percentText],
    [{ text: `${label} ` }, ...percentText],
  ]
}
