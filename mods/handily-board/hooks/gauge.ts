import type { ThemeKey } from 'claude-code'
import { BAR_EMPTY, BAR_FILLED } from './bar'
import { type PaletteSetting, paletteColor } from './palette'
import type { Part } from './parts'
import { highText, isHighPercent } from './vitals'

export const CONTEXT_CELLS = 10
export const LIMIT_CELLS = 5

const HIGH_COLOR: ThemeKey = 'warning'
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

function gaugeParts(percent: number, cells: number, palette: PaletteSetting): Part[] {
  const filled = filledCells(percent, cells)
  const isHigh = isHighPercent(Math.round(percent))
  return [
    {
      text: BAR_FILLED.repeat(filled),
      color: isHigh ? HIGH_COLOR : paletteColor('sessionFrame', palette),
    },
    { text: BAR_EMPTY.repeat(cells - filled), color: paletteColor('rules', palette) },
  ].filter((part) => part.text !== '')
}

export type Gauge = { label: string; percent: number; cells: number; tail?: string }

export function gaugeForms(gauge: Gauge, palette: PaletteSetting): Part[][] {
  const { label, percent, cells, tail } = gauge
  const percentText = percentParts(percent)
  const full = [{ text: `${label} ` }, ...gaugeParts(percent, cells, palette), { text: ' ' }]
  const short = [{ text: `${label} ` }]
  if (tail === undefined)
    return [
      [...full, ...percentText],
      [...short, ...percentText],
    ]
  const after = { text: ` ${tail}` }
  return [
    [...full, ...percentText, after],
    [...short, ...percentText, after],
  ]
}
