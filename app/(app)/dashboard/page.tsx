'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { useProfile } from '@/components/ProfileContext'
import { DailyChart, Empty, ErrorNote, Kpi, Section } from '@/components/ui'
import ProductSalesChart from '@/components/ProductSalesChart'
import { loadRegions, loadSellers } from '@/lib/data'
import { downloadXlsx } from '@/lib/excel'
import { fetchAll } from '@/lib/fetchAll'
import { supabase } from '@/lib/supabase/client'
import { addDays, errMsg, inr, monthEnd, monthStart, niceDate, num, pct, todayIST } from '@/lib/format'
import {
  PACK_LABEL, type DailyPoint, type MissingSeller, type Profile, type Region, type SellerSummary, type SkuSummary,
} from '@/lib/types'
import { demoDailySeries, demoMissingSellers, demoSkuSummary, demoSummaries, isDemoMode } from '@/lib/demo'

type Range = { from: string; to: string }

interface TodaySubmission {
  report_id: number
  seller_id: string
  seller_name: string
  region_name: string
  submitted_at: string
  pieces: number
  sales_value: number
  remarks: string | null
}

interface SubmittedLine {
  product_name: string
  sku_code: string
  pack_size: keyof typeof PACK_LABEL
  quantity: number
  line_value: number
}

interface SubmissionAuditEvent {
  row_id: string
  action: 'INSERT' | 'UPDATE'
  at: string
}

