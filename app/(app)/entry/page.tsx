'use client'

import { Suspense, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useProfile } from '@/components/ProfileContext'
import { loadPrices, loadSellers, loadSetting, loadSkus, priceOn } from '@/lib/data'
import { supabase } from '@/lib/supabase/client'
import { addDays, errMsg, hourIST, inr, niceDate, niceTime, num, todayIST } from '@/lib/format'
import { PACK_LABEL, type Profile, type Sku, type SkuPrice } from '@/lib/types'
import { isDemoMode, readDemoReport, saveDemoReport } from '@/lib/demo'

export default function EntryPage() {
  return <Suspense><Entry /></Suspense>
}

function Entry() {
  const profile = useProfile()
  const isSeller = profile.role === 'seller'
  const params = useSearchParams()
  const router = useRouter()

  const today = todayIST()
  const yesterday = addDays(today, -1)

  const [sellerId, setSellerId] = useState(isSeller ? profile.id : params.get('seller') ?? '')
  const [date, setDate] = useState(params.get('date') ?? today)
  const [skus, setSkus] = useState<Sku[]>([])
  const [prices, setPrices] = useState<SkuPrice[]>([])
  const [sellers, setSellers] = useState<Profile[]>([])
  const [cutoff, setCutoff] = useState(12)

  const [qty, setQty] = useState<Record<number, number>>({})
  const [saved, setSaved] = useState<Record<number, number>>({})
  const [remarks, setRemarks] = useState('')
  const [submittedAt, setSubmittedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // master data
  useEffect(() => {
    Promise.all([loadSkus(), loadPrices(), loadSetting<number>('seller_edit_cutoff_hour', 12)])
      .then(([s, p, c]) => { setSkus(s); setPrices(p); setCutoff(Number(c)) })
      .catch((e) => setMsg({ ok: false, text: errMsg(e) }))
    if (!isSeller) loadSellers().then((items) => {
      setSellers(items)
      if (isDemoMode && !sellerId) setSellerId(items[0]?.id ?? '')
    }).catch(() => {})
  }, [isSeller])

  // keep URL in sync for managers (shareable links from dashboards)
  useEffect(() => {
    if (isSeller) return
    const q = new URLSearchParams()
    if (sellerId) q.set('seller', sellerId)
    q.set('date', date)
    router.replace(`/entry?${q}`, { scroll: false })
  }, [isSeller, sellerId, date, router])

  // load existing report
  useEffect(() => {
    if (!sellerId) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    setMsg(null)
    if (isDemoMode) {
      const report = readDemoReport(sellerId, date)
      setQty(report.quantities)
      setSaved(report.quantities)
      setRemarks(report.remarks)
      setSubmittedAt(report.submittedAt)
      setLoading(false)
      return () => { cancelled = true }
    }

    supabase()
      .from('daily_reports')
      .select('id, remarks, submitted_at, daily_report_lines(sku_id, quantity)')
      .eq('seller_id', sellerId)
      .eq('report_date', date)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setMsg({ ok: false, text: errMsg(error) })
        const q: Record<number, number> = {}
        for (const l of (data?.daily_report_lines ?? []) as { sku_id: number; quantity: number }[]) q[l.sku_id] = l.quantity
        setQty(q)
        setSaved(q)
        setRemarks(data?.remarks ?? '')
        setSubmittedAt(data?.submitted_at ?? null)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [sellerId, date])

  const yesterdayOpen = hourIST() < cutoff
  const editable = !isSeller || date === today || (date === yesterday && yesterdayOpen)

  const products = useMemo(() => {
    const map = new Map<number, { name: string; skus: Sku[] }>()
    for (const s of skus) {
      if (!map.has(s.product.id)) map.set(s.product.id, { name: s.product.name, skus: [] })
      map.get(s.product.id)!.skus.push(s)
    }
    return [...map.values()]
  }, [skus])

  const totals = useMemo(() => {
    let pieces = 0, value = 0
    for (const s of skus) {
      const q = qty[s.id] ?? 0
      if (!q) continue
      pieces += q
      value += Math.round(q * (priceOn(prices, s.id, date)?.retailer_basic_cost ?? 0) * 100) / 100
    }
    return { pieces, value }
  }, [qty, skus, prices, date])

  const dirty = skus.some((s) => (qty[s.id] ?? 0) !== (saved[s.id] ?? 0)) || !submittedAt

  function setQ(id: number, v: number) {
    setQty((q) => ({ ...q, [id]: Math.max(0, Math.min(100000, Math.floor(v || 0))) }))
  }

  async function save() {
    setBusy(true)
    setMsg(null)
    if (isDemoMode) {
      const now = new Date().toISOString()
      saveDemoReport(sellerId, date, { quantities: { ...qty }, remarks: remarks.trim(), submittedAt: now })
      setBusy(false)
      setSaved({ ...qty })
      setSubmittedAt(now)
      setMsg({ ok: true, text: 'Saved in this browser’s local demo only' })
      return
    }

    const lines = skus.map((s) => ({ sku_id: s.id, quantity: qty[s.id] ?? 0 }))
    const { error } = await supabase().rpc('save_daily_report', {
      p_date: date,
      p_lines: lines,
      p_remarks: remarks.trim() || null,
      p_seller: isSeller ? null : sellerId,
    })
    setBusy(false)
    if (error) return setMsg({ ok: false, text: errMsg(error) })
    setSaved({ ...qty })
    setSubmittedAt(submittedAt ?? new Date().toISOString())
    setMsg({ ok: true, text: totals.pieces ? 'Saved' : 'Saved as a no-sale day' })
  }

  const sellerName = isSeller ? profile.full_name : sellers.find((s) => s.id === sellerId)?.full_name

  return (
    <div className="mx-auto max-w-2xl">
      {/* Who / when */}
      <div className="mb-4 space-y-3">
        {isSeller ? (
          <div className="grid grid-cols-2 gap-2">
            {[{ d: today, label: 'Today' }, { d: yesterday, label: 'Yesterday' }].map(({ d, label }) => (
              <button
                key={d} onClick={() => setDate(d)}
                className={`rounded-xl border px-3 py-2.5 text-left ${date === d ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white'}`}
              >
                <div className="text-sm font-semibold">{label}</div>
                <div className="text-xs text-stone-500">
                  {niceDate(d, { weekday: 'short', day: 'numeric', month: 'short' })}
                  {d === yesterday && !yesterdayOpen && ' · locked'}
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="card grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
            <div>
              <label className="label">Seller</label>
              <select className="input" value={sellerId} onChange={(e) => setSellerId(e.target.value)}>
                <option value="">Choose a seller…</option>
                {sellers.map((s) => (
                  <option key={s.id} value={s.id}>{s.full_name} — {s.regions?.name}{s.is_active ? '' : ' (inactive)'}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={date} max={today} onChange={(e) => e.target.value && setDate(e.target.value)} />
            </div>
          </div>
        )}

        {sellerId && !loading && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {submittedAt ? (
              <span className="rounded-full bg-green-100 px-2.5 py-0.5 font-medium text-green-800">
                Submitted {niceTime(submittedAt)}
              </span>
            ) : (
              <span className="rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800">Not submitted</span>
            )}
            {!editable && <span className="rounded-full bg-stone-200 px-2.5 py-0.5 font-medium text-stone-700">Locked — ask your manager to correct</span>}
            {!isSeller && sellerName && (
              <span className="text-stone-500">
                {isDemoMode ? 'Local demo; changes stay in this browser.' : `Editing as ${profile.full_name}; change is logged.`}
              </span>
            )}
          </div>
        )}
      </div>

      {!sellerId ? (
        <p className="card p-6 text-center text-stone-500">Pick a seller and date to view or correct their entry.</p>
      ) : loading ? (
        <p className="p-6 text-center text-stone-400">Loading…</p>
      ) : (
        <>
          <div className="space-y-2">
            {products.map((p) => (
              <div key={p.name} className="card p-3">
                <div className="mb-2 text-sm font-semibold">{p.name}</div>
                <div className="grid grid-cols-3 gap-2">
                  {p.skus.map((s) => (
                    <Stepper
                      key={s.id}
                      label={PACK_LABEL[s.pack_size]}
                      sub={`MRP ${inr(priceOn(prices, s.id, date)?.mrp)}`}
                      value={qty[s.id] ?? 0}
                      onChange={(v) => setQ(s.id, v)}
                      disabled={!editable}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-2 p-3">
            <label className="label" htmlFor="remarks">Remarks (optional)</label>
            <textarea
              id="remarks" className="input" rows={2} maxLength={500} disabled={!editable}
              placeholder="Market closed, new outlet, stock issue…" value={remarks} onChange={(e) => setRemarks(e.target.value)}
            />
          </div>

          {/* Sticky total + save */}
          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-stone-200 bg-white/95 backdrop-blur">
            <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
              <div className="flex-1">
                <div className="text-lg font-bold leading-tight">{inr(totals.value)}</div>
                <div className="text-xs text-stone-500">{num(totals.pieces)} pieces · basic cost</div>
              </div>
              {msg && <span className={`text-sm font-medium ${msg.ok ? 'text-green-700' : 'text-red-700'}`}>{msg.text}</span>}
              <button className="btn-primary px-6 py-3" disabled={!editable || busy || !dirty} onClick={save}>
                {busy ? 'Saving…' : submittedAt ? 'Update' : totals.pieces ? 'Submit' : 'Submit no sales'}
              </button>
            </div>
          </div>
        </>
      )}

      {!sellerId && msg && <p className="mt-3 text-sm text-red-700">{msg.text}</p>}
    </div>
  )
}

function Stepper({ label, sub, value, onChange, disabled }: {
  label: string; sub: string; value: number; onChange: (v: number) => void; disabled: boolean
}) {
  return (
    <div className={`rounded-lg border p-1.5 ${value > 0 ? 'border-brand-500 bg-brand-50' : 'border-stone-200'}`}>
      <div className="mb-1 flex items-baseline justify-between px-0.5">
        <span className="text-xs font-semibold">{label}</span>
        <span className="text-[10px] text-stone-400">{sub}</span>
      </div>
      <div className="flex items-center">
        <button
          type="button" disabled={disabled || value <= 0} onClick={() => onChange(value - 1)}
          className="h-9 w-9 shrink-0 rounded-md bg-stone-100 text-lg font-bold text-stone-600 disabled:opacity-30" aria-label={`Less ${label}`}
        >−</button>
        <input
          type="number" inputMode="numeric" min={0} disabled={disabled}
          className="h-9 w-full min-w-0 bg-transparent text-center text-base font-semibold outline-none"
          value={value === 0 ? '' : value} placeholder="0"
          onChange={(e) => onChange(Number(e.target.value))}
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button" disabled={disabled} onClick={() => onChange(value + 1)}
          className="h-9 w-9 shrink-0 rounded-md bg-stone-100 text-lg font-bold text-stone-600 disabled:opacity-30" aria-label={`More ${label}`}
        >+</button>
      </div>
    </div>
  )
}
