const THOUSAND = 1_000
const MILLION = 1_000_000
const ONE_DECIMAL_BELOW = 10

function withOneDecimal(value: number): string {
  const text = value.toFixed(1)
  return text.endsWith('.0') ? text.slice(0, -2) : text
}

function scaled(count: number, unit: number): number {
  const value = count / unit
  return value < ONE_DECIMAL_BELOW ? Number(withOneDecimal(value)) : Math.round(value)
}

export function tokensText(count: number): string {
  const whole = Math.max(Math.round(count), 0)
  if (whole < THOUSAND) return String(whole)
  const thousands = scaled(whole, THOUSAND)
  if (thousands < THOUSAND) return `${String(thousands)}k`
  return `${String(scaled(whole, MILLION))}M`
}
