'use client'

import { createContext, useContext, useState, ReactNode } from 'react'

type SnowContextType = {
  snowEnabled: boolean
  setSnowEnabled: (enabled: boolean) => void
}

const SnowContext = createContext<SnowContextType | undefined>(undefined)

export function SnowProvider({ children }: { children: ReactNode }) {
  const [snowEnabled, setSnowEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('snow-enabled') === 'true'
  })

  // Save to localStorage when changed
  const handleSetSnowEnabled = (enabled: boolean) => {
    setSnowEnabled(enabled)
    localStorage.setItem('snow-enabled', String(enabled))
  }

  return (
    <SnowContext.Provider value={{ snowEnabled, setSnowEnabled: handleSetSnowEnabled }}>
      {children}
    </SnowContext.Provider>
  )
}

export function useSnow() {
  const context = useContext(SnowContext)
  if (context === undefined) {
    throw new Error('useSnow must be used within a SnowProvider')
  }
  return context
}
