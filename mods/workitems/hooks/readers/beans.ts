import type { WorkitemsItem, WorkitemsStatus } from '../../types'
import { matchGlobs, signatureOfMatches, type GlobMatch } from '../config'
import {
  frontMatterLocated,
  ItemFault,
  optionalLabels,
  optionalText,
  parseFrontMatter,
  requiredText,
  uniqueByKey,
  type Located,
} from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'beans'
const DEFAULT_PATH = '.beans'
const BEANS_CONFIG = '.beans.yml'
const ARCHIVE_FOLDER = 'archive'
const BEAN_EXTENSION = '.md'
const STATUSES: Readonly<Record<string, WorkitemsStatus>> = {
  todo: 'open',
  'in-progress': 'in_progress',
  draft: 'other',
  completed: 'closed',
  scrapped: 'closed',
}
const PRIORITIES: Readonly<Record<string, number>> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
  deferred: 4,
}
const TOP_LEVEL_LINE = /^\S/
const BEANS_SECTION_LINE = /^beans:\s*(#.*)?$/
const PATH_LINE = /^\s+path:\s*(.*)$/

function unquoted(value: string): string {
  const text = value.replace(/\s+#.*$/, '').trim()
  const isQuoted = /^(["']).*\1$/.test(text)
  return isQuoted ? text.slice(1, -1) : text
}

export function beansPathOf(configText: string): string {
  let inBeansSection = false
  for (const line of configText.split(/\r?\n/)) {
    if (TOP_LEVEL_LINE.test(line)) inBeansSection = BEANS_SECTION_LINE.test(line)
    const path = inBeansSection ? PATH_LINE.exec(line) : null
    if (path)
      return (
        unquoted(path[1] ?? '')
          .replace(/^\.\//, '')
          .replace(/\/+$/, '') || DEFAULT_PATH
      )
  }
  return DEFAULT_PATH
}

async function beansPath(files: TrackerFiles): Promise<string> {
  if (!(await files.exists(BEANS_CONFIG))) return DEFAULT_PATH
  return beansPathOf(await files.read(BEANS_CONFIG))
}

export function beanIdOf(fileName: string): string {
  const name = fileName.slice(0, -BEAN_EXTENSION.length)
  const separators = ['--', '.', '-']
  for (const separator of separators) {
    const index = name.indexOf(separator)
    if (index > 0) return name.slice(0, index)
  }
  return name
}

function priorityOf(located: Located): number | null {
  const word = optionalText(located, 'priority')
  if (word === null) return null
  const priority = PRIORITIES[word]
  if (priority === undefined) throw new ItemFault(located.invalid('priority'))
  return priority
}

function itemOf(located: Located, fileName: string, isArchived: boolean): WorkitemsItem {
  const id = beanIdOf(fileName)
  const rawStatus = requiredText(located, 'status')
  const item: WorkitemsItem = {
    key: `${SOURCE}:${id}`,
    id,
    title: requiredText(located, 'title'),
    status: isArchived ? 'closed' : (STATUSES[rawStatus] ?? 'other'),
    rawStatus,
    priority: priorityOf(located),
    type: optionalText(located, 'type'),
    assignee: null,
    updatedAt: optionalText(located, 'updated_at'),
    source: SOURCE,
  }
  const labels = optionalLabels(located, 'tags')
  if (labels) item.labels = labels
  const parent = optionalText(located, 'parent')
  if (parent !== null) item.parent = parent
  return item
}

async function beanFiles(files: TrackerFiles): Promise<{ root: string; matches: GlobMatch[] }> {
  const root = await beansPath(files)
  return { root, matches: await matchGlobs(files, [`${root}/**/*${BEAN_EXTENSION}`]) }
}

async function readBeans(files: TrackerFiles): Promise<ReadOutcome> {
  try {
    const { root, matches } = await beanFiles(files)
    const found: { item: WorkitemsItem; path: string }[] = []
    for (const match of matches) {
      const relative = match.path.slice(root.length + 1)
      const fileName = relative.slice(relative.lastIndexOf('/') + 1)
      const isArchived = relative.startsWith(`${ARCHIVE_FOLDER}/`)
      const located = frontMatterLocated(
        match.path,
        parseFrontMatter(match.path, await files.read(match.path)),
      )
      found.push({ item: itemOf(located, fileName, isArchived), path: match.path })
    }
    return { ok: true, items: uniqueByKey(found), sourceLabel: SOURCE, caveat: null }
  } catch (error) {
    if (error instanceof ItemFault) return { ok: false, reason: error.reason }
    throw error
  }
}

async function isPresent(files: TrackerFiles): Promise<boolean> {
  return (await files.exists(BEANS_CONFIG)) || files.exists(DEFAULT_PATH)
}

async function beansSignature(files: TrackerFiles): Promise<string> {
  const { root, matches } = await beanFiles(files)
  return [root, signatureOfMatches(matches)].join('\n')
}

export const beansReader: Reader = {
  name: SOURCE,
  marker: DEFAULT_PATH,
  isPresent,
  signature: beansSignature,
  read: readBeans,
}
