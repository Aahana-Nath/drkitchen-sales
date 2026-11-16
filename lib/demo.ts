import { addDays, todayIST } from '@/lib/format'
import type { DailyPoint, MissingSeller, Profile, Region, SellerSummary, Sku, SkuPrice, SkuSummary } from '@/lib/types'

export const isDemoMode =
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_LOCAL_DEMO_MODE === 'true'

export const DEMO_REGIONS: Region[] = [{ id: 1, code: 'DELHI', name: 'Delhi' }]

export const DEMO_SELLERS: Profile[] = ['Govind', 'Naveen', 'Jaspal Singh', 'Umesh Kumar'].map((full_name, index) => ({
  id: ['demo-govind', 'demo-naveen', 'demo-jaspal', 'demo-umesh'][index],
  auth_user_id: null, full_name, phone: null, email: `seller${index + 1}@example.com`, role: 'seller', region_id: 1,
  is_active: true, regions: { name: 'Delhi' },
}))

export const DEMO_MANAGER: Profile = {
  id: 'demo-manager', auth_user_id: null, full_name: 'Demo Manager', phone: null, email: 'manager@example.com',
  role: 'regional_manager', region_id: 1, is_active: true, regions: { name: 'Delhi' },
}

const products: { code: string; name: string; mrps: number[] }[] = [
  { code: 'TUR-P', name: 'Turmeric Powder', mrps: [10, 25, 46] },
  { code: 'RCH-P', name: 'Red Chilli Powder', mrps: [10, 35, 65] },
  { code: 'COR-P', name: 'Coriander Powder', mrps: [10, 24, 42] },
  { code: 'GRM-B', name: 'Garam Masala Powder', mrps: [10, 55, 106] },
  { code: 'KK-B', name: 'Kitchen King Masala', mrps: [10, 50, 96] },
  { code: 'JR-S', name: 'Cumin Seeds', mrps: [10, 35, 66] },
  { code: 'JR-P', name: 'Cumin Powder', mrps: [10, 50, 96] },
  { code: 'MET-S', name: 'Methi Dana', mrps: [10, 20, 36] },
  { code: 'SAR-S', name: 'Black Mustard Seeds', mrps: [10, 20, 36] },
  { code: 'YM-S', name: 'Yellow Mustard Seeds', mrps: [10, 20, 36] },
  { code: 'KM-S', name: 'Whole Black Pepper', mrps: [10, 95, 180] },
  { code: 'AJW-S', name: 'Ajwain', mrps: [10, 30, 56] },
]

export const DEMO_SKUS: Sku[] = products.flatMap((product, index) =>
  (['rs10', 'g50', 'g100'] as const).map((pack_size, packIndex) => ({
    id: (index + 1) * 10 + packIndex + 1,
    code: `${product.code}-${[10, 50, 100][packIndex]}`,
    pack_size, sort_order: packIndex + 1, is_active: true,
    product: { id: index + 1, name: product.name, sort_order: (index + 1) * 10 },
  })),
)

export const DEMO_PRICES: SkuPrice[] = DEMO_SKUS.map((sku, index) => {
  const mrp = products[Math.floor(index / 3)].mrps[index % 3]
  return { sku_id: sku.id, effective_from: '2026-11-01', mrp, retailer_basic_cost: Math.round(mrp / 1.26 * 100) / 100 }
})

export function demoSummaries(): SellerSummary[] {
  const values = [32750, 29100, 24800, 20500]
  const total = values.reduce((sum, value) => sum + value, 0)
  return DEMO_SELLERS.map((seller, index) => {
    const sales_value = values[index]
    const days = [23, 22, 20, 18][index]
    const pieces = [1480, 1315, 1100, 940][index]
    const rs10 = [430, 390, 340, 300][index]
    const g50 = [650, 570, 470, 400][index]
    return {
      seller_id: seller.id, seller_name: seller.full_name, region_id: 1, region_name: 'Delhi',
      days_reported: days, days_with_sales: days, pieces, sales_value,
      value_share: sales_value / total, pieces_per_sales_day: pieces / days,
      value_per_sales_day: sales_value / days, rank_by_value: index + 1, low_value_days: index === 3 ? 2 : 1,
      rs10_pieces: rs10, g50_pieces: g50, g100_pieces: pieces - rs10 - g50,
      rs10_value: Math.round(sales_value * 0.2), g50_value: Math.round(sales_value * 0.42),
      g100_value: Math.round(sales_value * 0.38),
    }
  })
}

export function demoDailySeries(from: string, to: string): DailyPoint[] {
  const today = todayIST()
  const out: DailyPoint[] = []
  for (let d = from; d <= to && d <= today; d = addDays(d, 1)) {
    const index = Number(d.slice(8))
    out.push({
      report_date: d,
      sellers_reported: 3 + (index % 2),
      pieces: 540 + (index % 7) * 37,
      sales_value: 11800 + (index % 7) * 720,
    })
  }
  return out
}

export function demoSkuSummary(sellerId?: string, from = '1900-01-01', to = todayIST()): SkuSummary[] {
  const sellers = DEMO_SELLERS.filter((seller) => !sellerId || seller.id === sellerId)
  const dates = Array.from({ length: 30 }, (_, index) => addDays(todayIST(), index - 29))
    .filter((date) => date >= from && date <= to)
  return DEMO_SKUS.map((sku, index) => {
    const pieces = sellers.reduce((total, seller) => {
      const sellerIndex = DEMO_SELLERS.indexOf(seller)
      return total + dates.reduce((sum, date) =>
        sum + 1 + ((index * 7 + sellerIndex * 11 + Number(date.slice(8))) % 15), 0)
    }, 0)
    return {
      product_name: sku.product.name, sku_code: sku.code, pack_size: sku.pack_size,
      pieces, sales_value: Math.round(pieces * DEMO_PRICES[index].retailer_basic_cost * 100) / 100,
    }
  })
}

export function demoMissingSellers(): MissingSeller[] {
  const seller = DEMO_SELLERS[3]
  return [{ seller_id: seller.id, seller_name: seller.full_name, phone: seller.phone, region_name: 'Delhi' }]
}

export interface DemoReport {
  quantities: Record<number, number>
  remarks: string
  submittedAt: string | null
}

const reportKey = (sellerId: string, date: string) => `drkitchen-demo-report:${sellerId}:${date}`

export function readDemoReport(sellerId: string, date: string): DemoReport {
  const raw = localStorage.getItem(reportKey(sellerId, date))
  if (raw) return JSON.parse(raw) as DemoReport
  return {
    quantities: sellerId === DEMO_SELLERS[0].id && date === todayIST()
      ? { [DEMO_SKUS[0].id]: 12, [DEMO_SKUS[4].id]: 6, [DEMO_SKUS[8].id]: 4 } : {},
    remarks: '', submittedAt: null,
  }
}

export function saveDemoReport(sellerId: string, date: string, report: DemoReport): void {
  localStorage.setItem(reportKey(sellerId, date), JSON.stringify(report))
}