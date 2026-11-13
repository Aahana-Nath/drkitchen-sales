'use client'

import { useEffect, useState } from 'react'
import { ErrorNote, Section } from '@/components/ui'
import { loadPrices, loadSetting, loadSkus, priceOn } from '@/lib/data'
import { supabase } from '@/lib/supabase/client'
import { addDays, errMsg, inr, niceDate, todayIST } from '@/lib/format'
import { PACK_LABEL, type Sku, type SkuPrice } from '@/lib/types'

export default function PricesAdmin() {
  const today = todayIST()
  const [skus, setSkus] = useState<Sku[]>([])
  const [prices, setPrices] = useState<SkuPrice[]>([])
  const [factor, setFactor] = useState(1.26)
  const [edit, setEdit] = useState<{ sku: Sku; mrp: string; from: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    try {
      const [s, p, f] = await Promise.all([loadSkus(true), loadPrices(), loadSetting<number>('mrp_to_basic_cost_factor', 1.26)])
      setSkus(s); setPrices(p); setFactor(Number(f))
    } catch (e) { setError(errMsg(e)) }
  }
  useEffect(() => { load() }, [])

  async function savePrice(e: React.FormEvent) {
    e.preventDefault()
    if (!edit) return
    const mrp = Number(edit.mrp)
    if (!(mrp > 0)) return setError('Enter a valid MRP')
    setBusy(true)
    setError(null)
    const { error } = await supabase().from('sku_prices').upsert({
      sku_id: edit.sku.id,
      effective_from: edit.from,
      mrp,
      retailer_basic_cost: Math.round((mrp / factor) * 1e6) / 1e6,
    }, { onConflict: 'sku_id,effective_from' })
    setBusy(false)
    if (error) return setError(errMsg(error))
    setEdit(null)
    load()
  }

  async function toggleActive(s: Sku) {
    const { error } = await supabase().from('skus').update({ is_active: !s.is_active }).eq('id', s.id)
    if (error) return setError(errMsg(error))
    load()
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Products & prices</h1>
        <p className="text-sm text-stone-500">
          Retailer basic cost = MRP ÷ {factor}. A new price applies to sales from its start date; past sales keep the price they were entered at.
        </p>
      </div>
      <ErrorNote text={error} />

      {edit && (
        <form onSubmit={savePrice} className="card flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <div className="label">SKU</div>
            <div className="font-medium">{edit.sku.product.name} {PACK_LABEL[edit.sku.pack_size]} <span className="font-mono text-xs text-stone-400">{edit.sku.code}</span></div>
          </div>
          <div><label className="label">New MRP ₹</label>
            <input className="input w-28" inputMode="decimal" value={edit.mrp} onChange={(e) => setEdit({ ...edit, mrp: e.target.value })} autoFocus /></div>
          <div><label className="label">Applies from</label>
            <input type="date" className="input" value={edit.from} onChange={(e) => e.target.value && setEdit({ ...edit, from: e.target.value })} /></div>
          <div className="text-sm text-stone-500">Basic cost {inr(Number(edit.mrp) / factor || 0, 2)}</div>
          <div className="flex gap-2">
            <button type="button" className="btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save price'}</button>
          </div>
        </form>
      )}

      <Section title={`${skus.length} SKUs`}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-stone-50">
              <tr><th className="th">Product</th><th className="th">Pack</th><th className="th">Code</th><th className="th text-right">MRP</th>
                <th className="th text-right">Basic cost</th><th className="th">Since</th><th className="th">Next change</th><th className="th">Status</th><th className="th" /></tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {skus.map((s) => {
                const cur = priceOn(prices, s.id, today)
                const next = prices.filter((p) => p.sku_id === s.id && p.effective_from > today).sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
                return (
                  <tr key={s.id} className={s.is_active ? '' : 'text-stone-400'}>
                    <td className="td font-medium">{s.product.name}</td>
                    <td className="td">{PACK_LABEL[s.pack_size]}</td>
                    <td className="td font-mono text-xs">{s.code}</td>
                    <td className="td text-right">{inr(cur?.mrp, 2)}</td>
                    <td className="td text-right">{inr(cur?.retailer_basic_cost, 2)}</td>
                    <td className="td text-stone-500">{cur ? niceDate(cur.effective_from, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
                    <td className="td text-stone-500">{next ? `${inr(next.mrp)} from ${niceDate(next.effective_from)}` : ''}</td>
                    <td className="td"><button onClick={() => toggleActive(s)} className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.is_active ? 'bg-green-100 text-green-800' : 'bg-stone-200 text-stone-600'}`}>{s.is_active ? 'Active' : 'Hidden'}</button></td>
                    <td className="td text-right">
                      <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setEdit({ sku: s, mrp: String(cur?.mrp ?? ''), from: addDays(today, 1) })}>Change price</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}
