import type { UiScrollResult } from 'claude-code'
import type { ReplyViewFold } from '../types'

export type FoldPort = {
  scroll: (requestId: string) => Promise<UiScrollResult>
  keep: (id: string, next: ReplyViewFold) => Promise<void>
  log: (text: string) => void
  fail: (what: string, error: unknown) => void
}

export function foldId(id: string, block: string | undefined): string {
  return block === undefined ? id : `${id}#${block}`
}

async function keepInView(port: FoldPort, id: string): Promise<void> {
  const what = `reply ${id} was not kept in view`
  try {
    const { deny } = await port.scroll(id)
    if (deny !== undefined) port.log(`reply-view: ${what}: ${deny}`)
  } catch (error) {
    port.fail(what, error)
  }
}

export async function pressFold(
  port: FoldPort,
  id: string,
  next: ReplyViewFold,
  block?: string,
): Promise<void> {
  const what = block === undefined ? 'the reply' : 'the code block'
  const isKept = block === undefined && next === 'open'
  const kept = isKept ? keepInView(port, id) : Promise.resolve()
  try {
    await port.keep(foldId(id, block), next)
  } catch (error) {
    port.fail(`${what} did not ${next === 'folded' ? 'fold' : 'open'}`, error)
  }
  await kept
}
