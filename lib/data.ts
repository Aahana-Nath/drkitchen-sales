import { supabase } from './supabase/client'
import type { Profile, Region, Sku, SkuPrice } from './types'
import { DEMO_MANAGER, DEMO_PRICES, DEMO_REGIONS, DEMO_SELLERS, DEMO_SKUS, isDemoMode } from './demo'

export async function loadMyProfile(): Promise<Profile | null> {
  if (isDemoMode) return DEMO_MANAGER
  const sb = supabase()
  const { data: { user } } = await sb.auth.getUser()
  if (!user) return null
  const { data, error } = await sb
    .from('profiles')
    .select('*, regions(name)')
    .eq('auth_user_id', user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (error) throw error
  return data as Profile | null
}

export async function loadSkus(includeInactive = false): Promise<Sku[]> {
  if (isDemoMode) return DEMO_SKUS.filter((sku) => includeInactive || sku.is_active)
  let q = supabase()
    .from('skus')
    .select('id, code, pack_size, sort_order, is_active, product:products(id, name, sort_order)')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw error
  return (data as unknown as Sku[]).sort(
    (a, b) => a.product.sort_order - b.product.sort_order || a.sort_order - b.sort_order,
  )
}

export async function loadPrices(): Promise<SkuPrice[]> {
  if (isDemoMode) return DEMO_PRICES
  const { data, error } = await supabase()
    .from('sku_prices')
    .select('sku_id, effective_from, mrp, retailer_basic_cost')
    .order('effective_from', { ascending: false })
  if (error) throw error
  return (data as SkuPrice[]).map((p) => ({ ...p, mrp: Number(p.mrp), retailer_basic_cost: Number(p.retailer_basic_cost) }))
}

/** Price in force for a SKU on a date (prices sorted newest first). */
export function priceOn(prices: SkuPrice[], skuId: number, date: string): SkuPrice | undefined {
  return prices.find((p) => p.sku_id === skuId && p.effective_from <= date)
}

export async function loadRegions(): Promise<Region[]> {
  if (isDemoMode) return DEMO_REGIONS
  const { data, error } = await supabase().from('regions').select('id, code, name').eq('is_active', true).order('name')
  if (error) throw error
  return data as Region[]
}

/** Sellers visible to the caller (RLS scopes: RM → own region, superadmin → all). */
export async function loadSellers(regionId?: number | null): Promise<Profile[]> {
  if (isDemoMode) return DEMO_SELLERS.filter((seller) => !regionId || seller.region_id === regionId)
  let q = supabase().from('profiles').select('*, regions(name)').eq('role', 'seller').order('full_name')
  if (regionId) q = q.eq('region_id', regionId)
  const { data, error } = await q
  if (error) throw error
  return data as Profile[]
}

export async function loadSetting<T>(key: string, fallback: T): Promise<T> {
  if (isDemoMode) return fallback
  const { data } = await supabase().from('app_settings').select('value').eq('key', key).maybeSingle()
  return (data?.value as T) ?? fallback
}
