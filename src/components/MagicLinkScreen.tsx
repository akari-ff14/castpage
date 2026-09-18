import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { getStoredTheme } from '../lib/theme'
import { isTurnstileEnabled, renderTurnstile, type TurnstileHandle } from '../lib/turnstile'
import { Mail } from '../icons'
import './MagicLinkScreen.css'

// Google ロゴ SVG (公式アイコン、4色)
const GoogleLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3 0 5.8 1.1 7.9 3l5.7-5.7C34.2 6.1 29.4 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.3 0 10.1-2 13.7-5.4l-6.3-5.3C29.4 35 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.3 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4 5.6l.001-.001 6.3 5.3C37.3 39.5 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
)

export default function MagicLinkScreen() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  // Cloudflare の確認結果。Supabase Auth の Captcha protection はプロジェクト全体に
  // 効くので、予約ページと同じくこれを添えないとメール送信 (/otp) が
  // "captcha protection: request disallowed" で弾かれる。Google ログインは対象外
  const [captcha, setCaptcha] = useState('')
  const captchaBox = useRef<HTMLDivElement | null>(null)
  const captchaHandle = useRef<TurnstileHandle | null>(null)

  // 確認ウィジェットはフォームを出すたびに描き直す（送信後の画面から戻ったときも）
  useEffect(() => {
    if (sent || !isTurnstileEnabled()) return
    const box = captchaBox.current
    if (!box) return
    const theme = getStoredTheme() === 'light' ? 'light' : 'dark'
    captchaHandle.current = renderTurnstile(box, (token) => setCaptcha(token), theme)
    return () => {
      captchaHandle.current?.remove()
      captchaHandle.current = null
    }
  }, [sent])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    // 確認は動いているのに結果がまだ無い＝確認の途中。少し待って押し直せば通る。
    // 読み込めなかったときは待っても来ないので、そのまま送ってサーバーの返事を伝える
    if (captchaHandle.current?.available() && !captcha) {
      setErr('確認中です。数秒おいてもう一度お試しください')
      return
    }
    setBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin + window.location.pathname,
        captchaToken: captcha || undefined,
      },
    })
    setBusy(false)
    // 確認結果は1回きり。成功しても失敗しても取り直す
    captchaHandle.current?.reset()
    setCaptcha('')
    if (!error) {
      setSent(true)
      return
    }
    setErr(
      /captcha/i.test(error.message)
        ? '確認に失敗しました。ページを開き直してもう一度お試しください'
        : error.message,
    )
  }

  async function signInWithGoogle() {
    setGoogleBusy(true)
    setErr('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname,
      },
    })
    if (error) {
      setErr(error.message)
      setGoogleBusy(false)
    }
    // 成功時はリダイレクトされるので setGoogleBusy(false) は不要
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
      <div className="ml-sub">ログインしてください</div>

      <div className="ml-card">
        {/* Google OAuth — 推奨 */}
        <button
          type="button"
          className="btn-google"
          onClick={signInWithGoogle}
          disabled={googleBusy || busy}
        >
          <GoogleLogo size={18} />
          <span>{googleBusy ? '転送中...' : 'Googleでログイン'}</span>
        </button>

        <div className="ml-divider">
          <span>または</span>
        </div>

        {/* Magic Link */}
        <form onSubmit={submit} className="ml-form-inner">
          <label className="form-label">
            <Mail size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            メールアドレスでログイン
          </label>
          <input
            type="email"
            className="form-input ml-email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
          <button type="submit" className="btn-secondary" disabled={busy || googleBusy || !email.trim()}>
            {busy ? '送信中...' : 'ログインリンクを送る'}
          </button>
          {/* 確認が要るときだけ Cloudflare がここに描く。ふだんは空のまま */}
          <div ref={captchaBox} className="ml-captcha" />
          <p className="muted ml-hint">
            パスワード不要。届いたメール内のリンクをタップでログインできます。
          </p>
        </form>

        {err && <p className="err">{err}</p>}
      </div>
    </div>
  )
}
