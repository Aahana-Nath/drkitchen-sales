'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ProfileContext } from '@/components/ProfileContext'
import { loadMyProfile } from '@/lib/data'
import { supabase } from '@/lib/supabase/client'
import { errMsg } from '@/lib/format'
import { ROLE_LABEL, type Profile, type Role } from '@/lib/types'
import { DEMO_MANAGER, DEMO_SELLERS, isDemoMode } from '@/lib/demo'

const NAV: Record<Role, { href: string; label: string }[]> = {
  seller: [
    { href: '/entry', label: 'Enter sales' },
    { href: '/me', label: 'My sales' },
  ],
  regional_manager: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/entry', label: 'Edit entry' },
  ],
  superadmin: [
    { href: '/dashboard', label: 'Dashboard' },
    { href: '/entry', label: 'Edit entry' },
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/prices', label: 'Prices' },
  ],
}

// Which roles may open which section (DB rules enforce data access regardless)
const ALLOWED: { prefix: string; roles: Role[] }[] = [
  { prefix: '/me', roles: ['seller'] },
  { prefix: '/dashboard', roles: ['regional_manager', 'superadmin'] },
  { prefix: '/admin', roles: ['superadmin'] },
]

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'unregistered' | 'error'>('loading')
  const [error, setError] = useState('')
  const pathname = usePathname()
  const router = useRouter()

  useEffect(() => {
    if (isDemoMode) {
      const demoRole = localStorage.getItem('drkitchen-demo-role')
      setProfile(demoRole === 'seller' ? DEMO_SELLERS[0] : DEMO_MANAGER)
      setState('ready')
      return
    }
    loadMyProfile()
      .then((p) => {
        if (!p) return setState('unregistered')
        setProfile(p)
        setState('ready')
      })
      .catch((e) => { setError(errMsg(e)); setState('error') })
  }, [])

  useEffect(() => {
    if (!profile) return
    const rule = ALLOWED.find((r) => pathname.startsWith(r.prefix))
    if (rule && !rule.roles.includes(profile.role)) router.replace('/')
  }, [profile, pathname, router])

  async function logout() {
    if (isDemoMode) return
    await supabase().auth.signOut()
    window.location.href = '/login'
  }

  function switchDemoRole(role: 'seller' | 'regional_manager') {
    const nextProfile = role === 'seller' ? DEMO_SELLERS[0] : DEMO_MANAGER
    localStorage.setItem('drkitchen-demo-role', role)
    setProfile(nextProfile)
    router.replace(role === 'seller' ? '/entry' : '/dashboard')
  }

  if (state === 'loading') {
    return <div className="flex min-h-dvh items-center justify-center text-stone-400">Loading…</div>
  }
  if (state !== 'ready' || !profile) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-4">
        <div className="card max-w-sm p-6 text-center">
          <h1 className="mb-2 font-semibold">{state === 'unregistered' ? 'Number not registered' : 'Could not load your account'}</h1>
          <p className="mb-4 text-sm text-stone-500">
            {state === 'unregistered' ? 'Ask your admin to add your mobile number.' : error}
          </p>
          <button className="btn-ghost" onClick={logout}>Log out</button>
        </div>
      </div>
    )
  }

  const nav = NAV[profile.role]

  return (
    <ProfileContext.Provider value={profile}>
      <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-2.5">
          <Link href="/" className="flex shrink-0 items-center gap-2">
            <img src="/logo.png" alt="" className="h-8 w-auto max-w-28 object-contain" />
            <span className="hidden font-bold sm:inline">DrKitchen Sales</span>
          </Link>
          <nav className="flex flex-1 gap-1 overflow-x-auto">
            {nav.map((n) => (
              <Link
                key={n.href} href={n.href}
                className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium ${
                  pathname.startsWith(n.href) ? 'bg-brand-50 text-brand-700' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          {isDemoMode && (
            <label className="flex shrink-0 items-center gap-2 text-xs text-amber-800">
              <span className="hidden sm:inline">Preview as</span>
              <select
                className="rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 font-medium"
                value={profile.role}
                onChange={(e) => switchDemoRole(e.target.value === 'seller' ? 'seller' : 'regional_manager')}
                aria-label="Preview as"
              >
                <option value="regional_manager">Manager</option>
                <option value="seller">Seller</option>
              </select>
            </label>
          )}
          <div className="hidden text-right text-xs leading-tight md:block">
            <div className="font-semibold">{profile.full_name}</div>
            <div className="text-stone-500">{ROLE_LABEL[profile.role]}{profile.regions?.name ? ` · ${profile.regions.name}` : ''}</div>
          </div>
          {isDemoMode ? (
            <span className="hidden shrink-0 text-xs text-amber-700 sm:inline">Local demo · no SMS or database writes</span>
          ) : (
            <button onClick={logout} className="shrink-0 rounded-lg px-2 py-1.5 text-sm text-stone-500 hover:bg-stone-100">Log out</button>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4 pb-28">{children}</main>
    </ProfileContext.Provider>
  )
}
