import http from 'node:http'
import crypto from 'node:crypto'
import { createRequire } from 'node:module'
const require = createRequire('/home/claude/drkitchen-sales/package.json')
const { createClient } = require('@supabase/supabase-js')

const SECRET = 'super-secret-jwt-token-with-at-least-32-characters-long'
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (claims) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ ...claims, exp: Math.floor(Date.now()/1000)+3600 })
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}` }

// proxy: /rest/v1/* -> postgrest
const srv = http.createServer((req, res) => {
  const p = http.request({ host: '127.0.0.1', port: 3001, path: req.url.replace(/^\/rest\/v1/, ''), method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res) })
  req.pipe(p)
}).listen(8001)

const anon = jwt({ role: 'anon' })
const as = (sub) => createClient('http://127.0.0.1:8001', anon, { global: { headers: { Authorization: 'Bearer ' + jwt({ role: 'authenticated', sub }) } }, auth: { persistSession: false } })
const GOVIND = as('00000000-0000-0000-0000-000000000001'), ASHISH = as('00000000-0000-0000-0000-000000000011')
const ADMIN = as('00000000-0000-0000-0000-000000000099'), RM = as('00000000-0000-0000-0000-000000000050')

let fails = 0
const ok = (label, cond, extra='') => { if (!cond) fails++; console.log(cond ? '  ✓' : '  ✗', label, extra) }
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())
const mstart = today.slice(0,8)+'01'

// --- loadMyProfile
const { data: { } = {} } = {}
const prof = async (c, uid) => (await c.from('profiles').select('*, regions(name)').eq('auth_user_id', uid).eq('is_active', true).maybeSingle())
const gp = await prof(GOVIND, '00000000-0000-0000-0000-000000000001')
ok('loadMyProfile seller', gp.data?.full_name === 'Govind' && gp.data?.regions?.name === 'Delhi', gp.error?.message ?? '')
const govId = gp.data.id

// --- loadSkus / prices / settings
const sk = await GOVIND.from('skus').select('id, code, pack_size, sort_order, is_active, product:products(id, name, sort_order)').eq('is_active', true)
ok('loadSkus', sk.data?.length === 36 && sk.data[0].product?.name, sk.error?.message ?? '')
const pr = await GOVIND.from('sku_prices').select('sku_id, effective_from, mrp, retailer_basic_cost').order('effective_from', { ascending: false })
ok('loadPrices', pr.data?.length === 36, pr.error?.message ?? '')
const st = await GOVIND.from('app_settings').select('value').eq('key', 'seller_edit_cutoff_hour').maybeSingle()
ok('loadSetting', Number(st.data?.value) === 12, JSON.stringify(st.data))

// --- entry: save + reload
const byCode = Object.fromEntries(sk.data.map(s => [s.code, s.id]))
const lines = sk.data.map(s => ({ sku_id: s.id, quantity: s.code === 'TUR-P-10' ? 12 : s.code === 'AJW-S-100' ? 2 : 0 }))
const sv = await GOVIND.rpc('save_daily_report', { p_date: today, p_lines: lines, p_remarks: 'test', p_seller: null })
ok('save_daily_report seller', !sv.error && sv.data, sv.error?.message ?? '')
const rep = await GOVIND.from('daily_reports').select('id, remarks, submitted_at, daily_report_lines(sku_id, quantity)').eq('seller_id', govId).eq('report_date', today).maybeSingle()
ok('reload report w/ lines', rep.data?.daily_report_lines?.length === 2 && rep.data.remarks === 'test', rep.error?.message ?? JSON.stringify(rep.data?.daily_report_lines))
const old = await GOVIND.rpc('save_daily_report', { p_date: '2026-11-01', p_lines: lines, p_remarks: null, p_seller: null })
ok('seller old date blocked', !!old.error, old.error?.message)

const sv2 = await ASHISH.rpc('save_daily_report', { p_date: today, p_lines: [{ sku_id: byCode['TUR-P-10'], quantity: 40 }, { sku_id: byCode['TUR-P-100'], quantity: 4 }], p_remarks: null, p_seller: null })
ok('ashish save', !sv2.error, sv2.error?.message ?? '')

// --- RM: sellers list, backfill, edit other region
const rs = await RM.from('profiles').select('*, regions(name)').eq('role', 'seller').order('full_name')
ok('RM sees only Delhi sellers', rs.data?.length === 4 && rs.data.every(s => s.regions.name === 'Delhi'), rs.data?.map(s=>s.full_name).join(','))
const umesh = rs.data.find(s => s.full_name === 'Umesh Kumar').id
const bf = await RM.rpc('save_daily_report', { p_date: '2026-11-03', p_lines: [{ sku_id: byCode['COR-P-50'], quantity: 7 }], p_remarks: 'by RM', p_seller: umesh })
ok('RM backfill own region', !bf.error, bf.error?.message ?? '')
const ashishId = (await ADMIN.from('profiles').select('id').eq('full_name', 'Ashish').single()).data.id
const x = await RM.rpc('save_daily_report', { p_date: today, p_lines: [{ sku_id: byCode['TUR-P-10'], quantity: 1 }], p_remarks: null, p_seller: ashishId })
ok('RM other region blocked', !!x.error, x.error?.message)

// --- dashboard RPCs
const args = { p_from: mstart, p_to: today, p_region: null, p_seller: null }
const s1 = await ADMIN.rpc('report_seller_summary', args)
const a = s1.data?.find(r => r.seller_name === 'Ashish')
ok('summary (admin)', s1.data?.length === 12 && Number(a.sales_value) === 463.49, s1.error?.message ?? `${s1.data?.length} rows, ashish ${a?.sales_value}`)
const s2 = await RM.rpc('report_seller_summary', args)
ok('summary (RM scoped)', s2.data?.length === 4, `${s2.data?.length}`)
const s3 = await GOVIND.rpc('report_seller_summary', { p_from: mstart, p_to: today, p_seller: govId })
ok('summary (seller self)', s3.data?.length === 1 && Number(s3.data[0].pieces) === 14, s3.error?.message ?? JSON.stringify(s3.data?.[0]?.pieces))
const d1 = await ADMIN.rpc('report_daily_series', args)
ok('daily series', d1.data?.length === Number(today.slice(8)), d1.error?.message ?? `${d1.data?.length}`)
const k1 = await ADMIN.rpc('report_sku_summary', args)
ok('sku summary', k1.data?.length === 36, k1.error?.message ?? '')
const m1 = await ADMIN.rpc('report_missing_submissions', { p_date: today, p_region: null })
ok('missing submissions', m1.data?.length === 10, m1.error?.message ?? `${m1.data?.length}`)
const g1 = await RM.rpc('report_seller_month_grid', { p_seller: umesh, p_month: mstart })
ok('month grid', g1.data?.length === 1 && g1.data[0].day === 3 && g1.data[0].quantity === 7, g1.error?.message ?? JSON.stringify(g1.data))
const v1 = await ADMIN.from('v_daily_seller_totals').select('*').gte('report_date', mstart).lte('report_date', today)
ok('v_daily_seller_totals', v1.data?.length === 3, v1.error?.message ?? `${v1.data?.length}`)
const v2 = await ADMIN.from('v_sales_lines').select('report_date, seller_name, region_name, product_name, sku_code, pack_size, quantity, unit_mrp, unit_rbc, line_value').range(0, 999)
ok('v_sales_lines export', v2.data?.length === 5, v2.error?.message ?? `${v2.data?.length}`)
const v3 = await GOVIND.from('v_sales_lines').select('seller_name')
ok('seller sees only own lines', v3.data?.every(r => r.seller_name === 'Govind'), JSON.stringify(v3.data))

// --- admin users + prices
const ins = await ADMIN.from('profiles').insert({ full_name: 'Jaiveer Singh', phone: '919718886505', role: 'regional_manager', region_id: 2, is_active: true })
ok('admin add user', !ins.error, ins.error?.message ?? '')
const dup = await ADMIN.from('profiles').insert({ full_name: 'Dup', phone: '919718886505', role: 'seller', region_id: 2, is_active: true })
ok('duplicate phone rejected', dup.error?.message.includes('profiles_phone_key'), dup.error?.message)
const sellerIns = await GOVIND.from('profiles').insert({ full_name: 'Hacker', role: 'superadmin' })
ok('seller cannot add user', !!sellerIns.error, sellerIns.error?.message)
// phone change unlinks
await ADMIN.from('profiles').update({ phone: '919111111111' }).eq('full_name', 'Govind')
const relinked = await ADMIN.from('profiles').select('auth_user_id').eq('full_name', 'Govind').single()
ok('phone change logs out old login', relinked.data.auth_user_id === null, JSON.stringify(relinked.data))
const gAfter = await prof(GOVIND, '00000000-0000-0000-0000-000000000001')
ok('old login sees no profile', gAfter.data === null)
await ADMIN.from('profiles').update({ phone: '919000000001' }).eq('full_name', 'Govind')
const back = await ADMIN.from('profiles').select('auth_user_id').eq('full_name', 'Govind').single()
ok('phone back relinks', back.data.auth_user_id === '00000000-0000-0000-0000-000000000001')

const tomorrow = new Date(Date.now()+86400000).toISOString().slice(0,10)
const pu = await ADMIN.from('sku_prices').upsert({ sku_id: byCode['TUR-P-10'], effective_from: tomorrow, mrp: 12, retailer_basic_cost: Math.round(12/1.26*1e6)/1e6 }, { onConflict: 'sku_id,effective_from' })
ok('admin price change', !pu.error, pu.error?.message ?? '')
const pu2 = await RM.from('sku_prices').insert({ sku_id: byCode['TUR-P-10'], effective_from: '2027-01-01', mrp: 1, retailer_basic_cost: 1 })
ok('RM cannot change price', !!pu2.error)
const hide = await ADMIN.from('skus').update({ is_active: false }).eq('code', 'KM-S-100').select()
ok('admin hide sku', hide.data?.length === 1, hide.error?.message ?? '')

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED')
srv.close(); process.exit(fails ? 1 : 0)
