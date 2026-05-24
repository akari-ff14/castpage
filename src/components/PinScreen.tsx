import { useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import './PinScreen.css'

interface Props {
  api: AkariApi
  onLogin: (castName: string) => void
}

export default function PinScreen({ api, onLogin }: Props) {
  const [buf, setBuf] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)
  const [lockUntil, setLockUntil] = useState(0)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (lockUntil <= Date.now()) return
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [lockUntil])

  const lockSec = Math.max(0, Math.ceil((lockUntil - now) / 1000))
  const locked = busy || lockSec > 0

  async function submit(pin: string) {
    if (pin.length < 4 || locked) return
    setBusy(true)
    setMsg('確認中…')
    const r = await api.login(pin)
    setBusy(false)
    if (r.ok) {
      onLogin(r.data.castName)
      return
    }
    if (r.code === 'LOCKED') {
      const m = /retry in (\d+)s/.exec(r.error)
      const sec = m ? Number(m[1]) : 30
      setLockUntil(Date.now() + sec * 1000)
      setMsg('ロック中...')
    } else {
      setMsg(r.error === 'invalid pin' ? 'PINが違います' : r.error)
    }
    setBuf('')
    setErr(true)
    setTimeout(() => setErr(false), 900)
  }

  function press(k: string) {
    if (locked || buf.length >= 4) return
    setErr(false)
    setMsg('')
    const next = buf + k
    setBuf(next)
    if (next.length === 4) setTimeout(() => submit(next), 120)
  }

  function back() {
    if (locked) return
    setErr(false)
    setMsg('')
    setBuf((b) => b.slice(0, -1))
  }

  // キーボード対応（テンキー / 数字キー / Backspace / Enter）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (locked) return
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        back()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        submit(buf)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className={`pin-overlay${locked ? ' locked' : ''}`}>
      <div className="pin-deco">✦ &nbsp; ✦ &nbsp; ✦</div>
      <div className="pin-title">対話店[灯]</div>
      <div className="pin-sub">PIN を入力してください</div>
      <div className="pin-dots">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`pin-dot${i < buf.length ? ' filled' : ''}${err ? ' err' : ''}`}
          />
        ))}
      </div>
      <div className="pin-msg">
        {lockSec > 0 ? `ロック中... あと ${lockSec} 秒` : msg}
      </div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
          <button
            key={k}
            className="pin-key"
            onClick={() => press(k)}
            disabled={locked}
          >
            {k}
          </button>
        ))}
        <button className="pin-key del" onClick={back} disabled={locked}>
          ⌫
        </button>
        <button className="pin-key" onClick={() => press('0')} disabled={locked}>
          0
        </button>
        <button
          className="pin-key ok"
          onClick={() => submit(buf)}
          disabled={locked || buf.length < 4}
        >
          ✓
        </button>
      </div>
    </div>
  )
}
