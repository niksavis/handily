export type DateFormat = { source: string; pattern: RegExp; fields: Field[]; hasDate: boolean }

export type AxisFormat = { source: string; parts: AxisPart[] }

export type DurationUnit = 'ms' | 's' | 'm' | 'h' | 'd' | 'w' | 'M' | 'y'

export type Duration = { amount: number; unit: DurationUnit }

export type TickStep =
  { unit: 'fixed'; size: number; isWeek: boolean } | { unit: 'month'; size: number }

type Field =
  | 'YYYY'
  | 'M'
  | 'MM'
  | 'MMM'
  | 'MMMM'
  | 'D'
  | 'DD'
  | 'H'
  | 'HH'
  | 'h'
  | 'hh'
  | 'a'
  | 'A'
  | 'm'
  | 'mm'
  | 's'
  | 'ss'
  | 'S'
  | 'SS'
  | 'SSS'
  | 'X'
  | 'x'

type AxisPart = { text: string } | { directive: string; pad: string }

type Parts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
  isAfternoon: boolean | null
  epoch: number | null
}

const SECOND = 1000
export const MINUTE = 60 * SECOND
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR
const WEEK = 7 * DAY
const AVERAGE_MONTH = 30.44 * DAY
const EPOCH_WEEKDAY = 4
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const SHORT = 3
const FORMAT_TOKEN =
  /\[([^\]]*)\]|YYYY|YY|Q|MMMM|MMM|MM|M|Do|DDDD|DDD|DD|D|dddd|ddd|dd|d|HH|H|hh|h|kk|k|mm|m|ss|s|SSS|SS|S|A|a|X|x|ZZ|Z|ww|w|WW|W|gggg|GGGG|E|e|[\s\S]/g
const FIELD_PATTERNS: Readonly<Record<Field, string>> = {
  YYYY: String.raw`(\d{4})`,
  M: '(1[0-2]|[1-9])',
  MM: '(0[1-9]|1[0-2])',
  MMM: `(${MONTHS.map((month) => month.slice(0, SHORT)).join('|')})`,
  MMMM: `(${MONTHS.join('|')})`,
  D: String.raw`(3[01]|[12]\d|[1-9])`,
  DD: String.raw`(0[1-9]|[12]\d|3[01])`,
  H: String.raw`(2[0-3]|1\d|\d)`,
  HH: String.raw`([01]\d|2[0-3])`,
  h: '(1[0-2]|[1-9])',
  hh: '(0[1-9]|1[0-2])',
  a: '(am|pm)',
  A: '(AM|PM)',
  m: String.raw`([1-5]?\d)`,
  mm: String.raw`([0-5]\d)`,
  s: String.raw`([1-5]?\d)`,
  ss: String.raw`([0-5]\d)`,
  S: String.raw`(\d)`,
  SS: String.raw`(\d{2})`,
  SSS: String.raw`(\d{3})`,
  X: String.raw`(-?\d+(?:\.\d+)?)`,
  x: String.raw`(-?\d+)`,
}
const REFUSED_TOKENS: ReadonlySet<string> = new Set([
  'YY',
  'Q',
  'Do',
  'DDDD',
  'DDD',
  'dddd',
  'ddd',
  'dd',
  'd',
  'kk',
  'k',
  'ZZ',
  'Z',
  'ww',
  'w',
  'WW',
  'W',
  'gggg',
  'GGGG',
  'E',
  'e',
])
const DATE_FIELDS: ReadonlySet<Field> = new Set([
  'YYYY',
  'M',
  'MM',
  'MMM',
  'MMMM',
  'D',
  'DD',
  'X',
  'x',
])
const DURATION = /^(\d+(?:\.\d+)?)([Mdhmswy]|ms)$/
const FIXED_UNITS: Readonly<Partial<Record<DurationUnit, number>>> = {
  ms: 1,
  s: SECOND,
  m: MINUTE,
  h: HOUR,
  d: DAY,
  w: WEEK,
}
const CALENDAR_MONTHS: Readonly<Partial<Record<DurationUnit, number>>> = { M: 1, y: 12 }
const AXIS_TOKEN = /%([-_0]?)([\s\S])|[^%]+/g
const AXIS_SHORTHANDS: Readonly<Record<string, string>> = {
  c: '%a %b %e %H:%M:%S %Y',
  x: '%m/%d/%Y',
  X: '%H:%M:%S',
}
const AXIS_DIRECTIVES: ReadonlySet<string> = new Set('aAbBdeHIjLmMpQsSuwyY%')
const TICK_INTERVAL = /^([1-9]\d*)(millisecond|second|minute|hour|day|week|month)$/
const TICK_UNITS: Readonly<Record<string, number>> = {
  millisecond: 1,
  second: SECOND,
  minute: MINUTE,
  hour: HOUR,
  day: DAY,
  week: WEEK,
}
const FIXED_STEPS = [
  SECOND,
  5 * SECOND,
  15 * SECOND,
  30 * SECOND,
  MINUTE,
  5 * MINUTE,
  15 * MINUTE,
  30 * MINUTE,
  HOUR,
  3 * HOUR,
  6 * HOUR,
  12 * HOUR,
  DAY,
  2 * DAY,
]
const WEEK_STEPS = [1, 2]
const MONTH_STEPS = [1, 3, 6, 12, 24, 60, 120, 300, 600, 1200]
const MOST_TICKS = 400

