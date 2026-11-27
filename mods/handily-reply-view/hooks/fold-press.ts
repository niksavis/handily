import type { ReplyViewFold } from '../types'

export type FoldPort = {
  keep: (id: string, next: ReplyViewFold) => Promise<void>
  log: (text: string) => void
  fail: (what: string, error: unknown) => void
}

export function foldId(id: string, block: string | undefined): string {
  return block === undefined ? id : `${id}#${block}`
}

export async function pressFold(
  port: FoldPort,
  id: string,
  next: ReplyViewFold,
  block?: string,
): Promise<void> {
  const what = block === undefined ? 'the reply' : 'the code block'
  try {
    await port.keep(foldId(id, block), next)
  } catch (error) {
    port.fail(`${what} did not ${next === 'folded' ? 'fold' : 'open'}`, error)
  }
}