export default function Dashboard() {
  const profile = useProfile()
  const isAdmin = profile.role === 'superadmin'
  const today = todayIST()

  const [range, setRange] = useState<Range>({ from: monthStart(today), to: today })
  const [regionId, setRegionId] = useState<number | null>(null)
  const [sellerId, setSellerId] = useState('')
  const [search, setSearch] = useState('')

  const [regions, setRegions] = useState<Region[]>([])
  const [sellers, setSellers] = useState<Profile[]>([])
  const [summary, setSummary] = useState<SellerSummary[]>([])
  const [series, setSeries] = useState<DailyPoint[]>([])
  const [skus, setSkus] = useState<SkuSummary[]>([])
  const [missing, setMissing] = useState<MissingSeller[]>([])
  const [metric, setMetric] = useState<'sales_value' | 'pieces'>('sales_value')
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [overviewLoading, setOverviewLoading] = useState(false)
  const [overviewError, setOverviewError] = useState<string | null>(null)
  const [todaySubmissions, setTodaySubmissions] = useState<TodaySubmission[]>([])
  const [submissionHistory, setSubmissionHistory] = useState<Record<string, string[]>>({})
  const [overviewMissing, setOverviewMissing] = useState<MissingSeller[]>([])
  const [reminderStatus, setReminderStatus] = useState<Record<string, 'sending' | 'sent'>>({})
  const [reminderErrors, setReminderErrors] = useState<Record<string, string>>({})
  const [selectedSubmission, setSelectedSubmission] = useState<TodaySubmission | null>(null)
  const [submissionLines, setSubmissionLines] = useState<SubmittedLine[]>([])
  const [linesLoading, setLinesLoading] = useState(false)
  const [linesError, setLinesError] = useState<string | null>(null)

  useEffect(() => {
    if (isAdmin) loadRegions().then(setRegions).catch(() => {})
  }, [isAdmin])

  useEffect(() => {
    loadSellers(regionId).then(setSellers).catch(() => {})
    setSellerId('')
  }, [regionId])

  useEffect(() => {
    if (isDemoMode) {
      setLoading(false)
      setError(null)
      setSummary(demoSummaries().filter((row) =>
        (!regionId || row.region_id === regionId) && (!sellerId || row.seller_id === sellerId),
      ))
      setSeries(demoDailySeries(range.from, range.to))
      setSkus(demoSkuSummary(sellerId || undefined, range.from, range.to))
      setMissing(demoMissingSellers())
      return
    }

    let cancelled = false
    const sb = supabase()
    const args = { p_from: range.from, p_to: range.to, p_region: regionId, p_seller: sellerId || null }
    setLoading(true)
    setError(null)
    Promise.all([
      sb.rpc('report_seller_summary', args),
      sb.rpc('report_daily_series', args),
      sb.rpc('report_sku_summary', args),
      sb.rpc('report_missing_submissions', { p_date: today, p_region: regionId }),
    ]).then(([s, d, k, m]) => {
      if (cancelled) return
      setLoading(false)
      const err = s.error || d.error || k.error || m.error
      if (err) return setError(errMsg(err))
      setError(null)
      setSummary(s.data as SellerSummary[])
      setSeries(d.data as DailyPoint[])
      setSkus(k.data as SkuSummary[])
      setMissing(m.data as MissingSeller[])
    }).catch((e) => {
      if (cancelled) return
      setLoading(false)
      setError(errMsg(e))
    })
    return () => { cancelled = true }
  }, [range, regionId, sellerId, today])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? summary.filter((r) => r.seller_name.toLowerCase().includes(q) || r.region_name.toLowerCase().includes(q)) : summary
  }, [summary, search])

  const totals = useMemo(() => {
    const t = { value: 0, pieces: 0, days: 0, low: 0, rs10: 0, g50: 0, g100: 0 }
    for (const r of shown) {
      t.value += Number(r.sales_value); t.pieces += Number(r.pieces); t.days += r.days_with_sales; t.low += r.low_value_days
      t.rs10 += Number(r.rs10_value); t.g50 += Number(r.g50_value); t.g100 += Number(r.g100_value)
    }
    return t
  }, [shown])

  const skuTotal = skus.reduce((a, r) => a + Number(r.sales_value), 0)
  const activeSellers = sellers.filter((s) => s.is_active).length

  async function openSubmissionOverview() {
    setOverviewOpen(true)
    setOverviewLoading(true)
    setOverviewError(null)
    setSelectedSubmission(null)
    setSubmissionLines([])
    setLinesError(null)
    setSubmissionHistory({})

    if (isDemoMode) {
      setTodaySubmissions([])
      setOverviewMissing([])
      setOverviewLoading(false)
      return
    }

    try {
      let submissionsQuery = supabase().from('v_daily_seller_totals')
        .select('report_id,seller_id,seller_name,region_name,submitted_at,pieces,sales_value,remarks')
        .eq('report_date', today)
        .order('submitted_at')
      if (regionId) submissionsQuery = submissionsQuery.eq('region_id', regionId)

      const [submissionsResult, missingResult] = await Promise.all([
        submissionsQuery,
        supabase().rpc('report_missing_submissions', { p_date: today, p_region: regionId }),
      ])
      if (submissionsResult.error) throw submissionsResult.error
      if (missingResult.error) throw missingResult.error
      const submissions = (submissionsResult.data ?? []) as TodaySubmission[]
      setTodaySubmissions(submissions)
      setOverviewMissing((missingResult.data ?? []) as MissingSeller[])

      if (submissions.length) {
        const { data: auditEvents, error: auditError } = await supabase().from('audit_log')
          .select('row_id,action,at')
          .eq('table_name', 'daily_reports')
          .in('action', ['INSERT', 'UPDATE'])
          .in('row_id', submissions.map((submission) => String(submission.report_id)))
          .order('at')
        if (auditError) throw auditError

        const histories: Record<string, string[]> = {}
        for (const event of (auditEvents ?? []) as SubmissionAuditEvent[]) {
          histories[event.row_id] = [...(histories[event.row_id] ?? []), event.at]
        }
        setSubmissionHistory(histories)
      }
    } catch (e) {
      setOverviewError(errMsg(e))
    } finally {
      setOverviewLoading(false)
    }
  }

  async function selectSubmission(submission: TodaySubmission) {
    if (selectedSubmission?.report_id === submission.report_id) {
      setSelectedSubmission(null)
      setSubmissionLines([])
      setLinesError(null)
      return
    }

    setSelectedSubmission(submission)
    setSubmissionLines([])
    setLinesError(null)
    setLinesLoading(true)
    try {
      const { data, error } = await supabase().from('v_sales_lines')
        .select('product_name,sku_code,pack_size,quantity,line_value')
        .eq('seller_id', submission.seller_id)
        .eq('report_date', today)
        .order('product_name')
        .order('sku_code')
      if (error) throw error
      setSubmissionLines((data ?? []) as SubmittedLine[])
    } catch (e) {
      setLinesError(errMsg(e))
    } finally {
      setLinesLoading(false)
    }
  }

  useEffect(() => {
    if (!overviewOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOverviewOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [overviewOpen])

  function submittedTime(timestamp: string): string {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(timestamp))
  }

  function reportTimes(submission: TodaySubmission): string[] {
    return submissionHistory[String(submission.report_id)]?.length
      ? submissionHistory[String(submission.report_id)]
      : [submission.submitted_at]
  }

  async function notifySeller(seller: MissingSeller) {
    setReminderStatus((current) => ({ ...current, [seller.seller_id]: 'sending' }))
    setReminderErrors((current) => {
      const next = { ...current }
      delete next[seller.seller_id]
      return next
    })
    try {
      const response = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sellerId: seller.seller_id }),
      })
      const result = await response.json() as { error?: string }
      if (!response.ok) throw new Error(result.error || 'Could not send the reminder.')
      setReminderStatus((current) => ({ ...current, [seller.seller_id]: 'sent' }))
    } catch (e) {
      setReminderStatus((current) => {
        const next = { ...current }
        delete next[seller.seller_id]
        return next
      })
      setReminderErrors((current) => ({
        ...current,
        [seller.seller_id]: errMsg(e),
      }))
    }
  }

  async function exportExcel() {
    if (isDemoMode) {
      setError('Excel export is disabled in local demo mode.')
      return
    }
    setExporting(true)
    try {
      const sb = supabase()
      const lines = await fetchAll<Record<string, string | number>>((a, b) => {
        let q = sb.from('v_sales_lines')
          .select('report_date, seller_name, region_name, product_name, sku_code, pack_size, quantity, unit_mrp, unit_rbc, line_value')
          .gte('report_date', range.from).lte('report_date', range.to)
          .order('report_date').order('seller_name').order('sku_code')
        if (regionId) q = q.eq('region_id', regionId)
        if (sellerId) q = q.eq('seller_id', sellerId)
        return q.range(a, b)
      })
      const days = await fetchAll<Record<string, string | number | null>>((a, b) => {
        let q = sb.from('v_daily_seller_totals')
          .select('report_date, seller_name, region_name, pieces, rs10_pieces, g50_pieces, g100_pieces, sales_value, remarks')
          .gte('report_date', range.from).lte('report_date', range.to)
          .order('report_date').order('seller_name')
        if (regionId) q = q.eq('region_id', regionId)
        if (sellerId) q = q.eq('seller_id', sellerId)
        return q.range(a, b)
      })
      const title = `DrKitchen sales ${range.from} to ${range.to}`
      await downloadXlsx(`DrKitchen_Sales_${range.from}_${range.to}.xlsx`, [
        {
          name: 'Summary', title,
          header: ['Rank', 'Seller', 'Region', 'Days with sales', 'Pieces', 'Sales ₹', 'Share', '₹ / sales day', 'Days < ₹7,500',
            '₹10 pcs', '50g pcs', '100g pcs', '₹10 ₹', '50g ₹', '100g ₹'],
          rows: shown.map((r) => [r.rank_by_value, r.seller_name, r.region_name, r.days_with_sales, Number(r.pieces), Number(r.sales_value),
            Number(r.value_share), Number(r.value_per_sales_day), r.low_value_days, Number(r.rs10_pieces), Number(r.g50_pieces),
            Number(r.g100_pieces), Number(r.rs10_value), Number(r.g50_value), Number(r.g100_value)]),
          money: [5, 7, 12, 13, 14], widths: [6, 20, 20],
        },
        {
          name: 'Daily', title,
          header: ['Date', 'Seller', 'Region', 'Pieces', '₹10 pcs', '50g pcs', '100g pcs', 'Sales ₹', 'Remarks'],
          rows: days.map((d) => [d.report_date, d.seller_name, d.region_name, Number(d.pieces), Number(d.rs10_pieces), Number(d.g50_pieces),
            Number(d.g100_pieces), Number(d.sales_value), d.remarks]),
          money: [7], widths: [12, 20, 20, 8, 8, 8, 8, 12, 40],
        },
        {
          name: 'Lines', title,
          header: ['Date', 'Seller', 'Region', 'Product', 'SKU', 'Pack', 'Qty', 'MRP', 'Basic cost', 'Value ₹'],
          rows: lines.map((l) => [l.report_date, l.seller_name, l.region_name, l.product_name, l.sku_code,
            PACK_LABEL[l.pack_size as keyof typeof PACK_LABEL], Number(l.quantity), Number(l.unit_mrp), Number(l.unit_rbc), Number(l.line_value)]),
          money: [7, 8, 9], widths: [12, 20, 20, 22, 12, 7],
        },
      ])
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setExporting(false)
    }
  }

  const quick: { label: string; r: Range }[] = [
    { label: 'Today', r: { from: today, to: today } },
    { label: 'Yesterday', r: { from: addDays(today, -1), to: addDays(today, -1) } },
    { label: 'Last 7 days', r: { from: addDays(today, -6), to: today } },
    { label: 'This month', r: { from: monthStart(today), to: today } },
    (() => { const lm = addDays(monthStart(today), -1); return { label: 'Last month', r: { from: monthStart(lm), to: monthEnd(lm) } } })(),
  ]

  async function showAllTime() {
    try {
      let firstDate = addDays(today, -29)
      if (!isDemoMode) {
        let query = supabase().from('v_daily_seller_totals').select('report_date')
          .order('report_date').limit(1)
        if (regionId) query = query.eq('region_id', regionId)
        if (sellerId) query = query.eq('seller_id', sellerId)
        const { data, error } = await query
        if (error) throw error
        firstDate = data?.[0]?.report_date ?? today
      }
      setRange({ from: firstDate, to: today })
    } catch (e) {
      setError(errMsg(e))
    }
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap gap-1.5">
          {quick.map((q) => (
            <button key={q.label} onClick={() => setRange(q.r)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${range.from === q.r.from && range.to === q.r.to ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'}`}>
              {q.label}
            </button>
          ))}
          <button className="rounded-full bg-stone-100 px-3 py-1 text-xs font-medium text-stone-700 hover:bg-stone-200" onClick={showAllTime}>
            All time
          </button>
        </div>
        <div className={`grid grid-cols-2 gap-2 ${isAdmin ? 'md:grid-cols-6' : 'md:grid-cols-5'}`}>
          <div><label className="label" htmlFor="sales-from">From</label>
            <input id="sales-from" type="date" className="input" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></div>
          <div><label className="label" htmlFor="sales-to">To</label>
            <input id="sales-to" type="date" className="input" value={range.to} min={range.from} max={today} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></div>
          {isAdmin && (
            <div><label className="label">Region</label>
              <select className="input" value={regionId ?? ''} onChange={(e) => setRegionId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">All regions</option>
                {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select></div>
          )}
          <div><label className="label" htmlFor="sales-seller">Seller</label>
            <select id="sales-seller" className="input" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
              <option value="">All sellers</option>
              {sellers.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
            </select></div>
          <div className="col-span-2"><label className="label">Search</label>
            <input className="input" placeholder="Seller or region" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
      </div>

      <ErrorNote text={error} />

      {/* KPIs */}
      <div className={`grid grid-cols-2 gap-2 ${sellerId ? 'md:grid-cols-4' : 'md:grid-cols-5'} ${loading ? 'opacity-60' : ''}`}>
        <Kpi label="Sales (basic cost)" value={inr(totals.value)} sub={`${niceDate(range.from)} – ${niceDate(range.to)}`} />
        <Kpi label="Pieces" value={num(totals.pieces)} />
        <Kpi label="₹ per sales day" value={inr(totals.days ? totals.value / totals.days : 0)} sub={`${num(totals.days)} seller-days`} />
        <Kpi label="Days under ₹7,500" value={num(totals.low)} tone={totals.low ? 'warn' : undefined} />
        {!sellerId && (
          <Kpi label="Submitted today" value={`${Math.max(0, activeSellers - missing.length)} / ${activeSellers}`}
            tone={missing.length ? 'warn' : 'ok'} sub={missing.length ? `${missing.length} pending` : 'All in'}
            action={<button className="text-xs font-semibold text-brand-700 hover:underline" onClick={openSubmissionOverview}>
              See overview
            </button>} />
        )}
      </div>

      {overviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/40 p-3 sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOverviewOpen(false)
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="submission-overview-title"
            className="flex max-h-[90dvh] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl"
          >
            <header className="flex items-start justify-between gap-4 border-b border-stone-200 px-4 py-3 sm:px-6">
              <div>
                <h2 id="submission-overview-title" className="text-base font-bold">Today’s submissions</h2>
                <p className="text-sm text-stone-500">{niceDate(today)} · times shown in India Standard Time</p>
              </div>
              <button className="btn-ghost px-3 py-1.5 text-sm" onClick={() => setOverviewOpen(false)} aria-label="Close overview">
                Close
              </button>
            </header>

            {isDemoMode ? (
              <p className="p-6 text-sm text-stone-500">Submission overview is unavailable in local demo mode.</p>
            ) : overviewError ? (
              <div className="p-4 sm:p-6"><ErrorNote text={overviewError} /></div>
            ) : overviewLoading ? (
              <p className="p-6 text-sm text-stone-500">Loading today’s submissions…</p>
            ) : (
              <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2 sm:p-6">
                <section className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold">
                    Submitted <span className="text-stone-400">({todaySubmissions.length})</span>
                  </h3>
                  {todaySubmissions.length ? (
                    <ul className="space-y-2">
                      {todaySubmissions.map((submission) => {
                        const selected = selectedSubmission?.report_id === submission.report_id
                        return (
                          <li key={submission.report_id} className="relative rounded-lg border border-stone-200">
                            <button
                              className={`flex w-full items-center justify-between gap-3 p-3 text-left hover:bg-brand-50 ${selected ? 'bg-brand-50' : ''}`}
                              onClick={() => selectSubmission(submission)}
                              aria-expanded={selected}
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-semibold">{submission.seller_name}</span>
                                <span className="block truncate text-xs text-stone-500">{submission.region_name}</span>
                              </span>
                              <span className="shrink-0 text-right">
                                {(() => {
                                  const times = reportTimes(submission)
                                  return (
                                    <span className="flex items-center justify-end gap-1">
                                      <span className="text-sm font-medium">{submittedTime(times[times.length - 1])}</span>
                                      {times.length > 1 && (
                                        <span className="group relative inline-flex">
                                          <button
                                            type="button"
                                            className="flex h-4 w-4 items-center justify-center rounded-full border border-stone-400 text-[10px] font-semibold leading-none text-stone-600 hover:bg-stone-100 focus:outline-none focus:ring-2 focus:ring-brand-500"
                                            aria-label={`Previous save times for ${submission.seller_name}`}
                                            aria-describedby={`submission-history-${submission.report_id}`}
                                          >
                                            i
                                          </button>
                                          <span
                                            id={`submission-history-${submission.report_id}`}
                                            role="tooltip"
                                            className="invisible absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-stone-200 bg-white p-2 text-left text-xs shadow-lg group-hover:visible group-focus-within:visible"
                                          >
                                            <span className="mb-1 block font-semibold text-stone-700">Previous saves today</span>
                                            {times.slice(0, -1).map((time, index) => (
                                              <span key={`${time}-${index}`} className="block text-stone-600">
                                                {submittedTime(time)}
                                              </span>
                                            ))}
                                          </span>
                                        </span>
                                      )}
                                    </span>
                                  )
                                })()}
                                <span className="block text-xs text-stone-500">{num(submission.pieces)} pcs · {inr(submission.sales_value)}</span>
                              </span>
                            </button>
                            {selected && (
                              <div className="border-t border-stone-200 bg-stone-50 px-3 py-2.5">
                                {linesLoading ? (
                                  <p className="text-xs text-stone-500">Loading submitted items…</p>
                                ) : linesError ? (
                                  <ErrorNote text={linesError} />
                                ) : submissionLines.length ? (
                                  <ul className="space-y-1">
                                    {submissionLines.map((line) => (
                                      <li key={line.sku_code} className="flex justify-between gap-3 text-xs">
                                        <span className="min-w-0 truncate">{line.product_name} · {PACK_LABEL[line.pack_size]}</span>
                                        <span className="shrink-0 font-medium">{num(line.quantity)} · {inr(line.line_value)}</span>
                                      </li>
                                    ))}
                                  </ul>
                                ) : (
                                  <p className="text-xs text-stone-500">No items submitted (zero-sales report).</p>
                                )}
                                {submission.remarks && <p className="mt-2 border-t border-stone-200 pt-2 text-xs text-stone-600">Note: {submission.remarks}</p>}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p className="rounded-lg bg-stone-50 p-3 text-sm text-stone-500">No submissions yet today.</p>
                  )}
                </section>

                <section className="min-w-0">
                  <h3 className="mb-2 text-sm font-semibold">
                    Pending <span className="text-stone-400">({overviewMissing.length})</span>
                  </h3>
                  {overviewMissing.length ? (
                    <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
                      {overviewMissing.map((seller) => (
                        <li key={seller.seller_id} className="px-3 py-2.5">
                          <div className="flex items-center justify-between gap-3">
                            <span className="min-w-0 text-sm font-medium">{seller.seller_name}</span>
                            <span className="shrink-0 text-right text-xs text-stone-500">{seller.region_name}</span>
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-2">
                            <span className="min-w-0 text-xs text-red-700">{reminderErrors[seller.seller_id] ?? ''}</span>
                            <button
                              className="btn-ghost shrink-0 px-3 py-1 text-xs"
                              onClick={() => notifySeller(seller)}
                              disabled={reminderStatus[seller.seller_id] === 'sending' || reminderStatus[seller.seller_id] === 'sent'}
                            >
                              {reminderStatus[seller.seller_id] === 'sending'
                                ? 'Sending…'
                                : reminderStatus[seller.seller_id] === 'sent'
                                  ? 'Notified'
                                  : 'Notify'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="rounded-lg bg-green-50 p-3 text-sm text-green-800">Everyone has submitted.</p>
                  )}
                </section>
              </div>
            )}
          </section>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex lg:col-span-2">
          <Section className="flex-1" title="Date-wise" right={
            <div className="flex gap-1 text-xs">
              {(['sales_value', 'pieces'] as const).map((m) => (
                <button key={m} onClick={() => setMetric(m)} className={`rounded px-2 py-0.5 ${metric === m ? 'bg-stone-800 text-white' : 'bg-stone-100'}`}>
                  {m === 'sales_value' ? '₹' : 'Pieces'}
                </button>
              ))}
            </div>
          }>
            {series.length ? <DailyChart data={series} metric={metric} /> : <Empty>No data</Empty>}
          </Section>
        </div>
        <Section className="h-full" title="Packets sold by spice">
          <ProductSalesChart
            data={skus} loading={loading} error={error}
          />
        </Section>
      </div>

      {/* Seller table */}
      <Section title="Sellers" right={
        <button className="btn-ghost px-3 py-1.5 text-xs" onClick={exportExcel} disabled={exporting}>{exporting ? 'Exporting…' : 'Export Excel'}</button>
      }>
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-stone-50">
                <tr>
                  <th className="th">#</th><th className="th">Seller</th><th className="th">Region</th>
                  <th className="th text-right">Sales days</th><th className="th text-right">Pieces</th><th className="th text-right">Sales</th>
                  <th className="th text-right">Share</th><th className="th text-right">₹ / day</th><th className="th text-right">&lt; ₹7.5k</th>
                  <th className="th text-right">₹10</th><th className="th text-right">50g</th><th className="th text-right">100g</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {shown.map((r) => (
                  <tr key={r.seller_id} className="hover:bg-brand-50/50">
                    <td className="td text-stone-400">{r.rank_by_value ?? '–'}</td>
                    <td className="td font-medium">
                      {isDemoMode
                        ? r.seller_name
                        : <Link className="text-brand-700 hover:underline" href={`/dashboard/seller/${r.seller_id}?month=${range.to.slice(0, 7)}`}>{r.seller_name}</Link>}
                    </td>
                    <td className="td text-stone-500">{r.region_name}</td>
                    <td className="td text-right">{r.days_with_sales}<span className="text-stone-400">/{r.days_reported}</span></td>
                    <td className="td text-right">{num(r.pieces)}</td>
                    <td className="td text-right font-semibold">{inr(r.sales_value)}</td>
                    <td className="td text-right">{pct(r.value_share)}</td>
                    <td className="td text-right">{inr(r.value_per_sales_day)}</td>
                    <td className={`td text-right ${r.low_value_days ? 'font-semibold text-amber-700' : 'text-stone-400'}`}>{r.low_value_days}</td>
                    <td className="td text-right text-stone-600">{num(r.rs10_pieces)}</td>
                    <td className="td text-right text-stone-600">{num(r.g50_pieces)}</td>
                    <td className="td text-right text-stone-600">{num(r.g100_pieces)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-stone-200 bg-stone-50 font-semibold">
                <tr>
                  <td className="td" colSpan={3}>Total</td>
                  <td className="td text-right">{num(totals.days)}</td>
                  <td className="td text-right">{num(totals.pieces)}</td>
                  <td className="td text-right">{inr(totals.value)}</td>
                  <td className="td" /><td className="td text-right">{inr(totals.days ? totals.value / totals.days : 0)}</td>
                  <td className="td text-right">{totals.low}</td>
                  <td className="td text-right" colSpan={3}>
                    <span className="text-xs font-normal text-stone-500">50g+100g share {pct(totals.value ? (totals.g50 + totals.g100) / totals.value : 0)}</span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : <Empty>{loading ? 'Loading…' : 'No sellers match'}</Empty>}
      </Section>

      {/* SKU breakdown */}
      <Section title="By product and pack">
        <div className="max-h-[28rem] overflow-auto">
          <table className="w-full">
            <thead className="sticky top-0 bg-stone-50">
              <tr><th className="th">Product</th><th className="th">Pack</th><th className="th">SKU</th><th className="th text-right">Pieces</th><th className="th text-right">Sales</th><th className="th text-right">Share</th></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {skus.map((r) => (
                <tr key={r.sku_code} className={Number(r.pieces) ? '' : 'text-stone-400'}>
                  <td className="td">{r.product_name}</td>
                  <td className="td">{PACK_LABEL[r.pack_size]}</td>
                  <td className="td font-mono text-xs">{r.sku_code}</td>
                  <td className="td text-right">{num(r.pieces)}</td>
                  <td className="td text-right">{inr(r.sales_value)}</td>
                  <td className="td text-right">{pct(skuTotal ? Number(r.sales_value) / skuTotal : 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}