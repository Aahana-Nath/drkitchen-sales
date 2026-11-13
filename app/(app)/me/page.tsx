'use client'

import { useEffect, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { DailyChart, Empty, ErrorNote, Kpi, Section } from '@/components/ui'
import ProductSalesChart from '@/components/ProductSalesChart'
import { supabase } from '@/lib/supabase/client'
import { addDays, errMsg, inr, monthEnd, monthStart, niceDate, num, todayIST } from '@/lib/format'
import { PACK_LABEL, type DailyPoint, type DailyTotal, type SellerSummary, type SkuSummary } from '@/lib/types'
import { demoDailySeries, demoSkuSummary, demoSummaries, isDemoMode } from '@/lib/demo'

export default function MySales() {
  const profile = useProfile()
  const today = todayIST()
  const [month, setMonth] = useState(today.slice(0, 7))
  const [summary, setSummary] = useState<SellerSummary | null>(null)
  const [series, setSeries] = useState<DailyPoint[]>([])
  const [days, setDays] = useState<DailyTotal[]>([])
  const [skus, setSkus] = useState<SkuSummary[]>([])
  const [productRange, setProductRange] = useState({ from: '1900-01-01', to: today })
  const [productSkus, setProductSkus] = useState<SkuSummary[]>([])
  const [productLoading, setProductLoading] = useState(true)
  const [productError, setProductError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const from = monthStart(month + '-01')
    const end = monthEnd(month + '-01')
    const to = end > today ? today : end
    if (isDemoMode) {
      setError(null)
      setSummary(demoSummaries().find((row) => row.seller_id === profile.id) ?? null)
      setSeries(demoDailySeries(from, to))
      setDays([])
      const demoProducts = demoSkuSummary(profile.id, from, to)
      setSkus(demoProducts.filter((row) => Number(row.pieces) > 0))
      return
    }

    const sb = supabase()
    const args = { p_from: from, p_to: to, p_seller: profile.id }
    Promise.all([
      sb.rpc('report_seller_summary', args),
      sb.rpc('report_daily_series', args),
      sb.from('v_daily_seller_totals').select('*').gte('report_date', from).lte('report_date', to).order('report_date', { ascending: false }),
      sb.rpc('report_sku_summary', args),
    ]).then(([s, d, t, k]) => {
      const err = s.error || d.error || t.error || k.error
      if (err) return setError(errMsg(err))
      setSummary((s.data as SellerSummary[])[0] ?? null)
      setSeries(d.data as DailyPoint[])
      setDays(t.data as DailyTotal[])
      setSkus((k.data as SkuSummary[]).filter((r) => Number(r.pieces) > 0))
    })
  }, [month, profile.id, today])

  useEffect(() => {
    let cancelled = false
    setProductLoading(true)
    setProductError(null)
    async function loadProducts() {
      try {
        let rows: SkuSummary[]
        if (isDemoMode) {
          rows = demoSkuSummary(profile.id, productRange.from, productRange.to)
        } else {
          const { data, error } = await supabase().rpc('report_sku_summary', {
            p_from: productRange.from, p_to: productRange.to, p_seller: profile.id,
          })
          if (error) throw error
          rows = data as SkuSummary[]
        }
        if (!cancelled) setProductSkus(rows)
      } catch (e) {
        if (!cancelled) setProductError(errMsg(e))
      } finally {
        if (!cancelled) setProductLoading(false)
      }
    }
    void loadProducts()
    return () => { cancelled = true }
  }, [productRange, profile.id])

  const productQuick = [
    { label: 'Today', from: today, to: today },
    { label: 'Yesterday', from: addDays(today, -1), to: addDays(today, -1) },
    { label: 'Last 7 days', from: addDays(today, -6), to: today },
    { label: 'This month', from: monthStart(today), to: today },
    { label: 'All time', from: '1900-01-01', to: today },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-lg font-bold">My sales</h1>
        <input type="month" className="input w-auto" value={month} max={today.slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
      </div>
      <ErrorNote text={error} />

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Kpi label="Sales (basic cost)" value={inr(summary?.sales_value)} />
        <Kpi label="Pieces" value={num(summary?.pieces)} />
        <Kpi label="Days with sales" value={num(summary?.days_with_sales)} sub={`${inr(summary?.value_per_sales_day)} / day`} />
        <Kpi label="Days under ₹7,500" value={num(summary?.low_value_days)} tone={summary?.low_value_days ? 'warn' : undefined} />
      </div>

      <Section title="Daily sales">
        {series.length ? <DailyChart data={series} /> : <Empty>No data</Empty>}
      </Section>

      <Section title="My packets sold by spice">
        <div className="space-y-3 border-b border-stone-100 p-3">
          <div className="flex flex-wrap gap-1.5">
            {productQuick.map((preset) => (
              <button key={preset.label} onClick={() => setProductRange({ from: preset.from, to: preset.to })}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  productRange.from === preset.from && productRange.to === preset.to
                    ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                }`}>
                {preset.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="min-w-0">
              <span className="label">Product sales from</span>
              <input type="date" className="input" value={productRange.from === '1900-01-01' ? '' : productRange.from}
                max={productRange.to} onChange={(e) => e.target.value && setProductRange({ ...productRange, from: e.target.value })} />
            </label>
            <label className="min-w-0">
              <span className="label">Product sales to</span>
              <input type="date" className="input" value={productRange.to} min={productRange.from} max={today}
                onChange={(e) => e.target.value && setProductRange({ ...productRange, to: e.target.value })} />
            </label>
          </div>
        </div>
        <ProductSalesChart data={productSkus}
          loading={productLoading} error={productError} />
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Days submitted">
          {days.length ? (
            <div className="max-h-96 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white"><tr><th className="th">Date</th><th className="th text-right">Pieces</th><th className="th text-right">Sales</th><th className="th">Remarks</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {days.map((d) => (
                    <tr key={d.report_id}>
                      <td className="td">{niceDate(d.report_date, { weekday: 'short', day: 'numeric', month: 'short' })}</td>
                      <td className="td text-right">{num(d.pieces)}</td>
                      <td className={`td text-right font-medium ${Number(d.sales_value) > 0 && Number(d.sales_value) < 7500 ? 'text-amber-700' : ''}`}>{inr(d.sales_value)}</td>
                      <td className="td max-w-48 truncate text-stone-500">{d.remarks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No entries this month</Empty>}
        </Section>

        <Section title="By product">
          {skus.length ? (
            <div className="max-h-96 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white"><tr><th className="th">Product</th><th className="th">Pack</th><th className="th text-right">Pieces</th><th className="th text-right">Sales</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {skus.map((r) => (
                    <tr key={r.sku_code}>
                      <td className="td">{r.product_name}</td>
                      <td className="td">{PACK_LABEL[r.pack_size]}</td>
                      <td className="td text-right">{num(r.pieces)}</td>
                      <td className="td text-right">{inr(r.sales_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No sales this month</Empty>}
        </Section>
      </div>
    </div>
  )
}
