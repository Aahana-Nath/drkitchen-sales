'use client'

import { useState } from 'react'
import { Empty, ErrorNote, ProductPieChart } from '@/components/ui'
import { PACK_LABEL, type PackSize, type SkuSummary } from '@/lib/types'

export default function ProductSalesChart({ data, loading = false, error = null }: {
  data: SkuSummary[]
  loading?: boolean
  error?: string | null
}) {
  const [pack, setPack] = useState<PackSize | ''>('')
  const [spice, setSpice] = useState('')
  const products = [...new Set(data.map((row) => row.product_name))]
  const filtered = data.filter((row) => (!pack || row.pack_size === pack) && (!spice || row.product_name === spice))

  return (
    <>
      <div className="border-b border-stone-100 px-4 py-3">
        <div className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2">
          <label className="min-w-0">
            <span className="label">Pack size</span>
            <select className="h-8 w-full rounded-md border border-stone-300 bg-white px-2 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" value={pack} onChange={(e) => {
              const value = e.target.value
              setPack(value === 'rs10' || value === 'g50' || value === 'g100' ? value : '')
            }}>
              <option value="">All packs</option>
              <option value="rs10">{PACK_LABEL.rs10}</option>
              <option value="g50">{PACK_LABEL.g50}</option>
              <option value="g100">{PACK_LABEL.g100}</option>
            </select>
          </label>
          <label className="min-w-0">
            <span className="label">Spice</span>
            <select className="h-8 w-full rounded-md border border-stone-300 bg-white px-2 text-xs outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100" value={spice} onChange={(e) => setSpice(e.target.value)}>
              <option value="">All spices</option>
              {products.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>
        </div>
      </div>
      {error ? <div className="px-3 pb-3"><ErrorNote text={error} /></div>
        : loading ? <Empty>Loading product sales…</Empty>
          : <ProductPieChart data={filtered} />}
    </>
  )
}