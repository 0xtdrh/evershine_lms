'use client'

import { useEffect, useState } from 'react'

/** The value, but only after it stopped changing for `ms` (search boxes: one server request per pause, not per key). */
export function useDebouncedValue<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}
