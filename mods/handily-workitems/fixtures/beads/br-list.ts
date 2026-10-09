export type ListedIssue = {
  id: string
  title: string
  status: string
  priority: number
  issue_type: string
  updated_at: string
  assignee?: string
  labels?: string[]
  description?: string
  defer_until?: string
  dependency_count?: number
  dependent_count?: number
}

type Page = { total?: unknown; has_more?: unknown }

export function brList(issues: readonly ListedIssue[], page: Page = {}): string {
  return JSON.stringify({
    issues: issues.map((issue) => ({
      created_at: '2026-10-09T13:43:58.379047327Z',
      created_by: 'dev-one',
      source_repo: '.',
      compaction_level: 0,
      original_size: 0,
      dependency_count: 0,
      dependent_count: 0,
      ...issue,
    })),
    total: issues.length,
    limit: 0,
    offset: 0,
    has_more: false,
    ...page,
  })
}

export const CHILD_ONE: ListedIssue = {
  id: 'app-1fm',
  title: 'Child one',
  status: 'open',
  priority: 2,
  issue_type: 'task',
  assignee: 'dev-one',
  updated_at: '2026-10-09T13:44:00.506674453Z',
  labels: ['ui'],
  dependency_count: 1,
}

export const OPEN_ISSUES: readonly ListedIssue[] = [
  CHILD_ONE,
  {
    id: 'app-1q2',
    title: 'Deferred one',
    status: 'deferred',
    priority: 3,
    issue_type: 'task',
    updated_at: '2026-10-09T13:43:59.477518194Z',
    defer_until: '2027-01-01T08:00:00Z',
  },
  {
    id: 'app-w4y',
    title: 'Blocked one',
    status: 'blocked',
    priority: 1,
    issue_type: 'bug',
    updated_at: '2026-10-09T13:43:59.123046797Z',
  },
  {
    id: 'app-red',
    title: 'Second in progress',
    status: 'in_progress',
    priority: 0,
    issue_type: 'task',
    updated_at: '2026-10-09T13:43:58.744112941Z',
    dependent_count: 1,
  },
  {
    id: 'app-tww',
    title: 'Draft one',
    status: 'draft',
    priority: 4,
    issue_type: 'chore',
    updated_at: '2026-10-09T13:44:31.315625895Z',
    description: 'A long description text',
  },
  {
    id: 'app-wqe',
    title: 'First open',
    status: 'open',
    priority: 2,
    issue_type: 'feature',
    updated_at: '2026-10-09T13:43:58.379047327Z',
  },
]

export const BR_LIST_OPEN = brList(OPEN_ISSUES)
