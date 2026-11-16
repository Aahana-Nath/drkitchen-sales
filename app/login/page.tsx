'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { errMsg, normaliseEmail } from '@/lib/format'

export default function LoginPage() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const address = normaliseEmail(email)
    if (!address) return setError('Enter a valid email address')
    setBusy(true)
    try {
      const sb = supabase()
      const allowed = await sb.rpc('email_allowed', { p_email: address })
      if (allowed.error) throw allowed.error
      if (!allowed.data) {
        setError('This email is not registered. Ask your admin to add it.')
        return
      }
      const { error } = await sb.auth.signInWithOtp({ email: address })
      if (error) throw error
      setEmail(address)
      setStep('code')
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      const { error } = await supabase().auth.verifyOtp({ email, token: code.trim(), type: 'email' })
      if (error) throw error
      window.location.href = '/'
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-dvh items-center justify-center p-4">
      <div className="card w-full max-w-sm p-6">
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="DrKitchen" className="h-10 w-auto max-w-36 object-contain" />
          <div>
            <h1 className="text-lg font-bold">DrKitchen Sales</h1>
            <p className="text-sm text-stone-500">Daily sales report</p>
          </div>
        </div>

        {step === 'email' ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">Email address</label>
              <input
                id="email" type="email" required className="input text-base" inputMode="email" autoComplete="email"
                placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus
              />
            </div>
            <button className="btn-primary w-full py-3" disabled={busy}>{busy ? 'Sending…' : 'Get code'}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label className="label" htmlFor="code">Code sent to {email}</label>
              <input
                id="code" className="input text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code"
                minLength={6} maxLength={8} required pattern="[0-9]{6,8}" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus
              />
              <p className="mt-2 text-xs text-stone-500">Check your inbox and spam folder.</p>
            </div>
            <button className="btn-primary w-full py-3" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Log in'}</button>
            <button type="button" disabled={busy} className="w-full text-sm text-stone-500" onClick={() => { setStep('email'); setCode(''); setError(null) }}>
              Change email
            </button>
          </form>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  )
}
