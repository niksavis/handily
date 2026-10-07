import type { WorkitemsItem, WorkitemsStatus } from '../../types'
import { matchGlobs, signatureOfMatches, type GlobMatch } from '../config'
import {
  frontMatterLocated,
  ItemFault,
  optionalLabels,
  optionalText,
  parseFrontMatter,
  readItemFiles,
  requiredText,
  skippedCaveat,
  uniqueByKey,
  type Located,
} from './generic'
import type { ReadOutcome, Reader, TrackerFiles } from './index'

const SOURCE = 'beans'
const DEFAULT_PATH = '.beans'
const BEANS_CONFIG = '.beans.yml'
const ARCHIVE_FOLDER = 'archive'
const BEAN_EXTENSION = '.md'
const SLUG_SEPARATOR = '--'
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
    const value = path ? unquoted(path[1] ?? '') : ''
    if (value !== '') return folderSegments(value).join('/')
  }
  return DEFAULT_PATH
}

function folderSegments(path: string): string[] {
  return path.split('/').filter((segment) => segment !== '' && segment !== '.')
}

async function beansPath(files: TrackerFiles): Promise<string> {
  if (!(await files.exists(BEANS_CONFIG))) return DEFAULT_PATH
  return beansPathOf(await files.read(BEANS_CONFIG))
}

export function beanIdOf(fileName: string): string {
  const name = fileName.slice(0, -BEAN_EXTENSION.length)
  const slugStart = name.indexOf(SLUG_SEPARATOR)
  return slugStart > 0 ? name.slice(0, slugStart) : name
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
  const glob = [root, '**', `*${BEAN_EXTENSION}`].filter((part) => part !== '').join('/')
  return { root, matches: await matchGlobs(files, [glob]) }
}

function beanOf(root: string, path: string, text: string): WorkitemsItem {
  const relative = root === '' ? path : path.slice(root.length + 1)
  const fileName = relative.slice(relative.lastIndexOf('/') + 1)
  const isArchived = relative.startsWith(`${ARCHIVE_FOLDER}/`)
  return itemOf(frontMatterLocated(path, parseFrontMatter(path, text)), fileName, isArchived)
}

async function readBeans(files: TrackerFiles): Promise<ReadOutcome> {
  try {
    const { root, matches } = await beanFiles(files)
    const paths = matches.map((match) => match.path)
    const { found, skipped } = await readItemFiles(files, paths, (path, text) =>
      beanOf(root, path, text),
    )
    return {
      ok: true,
      items: uniqueByKey(found),
      sourceLabel: SOURCE,
      caveat: skippedCaveat(skipped),
    }
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
