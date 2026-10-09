type TrackerItem = {
  id: string
  title: string
  status: string
  rawStatus: string
  priority: number | null
  type: string | null
  assignee: string | null
  updatedAt: string | null
  source: 'basicly'
}

export function printedItems(items: readonly TrackerItem[]): string {
  return JSON.stringify(items)
}

export const ITEM_OPEN: TrackerItem = {
  id: 'app-3o75',
  title: 'Add the export button',
  status: 'open',
  rawStatus: 'open',
  priority: 2,
  type: 'feature',
  assignee: 'dev-one',
  updatedAt: '2026-10-02T10:30:00.000000Z',
  source: 'basicly',
}

export const ITEM_IN_PROGRESS: TrackerItem = {
  id: 'app-ngri',
  title: 'Fix the date parser',
  status: 'in_progress',
  rawStatus: 'in_progress',
  priority: 1,
  type: 'bug',
  assignee: null,
  updatedAt: '2026-10-02T11:00:00.000000Z',
  source: 'basicly',
}

export const ITEM_BLOCKED: TrackerItem = {
  id: 'app-f0fo',
  title: 'Wait for the design review',
  status: 'blocked',
  rawStatus: 'blocked',
  priority: 3,
  type: 'task',
  assignee: null,
  updatedAt: '2026-10-04T12:00:00.000000Z',
  source: 'basicly',
}

export const OPEN_ITEMS = printedItems([ITEM_OPEN, ITEM_IN_PROGRESS, ITEM_BLOCKED])
