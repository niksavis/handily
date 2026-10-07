type ListedRecord = {
  record: string
  status: string
  tombstoned: boolean
  fields: Record<string, unknown>
  dates: Record<string, string | null>
}

function listed(records: readonly ListedRecord[]): string {
  return JSON.stringify(
    {
      count: records.length,
      records: records.map((record) => ({
        artifacts: {},
        checkpoints: {},
        comments: [],
        contested: [],
        dependencies: [],
        max_seq: 2,
        totals: { attempts: 0, events: 2, spend_micros: 0, status: record.status },
        ...record,
      })),
      schema: 'basicly.tracker.list.v1',
    },
    null,
    2,
  )
}

export const LIST_OPEN = listed([
  {
    record: 'app-3o75',
    status: 'open',
    tombstoned: false,
    fields: {
      title: 'Add the export button',
      priority: 2,
      issue_type: 'feature',
      assignee: 'dev-one',
      shaped_under: 'dor.v2',
    },
    dates: {
      assigned: null,
      closed: null,
      created: '2026-10-01T09:00:00.000000Z',
      updated: '2026-10-02T10:30:00.000000Z',
    },
  },
  {
    record: 'app-e2k7',
    status: 'open',
    tombstoned: true,
    fields: { title: 'Drop the old importer', priority: 4, issue_type: 'task' },
    dates: {
      assigned: null,
      closed: null,
      created: '2026-10-01T09:00:00.000000Z',
      updated: '2026-10-03T08:15:00.000000Z',
    },
  },
])

export const LIST_IN_PROGRESS = listed([
  {
    record: 'app-ngri',
    status: 'in_progress',
    tombstoned: false,
    fields: { title: 'Fix the date parser', priority: 1, issue_type: 'bug', assignee: null },
    dates: {
      assigned: '2026-10-02T11:00:00.000000Z',
      closed: null,
      created: '2026-10-01T09:05:00.000000Z',
      updated: '2026-10-02T11:00:00.000000Z',
    },
  },
])

export const LIST_BLOCKED = listed([
  {
    record: 'app-f0fo',
    status: 'blocked',
    tombstoned: false,
    fields: { title: 'Wait for the design review', priority: 3, issue_type: 'task' },
    dates: {
      assigned: null,
      closed: null,
      created: '2026-10-01T09:10:00.000000Z',
      updated: '2026-10-04T12:00:00.000000Z',
    },
  },
])
