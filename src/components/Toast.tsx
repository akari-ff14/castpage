import { useCallback, useEffect, useRef, useState } from 'react'

export interface ToastItem {
  msg: string
  kind: 'ok' | 'err'
}

// 親コンポーネントで `const toast = useToast(); ... toast.show('ok','...')` のように使う
export function useToast() {
  const [items, setItems] = useState<ToastItem[]>([])
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setItems((prev) => [...prev, { msg, kind }])
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setItems([]), 2800)
  }, [])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const element = items.length ? (
    <div className="toast-stack">
      {items.map((t, i) => (
        <div key={i} className={`toast toast-${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  ) : null

  return { show, element }
}
