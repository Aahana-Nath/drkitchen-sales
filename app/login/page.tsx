'use client'

import { useState } from 'react'
import { supabase } from '@/lib/supabase/client'
import { errMsg, normalisePhone } from '@/lib/format'

export default function LoginPage() {
  const [step, setStep] = useState<'phone' | 'code'>('phone')
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const e164 = () => '+' + normalisePhone(phone)

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!normalisePhone(phone)) return setError('Enter a 10-digit mobile number')
    setBusy(true)
    const { error } = await supabase().auth.signInWithOtp({ phone: e164() })
    setBusy(false)
    if (error) return setError(errMsg(error))
    setStep('code')
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const { error } = await supabase().auth.verifyOtp({ phone: e164(), token: code.trim(), type: 'sms' })
    setBusy(false)
    if (error) return setError(errMsg(error))
    window.location.href = '/'
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

        {step === 'phone' ? (
          <form onSubmit={sendCode} className="space-y-4">
            <div>
              <label className="label" htmlFor="phone">Mobile number</label>
              <div className="flex">
                <span className="flex items-center rounded-l-lg border border-r-0 border-stone-300 bg-stone-100 px-3 text-sm text-stone-600">+91</span>
                <input
                  id="phone" className="input rounded-l-none text-base" inputMode="numeric" autoComplete="tel-national"
                  placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus
                />
              </div>
            </div>
            <button className="btn-primary w-full py-3" disabled={busy}>{busy ? 'Sending…' : 'Get code'}</button>
          </form>
        ) : (
          <form onSubmit={verify} className="space-y-4">
            <div>
              <label className="label" htmlFor="code">Code sent to +91 {phone.replace(/\D/g, '').slice(-10)}</label>
              <input
                id="code" className="input text-center text-2xl tracking-[0.4em]" inputMode="numeric" autoComplete="one-time-code"
                maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} autoFocus
              />
            </div>
            <button className="btn-primary w-full py-3" disabled={busy || code.length < 6}>{busy ? 'Checking…' : 'Log in'}</button>
            <button type="button" className="w-full text-sm text-stone-500" onClick={() => { setStep('phone'); setCode('') }}>
              Change number
            </button>
          </form>
        )}

        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      </div>
    </main>
  )
}
