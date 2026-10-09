import type {
  WorkitemsLine,
  WorkitemsLinesArgs,
  WorkitemsSnapshotBase,
  WorkitemsSourced,
} from '../types'

const SECOND_MS = 1000
const MINUTE_MS = 60 * SECOND_MS
const HOUR_MS = 60 * MINUTE_MS

export function numeral(value: number): `${number}` {
  return value.toString() as `${number}`
}

export function ageText(elapsedMs: number): string {
  const elapsed = Math.max(0, elapsedMs)
  if (elapsed < MINUTE_MS) return `${numeral(Math.floor(elapsed / SECOND_MS))} s`
  if (elapsed < HOUR_MS) return `${numeral(Math.floor(elapsed / MINUTE_MS))} min`
  return `${numeral(Math.floor(elapsed / HOUR_MS))} h`
}

function headerLines(
  snapshot: WorkitemsSnapshotBase & WorkitemsSourced,
  now: number,
): WorkitemsLine[] {
  const label = snapshot.sourceLabel
  const open = numeral(snapshot.items.filter((item) => item.status !== 'closed').length)
  const age = ageText(now - snapshot.checkedAt)
  const header: WorkitemsLine =
    snapshot.caveat === null
      ? { kind: 'header', tone: 'dim', text: `${label} · ${open} open · read ${age} ago` }
      : {
          kind: 'header',
          tone: 'dim',
          text: `${label} · ${open} open · read ${age} ago · may be stale: ${snapshot.caveat}`,
        }
  if (snapshot.ignored.length === 0) return [header]
  return [
    header,
    {
      kind: 'ignored',
      tone: 'dim',
      text: `Using ${snapshot.source}; ignoring ${snapshot.ignored.join(', ')}. Name one in .handily.json to change it.`,
    },
  ]
}

export function stateLines({ snapshot, now }: WorkitemsLinesArgs): WorkitemsLine[] {
  switch (snapshot.state) {
    case 'ok':
      return headerLines(snapshot, now)
    case 'failed':
      return [{ kind: 'failed', tone: 'error', text: `Work items unavailable: ${snapshot.reason}` }]
    case 'stale':
      return [
        {
          kind: 'stale',
          tone: 'warning',
          text: `Work items may be out of date: last good read ${ageText(now - snapshot.at)} ago (${snapshot.reason}).`,
        },
      ]
    case 'approval-needed':
      return [
        {
          kind: 'approval-needed',
          tone: 'warning',
          text: `Work items need your approval to run ${snapshot.reason}.`,
        },
        {
          kind: 'approval-hint',
          tone: 'dim',
          text: 'Asked at the next refresh in an interactive session.',
        },
      ]
    case 'no-tracker':
      return [
        {
          kind: 'no-tracker',
          tone: 'dim',
          text: `No tracker found at the repo root (${snapshot.reason}).`,
        },
      ]
    case 'terminal-only':
      return [
        {
          kind: 'terminal-only',
          tone: 'dim',
          text: `${snapshot.sourceLabel} is read through a CLI, which only a terminal session can run. Open this repo in a terminal to see its items.`,
        },
      ]
  }
}
