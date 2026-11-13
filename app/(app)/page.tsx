'use client'

import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { useProfile } from '@/components/ProfileContext'

export default function Home() {
  const profile = useProfile()
  const router = useRouter()
  useEffect(() => {
    router.replace(profile.role === 'seller' ? '/entry' : '/dashboard')
  }, [profile, router])
  return null
}
