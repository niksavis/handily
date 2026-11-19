import { cutToWidth, displayWidth, lastToWidth } from './width'

const NAME_HEAD = 4

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter((part) => part !== '')
}

export function lastSegment(path: string): string {
  return segments(path).at(-1) ?? path
}

export function cutName(name: string, width: number): string {
  if (displayWidth(name) <= width) return name
  const head = cutToWidth(name, NAME_HEAD)
  return `${head}…${lastToWidth(name, Math.max(width - displayWidth(head) - 1, 0))}`
}