function isField(token: string): token is Field {
  return Object.hasOwn(FIELD_PATTERNS, token)
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
}

export function dateFormatOf(source: string): DateFormat | null {
  const fields: Field[] = []
  let pattern = ''
  for (const found of source.matchAll(FORMAT_TOKEN)) {
    const token = found[0]
    if (found[1] !== undefined) pattern += escaped(found[1])
    else if (isField(token)) {
      fields.push(token)
      pattern += FIELD_PATTERNS[token]
    } else if (REFUSED_TOKENS.has(token)) return null
    else pattern += escaped(token)
  }
  return {
    source,
    pattern: new RegExp(`^${pattern}$`),
    fields,
    hasDate: fields.some((field) => DATE_FIELDS.has(field)),
  }
}

function daysIn(year: number, month: number): number {
  const date = new Date(0)
  date.setUTCFullYear(year, month, 0)
  return date.getUTCDate()
}

function utc(parts: Omit<Parts, 'isAfternoon' | 'epoch'>): number {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond)
  return date.getTime()
}

function monthIndex(name: string): number {
  return MONTHS.findIndex((month) => month === name || month.slice(0, SHORT) === name) + 1
}

function take(parts: Parts, field: Field, text: string): void {
  const number = Number(text)
  switch (field) {
    case 'YYYY':
      parts.year = number
      return
    case 'M':
    case 'MM':
      parts.month = number
      return
    case 'MMM':
    case 'MMMM':
      parts.month = monthIndex(text)
      return
    case 'D':
    case 'DD':
      parts.day = number
      return
    case 'H':
    case 'HH':
    case 'h':
    case 'hh':
      parts.hour = number
      return
    case 'a':
    case 'A':
      parts.isAfternoon = text.toLowerCase() === 'pm'
      return
    case 'm':
    case 'mm':
      parts.minute = number
      return
    case 's':
    case 'ss':
      parts.second = number
      return
    case 'S':
    case 'SS':
    case 'SSS':
      parts.millisecond = Math.round(number * 10 ** (3 - text.length))
      return
    case 'X':
      parts.epoch = Math.round(number * SECOND)
      return
    case 'x':
      parts.epoch = number
      return
  }
}

export function parsedDate(text: string, format: DateFormat): number | null {
  const found = format.pattern.exec(text)
  if (found === null) return null
  const parts: Parts = {
    year: 1970,
    month: 1,
    day: 1,
    hour: 0,
    minute: 0,
    second: 0,
    millisecond: 0,
    isAfternoon: null,
    epoch: null,
  }
  format.fields.forEach((field, at) => {
    take(parts, field, found[at + 1] ?? '')
  })
  if (parts.epoch !== null) return Number.isFinite(parts.epoch) ? parts.epoch : null
  if (parts.isAfternoon !== null && parts.hour <= 12) {
    parts.hour = (parts.hour % 12) + (parts.isAfternoon ? 12 : 0)
  }
  if (parts.day > daysIn(parts.year, parts.month)) return null
  return utc(parts)
}

export function durationOf(text: string): Duration | null {
  const found = DURATION.exec(text)
  if (found === null) return null
  return { amount: Number(found[1]), unit: found[2] as DurationUnit }
}

export function added(time: number, duration: Duration): number | null {
  const fixed = FIXED_UNITS[duration.unit]
  if (fixed !== undefined) return time + Math.round(duration.amount * fixed)
  const months = (CALENDAR_MONTHS[duration.unit] ?? 0) * duration.amount
  if (!Number.isInteger(months)) return null
  const date = new Date(time)
  const target = date.getUTCMonth() + months
  const year = date.getUTCFullYear() + Math.floor(target / 12)
  const month = (((target % 12) + 12) % 12) + 1
  const day = Math.min(date.getUTCDate(), daysIn(year, month))
  date.setUTCFullYear(year, month - 1, day)
  return date.getTime()
}

export function axisFormatOf(source: string): AxisFormat | string {
  const expanded = source.replace(
    /%([cxX])/g,
    (_found, name: string) => AXIS_SHORTHANDS[name] ?? '',
  )
  const parts: AxisPart[] = []
  for (const found of expanded.matchAll(AXIS_TOKEN)) {
    const directive = found[2]
    if (directive === undefined) parts.push({ text: found[0] })
    else if (!AXIS_DIRECTIVES.has(directive)) return `%${directive}`
    else parts.push({ directive, pad: found[1] ?? '' })
  }
  return { source, parts }
}

