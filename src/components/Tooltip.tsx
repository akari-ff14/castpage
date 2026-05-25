import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './Tooltip.css'

interface Props {
  content: string
  children: ReactNode
  delay?: number
  side?: 'top' | 'bottom' | 'left' | 'right'
}

// 軽量ツールチップ — ホバー/フォーカスで delay 後に表示。
// 子要素を 1 つラップする想定で、その上に絶対配置する。
export default function Tooltip({ content, children, delay = 250, side = 'top' }: Props) {
  const [visible, setVisible] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  function show() {
    timerRef.current = setTimeout(() => setVisible(true), delay)
  }

  function hide() {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    setVisible(false)
  }

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
  }, [])

  return (
    <span
      className="tooltip-wrap"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span className={`tooltip-bubble tooltip-${side}`} role="tooltip">
          {content}
        </span>
      )}
    </span>
  )
}
