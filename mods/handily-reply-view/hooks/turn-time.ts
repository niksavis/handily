import type { EngineInterface } from 'claude-code'

type Preset = 'auto' | '12-hour' | '24-hour' | '24-hour-utc'

type Span = 'today' | 'week' | 'older'

export type TimeFormat = {
  locale: string | undefined
  preset: Preset
  timeZone: string | undefined
}

const PRESETS: readonly Preset[] = ['auto', '12-hour', '24-hour', '24-hour-utc']
const UTC_PRESET: Preset = '24-hour-utc'
const UTC_ZONE = 'UTC'
const UTC_MARK = 'Z'
const PATTERN_MARK = '%'
const UNNAMED_LOCALES: readonly string[] = ['C', 'POSIX']
const LOCALE_LENGTH_AT_MOST = 64
const DAY_MS = 86_400_000
const WEEK_DAYS = 7
const CALENDAR_DAY: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}
const SPAN_PARTS: Readonly<Record<Span, Intl.DateTimeFormatOptions>> = {
  today: { hour: 'numeric', minute: '2-digit' },
  week: { weekday: 'long', hour: 'numeric', minute: '2-digit' },
  older: { weekday: 'long', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
}
const HOUR_CYCLES: Readonly<Record<Preset, Intl.DateTimeFormatOptions>> = {
  auto: {},
  '12-hour': { hourCycle: 'h12' },
  '24-hour': { hourCycle: 'h23' },
  '24-hour-utc': { hourCycle: 'h23' },
}

function isPreset(value: unknown): value is Preset {
  return PRESETS.some((preset) => preset === value)
}

function localeOf(value: string | undefined): string | undefined {
  if (value === undefined || UNNAMED_LOCALES.includes(value)) return undefined
  if (value.length > LOCALE_LENGTH_AT_MOST) return undefined
  const [named = ''] = value.split('.')
  const [tag = ''] = named.split('@')
  if (tag === '') return undefined
  const locale = tag.replaceAll('_', '-')
  try {
    Intl.getCanonicalLocales(locale)
    return locale
  } catch {
    return undefined
  }
}

function timeZoneOf(value: unknown): string | undefined {
  if (typeof value !== 'string' || value === '') return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0)
    return value
  } catch {
    return undefined
  }
}

function presetOf(value: unknown): Preset | undefined {
  if (value === undefined) return 'auto'
  if (isPreset(value)) return value
  if (typeof value !== 'string' || value.includes(PATTERN_MARK)) return undefined
  return 'auto'
}

export async function timeFormatOf($: EngineInterface): Promise<TimeFormat | undefined> {
  const preset = presetOf(await $.settings.read({ key: 'timeFormat' }))
  if (preset === undefined) return undefined
  const named = [await $.env.get('LC_ALL'), await $.env.get('LC_TIME'), await $.env.get('LANG')]
  const timeZone =
    preset === UTC_PRESET ? UTC_ZONE : timeZoneOf(await $.settings.read({ key: 'timeZone' }))
  return {
    locale: localeOf(named.find((value) => value !== undefined && value !== '')),
    preset,
    timeZone,
  }
}

function calendarDayOf(at: number, timeZone: string | undefined): number {
  if (timeZone === undefined) {
    const date = new Date(at)
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  }
  const parts = new Intl.DateTimeFormat('en-US', { ...CALENDAR_DAY, timeZone }).formatToParts(at)
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((found) => found.type === type)?.value)
  return Date.UTC(part('year'), part('month') - 1, part('day'))
}

function spanOf(endedAt: number, now: number, timeZone: string | undefined): Span {
  const days = Math.round(
    (calendarDayOf(now, timeZone) - calendarDayOf(endedAt, timeZone)) / DAY_MS,
  )
  if (days === 0) return 'today'
  return days > 0 && days < WEEK_DAYS ? 'week' : 'older'
}

export function endTimeText(endedAt: number, now: number, format: TimeFormat): string {
  const { locale, preset, timeZone } = format
  const formatter = new Intl.DateTimeFormat(locale, {
    ...SPAN_PARTS[spanOf(endedAt, now, timeZone)],
    ...HOUR_CYCLES[preset],
    ...(timeZone === undefined ? {} : { timeZone }),
  })
  if (preset !== UTC_PRESET) return formatter.format(endedAt)
  const parts = formatter.formatToParts(endedAt)
  const last = parts.findLastIndex((part) => part.type === 'minute' || part.type === 'second')
  return parts
    .map((part, index) => (index === last ? `${part.value}${UTC_MARK}` : part.value))
    .join('')
}
