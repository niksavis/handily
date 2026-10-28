import { MAIN_AGENT } from './touches'

export const MAIN_LABEL = 'main'

const ID_CHARS = 8
const ALL_VALUE = 'all'
const MAIN_VALUE = 'main'
const AGENT_VALUE = 'agent:'

export type KnownAgent = {
  id: string
  name: string | null
  type: string | null
  label?: string
}

function baseLabel(agent: KnownAgent): string {
  if (agent.label !== undefined && agent.label !== '') return agent.label
  return agent.name ?? agent.type ?? agent.id.slice(0, ID_CHARS)
}

export function labelsOf(known: readonly KnownAgent[] | undefined): (agent: string) => string {
  const byId = new Map((known ?? []).map((agent) => [agent.id, baseLabel(agent)]))
  return (agent) => {
    if (agent === MAIN_AGENT) return MAIN_LABEL
    return byId.get(agent) ?? agent.slice(0, ID_CHARS)
  }
}

export function filterValue(agent: string | undefined): string {
  if (agent === undefined) return ALL_VALUE
  return agent === MAIN_AGENT ? MAIN_VALUE : `${AGENT_VALUE}${agent}`
}

export function agentOfFilter(value: string): string | undefined {
  if (value === MAIN_VALUE) return MAIN_AGENT
  return value.startsWith(AGENT_VALUE) ? value.slice(AGENT_VALUE.length) : undefined
}
