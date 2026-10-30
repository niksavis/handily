function fieldOf(value: unknown, field: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if (!Object.hasOwn(value, field)) return undefined
  return (value as Record<string, unknown>)[field]
}

export function storedOptionOf(pluginConfigs: unknown, rowPluginId: string, option: string) {
  return fieldOf(fieldOf(fieldOf(pluginConfigs, rowPluginId), 'options'), option)
}
