'use client'

import { createContext, useContext } from 'react'
import type { Profile } from '@/lib/types'

export const ProfileContext = createContext<Profile | null>(null)

export function useProfile(): Profile {
  const p = useContext(ProfileContext)
  if (!p) throw new Error('useProfile outside app shell')
  return p
}
