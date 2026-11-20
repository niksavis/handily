import type { AgentInfo, AgentStatus } from 'claude-code'

const TASK_STATUSES: Readonly<Record<AgentStatus, AgentInfo['taskStatus']>> = {
  pending: 'pending',
  running: 'running',
  waiting: 'running',
  idle: 'running',
  completed: 'completed',
  failed: 'failed',
  killed: 'killed',
}

export type AgentFields = Pick<AgentInfo, 'id' | 'type' | 'status' | 'description'> &
  Partial<AgentInfo>

export function agentInfo(fields: AgentFields): AgentInfo {
  return {
    kind: 'local_agent',
    taskStatus: TASK_STATUSES[fields.status],
    label: fields.description,
    startTime: 0,
    cwd: '/work',
    tokenCount: 0,
    tokenSamples: [],
    hasRow: true,
    ...fields,
  }
}