function padded(value: number, width: number, pad: string, fallback: string): string {
  const fill = pad === '' ? fallback : pad === '_' ? ' ' : pad === '0' ? '0' : ''
  return fill === '' ? String(value) : String(value).padStart(width, fill)
}

function dayOfYear(date: Date): number {
  return Math.floor((date.getTime() - Date.UTC(date.getUTCFullYear(), 0, 1)) / DAY) + 1
}

function directiveText(date: Date, directive: string, pad: string): string {
  const hour = date.getUTCHours()
  switch (directive) {
    case 'a':
      return (WEEKDAYS[date.getUTCDay()] ?? '').slice(0, SHORT)
    case 'A':
      return WEEKDAYS[date.getUTCDay()] ?? ''
    case 'b':
      return (MONTHS[date.getUTCMonth()] ?? '').slice(0, SHORT)
    case 'B':
      return MONTHS[date.getUTCMonth()] ?? ''
    case 'd':
      return padded(date.getUTCDate(), 2, pad, '0')
    case 'e':
      return padded(date.getUTCDate(), 2, pad, ' ')
    case 'H':
      return padded(hour, 2, pad, '0')
    case 'I':
      return padded(hour % 12 === 0 ? 12 : hour % 12, 2, pad, '0')
    case 'j':
      return padded(dayOfYear(date), 3, pad, '0')
    case 'L':
      return padded(date.getUTCMilliseconds(), 3, pad, '0')
    case 'm':
      return padded(date.getUTCMonth() + 1, 2, pad, '0')
    case 'M':
      return padded(date.getUTCMinutes(), 2, pad, '0')
    case 'p':
      return hour < 12 ? 'AM' : 'PM'
    case 'Q':
      return String(date.getTime())
    case 's':
      return String(Math.floor(date.getTime() / SECOND))
    case 'S':
      return padded(date.getUTCSeconds(), 2, pad, '0')
    case 'u':
      return String(date.getUTCDay() === 0 ? 7 : date.getUTCDay())
    case 'w':
      return String(date.getUTCDay())
    case 'y':
      return padded(date.getUTCFullYear() % 100, 2, pad, '0')
    case 'Y':
      return padded(date.getUTCFullYear(), 4, pad, '0')
    default:
      return '%'
  }
}

export function formattedTime(time: number, format: AxisFormat): string {
  const date = new Date(time)
  return format.parts
    .map((part) => ('text' in part ? part.text : directiveText(date, part.directive, part.pad)))
    .join('')
}

export function tickStepOf(text: string): TickStep | null {
  const found = TICK_INTERVAL.exec(text)
  if (found === null) return null
  const count = Number(found[1])
  const unit = found[2] ?? ''
  if (unit === 'month') return { unit: 'month', size: count }
  return { unit: 'fixed', size: count * (TICK_UNITS[unit] ?? 1), isWeek: unit === 'week' }
}

export const TICK_STEPS: readonly TickStep[] = [
  ...FIXED_STEPS.map((size): TickStep => ({ unit: 'fixed', size, isWeek: false })),
  ...WEEK_STEPS.map((weeks): TickStep => ({ unit: 'fixed', size: weeks * WEEK, isWeek: true })),
  ...MONTH_STEPS.map((size): TickStep => ({ unit: 'month', size })),
]

export function stepLength(step: TickStep): number {
  return step.unit === 'fixed' ? step.size : step.size * AVERAGE_MONTH
}

function monthStart(year: number, month: number): number {
  return new Date(0).setUTCFullYear(year, month, 1)
}

export function ticksOf(from: number, to: number, step: TickStep, weekStart: number): number[] {
  const ticks: number[] = []
  if (step.unit === 'fixed') {
    const offset = step.isWeek ? ((((weekStart - EPOCH_WEEKDAY) % 7) + 7) % 7) * DAY : 0
    for (
      let tick = Math.ceil((from - offset) / step.size) * step.size + offset;
      tick <= to && ticks.length < MOST_TICKS;
      tick += step.size
    ) {
      ticks.push(tick)
    }
    return ticks
  }
  const start = new Date(from)
  let index = start.getUTCFullYear() * 12 + start.getUTCMonth()
  index = Math.ceil(index / step.size) * step.size
  for (; ticks.length < MOST_TICKS; index += step.size) {
    const tick = monthStart(Math.floor(index / 12), index % 12)
    if (tick > to) break
    if (tick >= from) ticks.push(tick)
  }
  return ticks
}

export function weekdayIndex(name: string): number {
  return WEEKDAYS.findIndex((day) => day.toLowerCase() === name.toLowerCase())
}
