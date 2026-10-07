export type QuietItemsMode = 'on' | 'off'

export type QuietItemsVerb = 'created' | 'updated' | 'commented' | 'closed'

export type QuietItemsItemRow = {
  kind: 'item'
  verb: QuietItemsVerb
  id: string
  title: string
  status: string
  priority: number | null
}

export type QuietItemsRawEditRow = {
  kind: 'raw-edit'
  path: string
  tool: 'Write' | 'Edit'
}

export type QuietItemsRow = QuietItemsItemRow | QuietItemsRawEditRow

declare module 'claude-code' {
  interface PluginState {
    'quiet-items': {
      mode: QuietItemsMode
      rows: StateFamily<readonly QuietItemsRow[]>
    }
  }
}
