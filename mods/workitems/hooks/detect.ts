import type { WorkitemsFailedReason } from '../types'
import { CONFIG_FILE, readConfig } from './config'
import type { Reader, TrackerFiles } from './readers/index'

export type Detection =
  | { found: true; reader: Reader; ignored: string[] }
  | { found: false; lookedFor: `looked for ${string}` }

function configProblem(reason: WorkitemsFailedReason): Detection {
  return {
    found: true,
    reader: {
      name: CONFIG_FILE,
      marker: CONFIG_FILE,
      read: () => Promise.resolve({ ok: false, reason }),
    },
    ignored: [],
  }
}

async function isPresent(reader: Reader, files: TrackerFiles): Promise<boolean> {
  return reader.isPresent ? reader.isPresent(files) : files.exists(reader.marker)
}

export async function detect(readers: readonly Reader[], files: TrackerFiles): Promise<Detection> {
  const config = await readConfig(files)
  if (!config.ok) return configProblem(config.reason)
  const present: Reader[] = []
  for (const reader of readers) {
    if (await isPresent(reader, files)) present.push(reader)
  }
  const named = config.config.source
  const chosen = named === null ? present[0] : readers.find((reader) => reader.name === named)
  if (named !== null && !chosen) {
    return configProblem(
      `${CONFIG_FILE} names the source ${named}, which is not one of ${readers.map((r) => r.name).join(', ')}, so it could not be read.`,
    )
  }
  if (!chosen) {
    return {
      found: false,
      lookedFor: `looked for ${readers.map((r) => r.lookedForAs ?? r.name).join(', ')}`,
    }
  }
  return {
    found: true,
    reader: chosen,
    ignored: present.filter((reader) => reader !== chosen).map((reader) => reader.name),
  }
}
