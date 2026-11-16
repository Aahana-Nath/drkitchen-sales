'use client'

import { useEffect, useMemo, useState } from 'react'
import { Empty, ErrorNote, Section } from '@/components/ui'
import { loadRegions } from '@/lib/data'
import { supabase } from '@/lib/supabase/client'
import { displayPhone, errMsg, normaliseEmail, normalisePhone } from '@/lib/format'
import { ROLE_LABEL, type Profile, type Region, type Role } from '@/lib/types'

interface Form { id?: string; full_name: string; email: string; phone: string; role: Role; region_id: string; is_active: boolean }
const EMPTY: Form = { full_name: '', email: '', phone: '', role: 'seller', region_id: '', is_active: true }

export default function UsersAdmin() {
  const [users, setUsers] = useState<Profile[]>([])
  const [regions, setRegions] = useState<Region[]>([])
  const [form, setForm] = useState<Form | null>(null)
  const [filter, setFilter] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const { data, error } = await supabase().from('profiles').select('*, regions(name)').order('role').order('full_name')
    if (error) return setError(errMsg(error))
    setUsers(data as Profile[])
  }
  useEffect(() => { load(); loadRegions().then(setRegions).catch(() => {}) }, [])

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase()
    return users.filter((u) => (showInactive || u.is_active) &&
      (!q || u.full_name.toLowerCase().includes(q) || (u.email ?? '').includes(q) || (u.phone ?? '').includes(q.replace(/\D/g, '') || '~') || (u.regions?.name ?? '').toLowerCase().includes(q)))
  }, [users, filter, showInactive])

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!form) return
    setError(null)
    const email = normaliseEmail(form.email)
    if (!email) return setError('Enter a valid login email address')
    const phone = form.phone.trim() ? normalisePhone(form.phone) : null
    if (form.phone.trim() && !phone) return setError('Phone must be a 10-digit Indian mobile number')
    if (form.role !== 'superadmin' && !form.region_id) return setError('Pick a region')
    const row = {
      full_name: form.full_name.trim(),
      email,
      phone,
      role: form.role,
      region_id: form.role === 'superadmin' ? (form.region_id ? Number(form.region_id) : null) : Number(form.region_id),
      is_active: form.is_active,
    }
    setBusy(true)
    const sb = supabase()
    const { error } = form.id ? await sb.from('profiles').update(row).eq('id', form.id) : await sb.from('profiles').insert(row)
    setBusy(false)
    if (error) return setError(error.message.includes('profiles_email_key') ? 'That email is already used by someone else' : error.message.includes('profiles_phone_key') ? 'That phone number is already used by someone else' : errMsg(error))
    setForm(null)
    load()
  }

  function edit(u: Profile) {
    setForm({ id: u.id, full_name: u.full_name, email: u.email ?? '', phone: u.phone ? u.phone.slice(-10) : '', role: u.role, region_id: u.region_id ? String(u.region_id) : '', is_active: u.is_active })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-bold">Users</h1>
        <button className="btn-primary" onClick={() => setForm({ ...EMPTY })}>Add user</button>
      </div>
      <ErrorNote text={error} />

      {form && (
        <form onSubmit={save} className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2"><label className="label">Name</label>
            <input className="input" required value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="lg:col-span-2"><label className="label" htmlFor="user-email">Email (login)</label>
            <input id="user-email" className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div><label className="label">Mobile (optional)</label>
            <input className="input" inputMode="numeric" placeholder="9876543210" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
          <div><label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
              {(Object.keys(ROLE_LABEL) as Role[]).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select></div>
          <div><label className="label">Region</label>
            <select className="input" value={form.region_id} onChange={(e) => setForm({ ...form, region_id: e.target.value })}>
              <option value="">{form.role === 'superadmin' ? 'All (none)' : 'Choose…'}</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select></div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.is_active} onChange={(e) => setForm({ ...form, is_active: e.target.checked })} /> Active (can log in)
          </label>
          <div className="flex gap-2 sm:col-span-2 lg:col-span-4 lg:justify-end">
            <button type="button" className="btn-ghost" onClick={() => setForm(null)}>Cancel</button>
            <button className="btn-primary" disabled={busy}>{busy ? 'Saving…' : form.id ? 'Save changes' : 'Add user'}</button>
          </div>
          {form.id && <p className="text-xs text-stone-500 sm:col-span-2 lg:col-span-5">Changing the email removes the old login's access to this profile. Deactivate instead of deleting — past sales stay intact.</p>}
        </form>
      )}

      <Section title={`${shown.length} users`} right={
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-stone-600"><input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive</label>
          <input className="input w-44 py-1.5" placeholder="Search" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
      }>
        {shown.length ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-stone-50"><tr><th className="th">Name</th><th className="th">Email</th><th className="th">Mobile</th><th className="th">Role</th><th className="th">Region</th><th className="th">Login</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {shown.map((u) => (
                  <tr key={u.id} className={u.is_active ? '' : 'text-stone-400'}>
                    <td className="td font-medium">{u.full_name}{!u.is_active && ' (inactive)'}</td>
                    <td className="td">{u.email ?? '—'}</td>
                    <td className="td">{displayPhone(u.phone)}</td>
                    <td className="td">{ROLE_LABEL[u.role]}</td>
                    <td className="td">{u.regions?.name ?? (u.role === 'superadmin' ? 'All' : '—')}</td>
                    <td className="td">{u.auth_user_id ? <span className="text-green-700">Linked login</span> : <span className="text-stone-400">{u.email ? 'Not yet' : 'No email'}</span>}</td>
                    <td className="td text-right"><button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => edit(u)}>Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No users</Empty>}
      </Section>
    </div>
  )
}
