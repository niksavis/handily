import type { Reader } from './readers/index'

export type Detection =
  | { found: true; reader: Reader; ignored: string[] }
  | { found: false; lookedFor: `looked for ${string}` }

export async function detect(
  readers: readonly Reader[],
  existsAtRoot: (relativePath: string) => Promise<boolean>,
): Promise<Detection> {
  const present: Reader[] = []
  for (const reader of readers) {
    if (await existsAtRoot(reader.marker)) present.push(reader)
  }
  const [chosen, ...others] = present
  if (!chosen) {
    return { found: false, lookedFor: `looked for ${readers.map((r) => r.name).join(', ')}` }
  }
  return { found: true, reader: chosen, ignored: others.map((reader) => reader.name) }
}
