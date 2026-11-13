const TZ = 'Asia/Kolkata'

/** YYYY-MM-DD in India time */
export function todayIST(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
}

export function hourIST(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' }).format(new Date()))
}

export function monthStart(date: string): string {
  return date.slice(0, 8) + '01'
}

export function monthEnd(date: string): string {
  const [y, m] = date.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${date.slice(0, 8)}${String(last).padStart(2, '0')}`
}

export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function inr(n: number | null | undefined, decimals = 0): string {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

export function num(n: number | null | undefined): string {
  return Number(n ?? 0).toLocaleString('en-IN')
}

export function pct(n: number | null | undefined): string {
  return (Number(n ?? 0) * 100).toFixed(1) + '%'
}

export function niceDate(date: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }): string {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-IN', opts)
}

export function niceTime(ts: string): string {
  return new Date(ts).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
}

/** '9876543210' or '+91 98765 43210' → '919876543210' (Supabase storage format) */
export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '')
  if (/^[6-9]\d{9}$/.test(digits)) return '91' + digits
  if (/^91[6-9]\d{9}$/.test(digits)) return digits
  return null
}

export function displayPhone(p: string | null): string {
  if (!p) return '—'
  return p.startsWith('91') && p.length === 12 ? `+91 ${p.slice(2, 7)} ${p.slice(7)}` : p
}

export function errMsg(e: unknown): string {
  if (!e) return 'Something went wrong'
  if (typeof e === 'string') return e
  const m = (e as { message?: string }).message ?? 'Something went wrong'
  if (m.includes('row-level security')) return 'Not allowed — this day is locked or outside your access.'
  return m
}
