import { useState } from 'react'
import { supabase } from '../lib/supabase'
import './MagicLinkScreen.css'

export default function MagicLinkScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
      },
    })
    setBusy(false)
    if (error) setErr(error.message)
    else setSent(true)
  }

  if (sent) {
    return (
      <div className="ml-overlay">
        <div className="ml-deco">✦ &nbsp; ✦ &nbsp; ✦</div>
        <div className="ml-title">対話店[灯]</div>
        <div className="ml-sub">メールを送りました</div>
        <div className="ml-card">
          <p>
            <strong>{email}</strong> 宛にログイン用のリンクを送りました。
          </p>
          <p className="muted">
            メールを開いてリンクをタップすると、このページに戻って自動的にログインされます。
          </p>
          <button
            className="btn-secondary"
            onClick={() => {
              setSent(false)
              setEmail('')
            }}
          >
            別のメールアドレスで再送信
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ml-overlay">
      <div className="ml-deco">✦ &nbsp; ✦ &nbsp; ✦</div>
      <div className="ml-title">対話店[灯]</div>
      <div className="ml-sub">メールアドレスを入力してください</div>
      <form className="ml-card" onSubmit={submit}>
        <input
          type="email"
          className="form-input ml-email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          autoComplete="email"
          required
        />
        <button type="submit" className="btn-primary" disabled={busy || !email.trim()}>
          {busy ? '送信中...' : 'ログインリンクを送る'}
        </button>
        {err && <p className="err">{err}</p>}
        <p className="muted ml-hint">
          パスワードは不要です。メール内のリンクをタップするだけでログインできます。
        </p>
      </form>
    </div>
  )
}
