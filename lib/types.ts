export type Role = 'seller' | 'regional_manager' | 'superadmin'
export type PackSize = 'rs10' | 'g50' | 'g100'

export const PACK_LABEL: Record<PackSize, string> = { rs10: '₹10', g50: '50g', g100: '100g' }
export const ROLE_LABEL: Record<Role, string> = {
  seller: 'Seller',
  regional_manager: 'Regional manager',
  superadmin: 'Superadmin',
}

export interface Region { id: number; code: string; name: string }

export interface Profile {
  id: string
  auth_user_id: string | null
  full_name: string
  phone: string | null
  role: Role
  region_id: number | null
  is_active: boolean
  regions?: { name: string } | null
}

export interface Sku {
  id: number
  code: string
  pack_size: PackSize
  sort_order: number
  is_active: boolean
  product: { id: number; name: string; sort_order: number }
}

export interface SkuPrice {
  sku_id: number
  effective_from: string
  mrp: number
  retailer_basic_cost: number
}

export interface SellerSummary {
  seller_id: string
  seller_name: string
  region_id: number
  region_name: string
  days_reported: number
  days_with_sales: number
  pieces: number
  sales_value: number
  value_share: number
  pieces_per_sales_day: number
  value_per_sales_day: number
  rank_by_value: number | null
  low_value_days: number
  rs10_pieces: number; g50_pieces: number; g100_pieces: number
  rs10_value: number; g50_value: number; g100_value: number
}

export interface DailyPoint { report_date: string; sellers_reported: number; pieces: number; sales_value: number }
export interface SkuSummary { product_name: string; sku_code: string; pack_size: PackSize; pieces: number; sales_value: number }
export interface MissingSeller { seller_id: string; seller_name: string; phone: string | null; region_name: string }

export interface DailyTotal {
  report_id: number
  report_date: string
  seller_id: string
  seller_name: string
  region_name: string
  remarks: string | null
  submitted_at: string
  pieces: number
  sales_value: number
}
