'use client'

import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { inr, niceDate, num } from '@/lib/format'
import type { DailyPoint, SkuSummary } from '@/lib/types'

export function Kpi({ label, value, sub, tone, action }: {
  label: string; value: string; sub?: string; tone?: 'warn' | 'ok'; action?: React.ReactNode
}) {
  return (
    <div className="card p-3">
      <div className="text-xs font-medium text-stone-500">{label}</div>
      <div className={`mt-0.5 text-xl font-bold ${tone === 'warn' ? 'text-amber-700' : tone === 'ok' ? 'text-green-700' : ''}`}>{value}</div>
      {sub && <div className="text-xs text-stone-500">{sub}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )
}

export function Section({ title, right, children, className = '' }: {
  title: string; right?: React.ReactNode; children: React.ReactNode; className?: string
}) {
  return (
    <section className={`card flex flex-col overflow-hidden ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
        <h2 className="text-sm font-semibold">{title}</h2>
        {right}
      </div>
      {children}
    </section>
  )
}

/** 0 and four evenly spaced round steps (1/2/2.5/5 × 10^n) that cover max. */
function niceTicks(max: number): number[] {
  if (!(max > 0)) return [0, 1, 2, 3, 4]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag
  return [0, 1, 2, 3, 4].map((i) => i * step)
}

function shortValue(v: number, money: boolean): string {
  const n = v >= 1000 ? `${(v / 1000).toLocaleString('en-IN', { maximumFractionDigits: 1 })}k` : String(v)
  return money ? `₹${n}` : n
}

export function DailyChart({ data, metric = 'sales_value' }: { data: DailyPoint[]; metric?: 'sales_value' | 'pieces' }) {
  const rows = data.map((d) => ({ ...d, label: niceDate(d.report_date, { day: 'numeric' }), v: Number(d[metric]) }))
  const ticks = niceTicks(Math.max(0, ...rows.map((r) => r.v)))
  return (
    <div className="h-72 w-full shrink-0 px-2 py-3">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#e7e5e4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} interval="preserveStartEnd" />
          <YAxis
            tickLine={false} axisLine={false} fontSize={11} width={52}
            domain={[0, ticks[ticks.length - 1]]} ticks={ticks} interval={0}
            tickFormatter={(v) => shortValue(Number(v), metric === 'sales_value')}
          />
          <Tooltip
            cursor={{ fill: '#fff7ed' }}
            formatter={(v) => [metric === 'sales_value' ? inr(Number(v)) : num(Number(v)), metric === 'sales_value' ? 'Sales' : 'Pieces']}
            labelFormatter={(_, p) => (p?.[0] ? niceDate((p[0].payload as DailyPoint).report_date, { weekday: 'short', day: 'numeric', month: 'short' }) : '')}
          />
          <Bar dataKey="v" fill="#ea580c" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

// Spice-like colours, distinct in lightness as well as hue; last one is "Others"
const PRODUCT_COLORS = ['#c2410c', '#eab308', '#65a30d', '#b91c1c', '#78350f', '#d6d3d1']

export function ProductPieChart({ data }: { data: Pick<SkuSummary, 'product_name' | 'pieces'>[] }) {
  const totals = data.reduce((products, row) => {
    const pieces = Number(row.pieces)
    if (pieces > 0) products.set(row.product_name, (products.get(row.product_name) ?? 0) + pieces)
    return products
  }, new Map<string, number>())
  const sorted = [...totals].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
  const others = sorted.slice(5).reduce((sum, row) => sum + row.value, 0)
  const rows = others ? [...sorted.slice(0, 5), { name: `Others (${sorted.length - 5})`, value: others }] : sorted
  const total = rows.reduce((sum, row) => sum + row.value, 0)

  if (!total) return <Empty>No product sales</Empty>

  return (
    <div className="flex flex-1 flex-wrap items-center gap-4 p-4">
      <div className="relative mx-auto h-40 w-40 shrink-0">
        <ResponsiveContainer>
          <PieChart>
            <Pie
              data={rows} dataKey="value" nameKey="name" cx="50%" cy="50%"
              innerRadius="62%" outerRadius="100%" startAngle={90} endAngle={-270}
              paddingAngle={rows.length > 1 ? 1 : 0} stroke="none" isAnimationActive={false}
            >
              {rows.map((row, index) => (
                <Cell key={row.name} fill={PRODUCT_COLORS[index % PRODUCT_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                const row = payload?.[0]?.payload as { name?: string; value?: number } | undefined
                if (!active || !row?.name || row.value === undefined) return null
                return (
                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm shadow-lg">
                    <p className="font-semibold">{row.name}</p>
                    <p className="text-stone-600">{num(row.value)} packets · {((row.value / total) * 100).toFixed(1)}%</p>
                  </div>
                )
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-bold leading-tight">{num(total)}</span>
          <span className="text-xs text-stone-500">packets</span>
        </div>
      </div>
      <ul className="min-w-40 flex-1 space-y-1.5 text-sm">
        {rows.map((row, index) => (
          <li key={row.name} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PRODUCT_COLORS[index % PRODUCT_COLORS.length] }} />
            <span className="min-w-0 flex-1 truncate">{row.name}</span>
            <span className="tabular-nums text-stone-500">{((row.value / total) * 100).toFixed(0)}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="p-6 text-center text-sm text-stone-400">{children}</p>
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null
  return <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{text}</p>
}