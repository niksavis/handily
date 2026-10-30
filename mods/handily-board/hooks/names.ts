import { cutToWidth, displayWidth, lastToWidth } from './width'

const NAME_HEAD = 4

export function cutName(name: string, width: number): string {
  if (displayWidth(name) <= width) return name
  const head = cutToWidth(name, NAME_HEAD)
  return `${head}…${lastToWidth(name, Math.max(width - displayWidth(head) - 1, 0))}`
}
