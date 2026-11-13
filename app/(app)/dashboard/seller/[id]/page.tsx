'use client'

import Link from 'next/link'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { Empty, ErrorNote, Kpi, Section } from '@/components/ui'
import { loadPrices, loadSkus, priceOn } from '@/lib/data'
import { downloadXlsx } from '@/lib/excel'
import { supabase } from '@/lib/supabase/client'
import { displayPhone, errMsg, inr, monthEnd, monthStart, niceDate, niceTime, num, todayIST } from '@/lib/format'
import { PACK_LABEL, type DailyTotal, type Profile, type SellerSummary, type Sku, type SkuPrice } from '@/lib/types'

export default function SellerPage() {
  return <Suspense><SellerDetail /></Suspense>
}

interface GridLine { sku_code: string; day: number; quantity: number }

function SellerDetail() {
  const { id } = useParams<{ id: string }>()
  const params = useSearchParams()
  const router = useRouter()
  const today = todayIST()
  const [month, setMonth] = useState(params.get('month') ?? today.slice(0, 7))

  const [seller, setSeller] = useState<Profile | null>(null)
  const [skus, setSkus] = useState<Sku[]>([])
  const [prices, setPrices] = useState<SkuPrice[]>([])
  const [grid, setGrid] = useState<GridLine[]>([])
  const [days, setDays] = useState<DailyTotal[]>([])
  const [summary, setSummary] = useState<SellerSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const first = monthStart(month + '-01')
  const last = monthEnd(month + '-01')
  const nDays = Number(last.slice(8))

  useEffect(() => {
    Promise.all([loadSkus(true), loadPrices()]).then(([s, p]) => { setSkus(s); setPrices(p) }).catch((e) => setError(errMsg(e)))
    supabase().from('profiles').select('*, regions(name)').eq('id', id).maybeSingle()
      .then(({ data, error }) => error ? setError(errMsg(error)) : setSeller(data as Profile | null))
  }, [id])

  useEffect(() => {
    router.replace(`/dashboard/seller/${id}?month=${month}`, { scroll: false })
    const sb = supabase()
    const to = last > today ? today : last
    Promise.all([
      sb.rpc('report_seller_month_grid', { p_seller: id, p_month: first }),
      sb.from('v_daily_seller_totals').select('*').eq('seller_id', id).gte('report_date', first).lte('report_date', last),
      sb.rpc('report_seller_summary', { p_from: first, p_to: to, p_seller: id }),
    ]).then(([g, d, s]) => {
      const err = g.error || d.error || s.error
      if (err) return setError(errMsg(err))
      setGrid(g.data as GridLine[])
      setDays(d.data as DailyTotal[])
      setSummary((s.data as SellerSummary[])[0] ?? null)
    })
  }, [id, month, first, last, today, router])

  const cell = useMemo(() => {
    const m = new Map<string, number>()
    for (const g of grid) m.set(`${g.sku_code}|${g.day}`, g.quantity)
    return m
  }, [grid])
  const dayInfo = useMemo(() => new Map(days.map((d) => [Number(d.report_date.slice(8)), d])), [days])
  const dayNums = Array.from({ length: nDays }, (_, i) => i + 1)

  // only show SKUs that are active or were sold this month
  const rows = skus.filter((s) => s.is_active || grid.some((g) => g.sku_code === s.code))

  async function exportDsr() {
    if (!seller) return
    const header = ['Product / SKU', 'Product Code', 'Size', 'MRP', 'Retailer Basic Cost', ...dayNums.map(String), 'Pouches Total', 'Value of Sales']
    const body = rows.map((s) => {
      const p = priceOn(prices, s.id, last)
      const q = dayNums.map((d) => cell.get(`${s.code}|${d}`) ?? 0)
      const total = q.reduce((a, b) => a + b, 0)
      const value = grid.filter((g) => g.sku_code === s.code)
        .reduce((a, g) => a + Math.round(g.quantity * (priceOn(prices, s.id, `${month}-${String(g.day).padStart(2, '0')}`)?.retailer_basic_cost ?? 0) * 100) / 100, 0)
      return [s.product.name, s.code, PACK_LABEL[s.pack_size], p?.mrp ?? null, p?.retailer_basic_cost ?? null, ...q, total, Math.round(value * 100) / 100]
    })
    const dayTotals = dayNums.map((d) => Number(dayInfo.get(d)?.pieces ?? 0))
    body.push(['TOTAL', '', '', null, null, ...dayTotals, dayTotals.reduce((a, b) => a + b, 0), Number(summary?.sales_value ?? 0)])
    await downloadXlsx(`DSR_${seller.full_name.replace(/\s+/g, '_')}_${month}.xlsx`, [{
      name: `DSR ${seller.full_name}`,
      title: `DrKitchen | ${seller.regions?.name ?? ''} Daily Sales — ${seller.full_name} — ${niceDate(first, { month: 'long', year: 'numeric' })}`,
      header, rows: body,
      money: [3, 4, header.length - 1],
      widths: [22, 12, 7, 8, 10, ...dayNums.map(() => 5), 10, 12],
    }])
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/dashboard" className="text-sm text-stone-500 hover:underline">← Dashboard</Link>
          <h1 className="text-lg font-bold">{seller?.full_name ?? '…'}</h1>
          <p className="text-sm text-stone-500">{seller?.regions?.name} · {displayPhone(seller?.phone ?? null)}{seller && !seller.is_active ? ' · inactive' : ''}</p>
        </div>
        <div className="flex gap-2">
          <input type="month" className="input w-auto" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          <button className="btn-ghost" onClick={exportDsr}>Export DSR</button>
        </div>
      </div>
      <ErrorNote text={error} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Sales" value={inr(summary?.sales_value)} />
        <Kpi label="Pieces" value={num(summary?.pieces)} />
        <Kpi label="Days with sales" value={`${summary?.days_with_sales ?? 0}`} sub={`${summary?.days_reported ?? 0} days submitted`} />
        <Kpi label="₹ per sales day" value={inr(summary?.value_per_sales_day)} />
        <Kpi label="Days under ₹7,500" value={num(summary?.low_value_days)} tone={summary?.low_value_days ? 'warn' : undefined} />
      </div>

      <Section title="Day × SKU (pieces) — tap a date to view or correct">
        {rows.length ? (
          <div className="overflow-x-auto">
            <table className="text-xs">
              <thead className="bg-stone-50">
                <tr>
                  <th className="th sticky left-0 z-10 bg-stone-50">SKU</th>
                  {dayNums.map((d) => {
                    const date = `${month}-${String(d).padStart(2, '0')}`
                    const info = dayInfo.get(d)
                    const future = date > today
                    return (
                      <th key={d} className="px-1 py-2 text-center font-semibold">
                        {future ? <span className="text-stone-300">{d}</span> : (
                          <Link href={`/entry?seller=${id}&date=${date}`}
                            title={info ? `Submitted ${niceTime(info.submitted_at)}${info.remarks ? ' — ' + info.remarks : ''}` : 'Not submitted'}
                            className={`inline-block w-7 rounded py-0.5 ${info ? (Number(info.pieces) ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-600') : 'bg-red-50 text-red-600'}`}>
                            {d}
                          </Link>
                        )}
                      </th>
                    )
                  })}
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {rows.map((s) => {
                  const q = dayNums.map((d) => cell.get(`${s.code}|${d}`) ?? 0)
                  const total = q.reduce((a, b) => a + b, 0)
                  return (
                    <tr key={s.id} className={total ? '' : 'text-stone-300'}>
                      <td className="sticky left-0 z-10 whitespace-nowrap bg-white px-3 py-1.5">
                        <span className={total ? 'text-stone-800' : ''}>{s.product.name}</span> <span className="text-stone-400">{PACK_LABEL[s.pack_size]}</span>
                      </td>
                      {q.map((v, i) => <td key={i} className={`px-1 py-1.5 text-center ${v ? 'font-semibold text-stone-800' : ''}`}>{v || '·'}</td>)}
                      <td className="px-3 py-1.5 text-right font-semibold">{total || ''}</td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td className="sticky left-0 bg-stone-50 px-3 py-1.5">Pieces</td>
                  {dayNums.map((d) => <td key={d} className="px-1 py-1.5 text-center">{Number(dayInfo.get(d)?.pieces ?? 0) || ''}</td>)}
                  <td className="px-3 py-1.5 text-right">{num(summary?.pieces)}</td>
                </tr>
                <tr>
                  <td className="sticky left-0 bg-stone-50 px-3 py-1.5">₹</td>
                  {dayNums.map((d) => {
                    const v = Number(dayInfo.get(d)?.sales_value ?? 0)
                    return <td key={d} className={`px-1 py-1.5 text-center ${v && v < 7500 ? 'text-amber-700' : ''}`}>{v ? (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : Math.round(v)) : ''}</td>
                  })}
                  <td className="px-3 py-1.5 text-right">{inr(summary?.sales_value)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <Empty>Loading…</Empty>}
      </Section>

      {days.some((d) => d.remarks) && (
        <Section title="Remarks">
          <ul className="divide-y divide-stone-100 text-sm">
            {days.filter((d) => d.remarks).sort((a, b) => a.report_date.localeCompare(b.report_date)).map((d) => (
              <li key={d.report_id} className="px-4 py-2"><span className="mr-2 font-medium">{niceDate(d.report_date)}</span>{d.remarks}</li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  )
}
