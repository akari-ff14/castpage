import { useEffect, useState } from 'react'
import { AkariApi, type ApiResult } from './lib/akariApi'
import './App.css'

const API_URL = import.meta.env.VITE_AKARI_API_URL as string | undefined

interface SessionData {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  接客種別表示名: string
  開始時間: string
  対応終了時間: string
  [key: string]: unknown
}

export default function App() {
  if (!API_URL) {
    return (
      <div className="error-box">
        <h2>VITE_AKARI_API_URL が未設定です</h2>
        <p>プロジェクトルートに <code>.env.local</code> を作って以下を追加してください:</p>
        <pre>VITE_AKARI_API_URL=https://script.google.com/macros/s/.../exec</pre>
      </div>
    )
  }
  const [api] = useState(() => new AkariApi(API_URL))
  const [authed, setAuthed] = useState(api.isAuthenticated)
  const [castName, setCastName] = useState(api.currentCastName)

  if (!authed) {
    return <LoginScreen api={api} onLogin={(name) => { setCastName(name); setAuthed(true) }} />
  }
  return <Dashboard api={api} castName={castName} onLogout={() => { api.logout(); setAuthed(false) }} />
}

function LoginScreen({ api, onLogin }: { api: AkariApi; onLogin: (castName: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const r = await api.login(pin)
    setBusy(false)
    if (r.ok) onLogin(r.data.castName)
    else setErr(r.error)
  }

  return (
    <div className="screen">
      <h1>対話店[灯] — Web版（プロトタイプ）</h1>
      <form onSubmit={submit} className="card">
        <label>
          PIN
          <input
            type="password"
            inputMode="numeric"
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            autoFocus
          />
        </label>
        <button type="submit" disabled={busy || !pin}>{busy ? '...' : 'ログイン'}</button>
        {err && <p className="err">{err}</p>}
      </form>
    </div>
  )
}

function Dashboard({ api, castName, onLogout }: { api: AkariApi; castName: string; onLogout: () => void }) {
  const [session, setSession] = useState<ApiResult<SessionData | null> | null>(null)
  const [loading, setLoading] = useState(false)

  async function reload() {
    setLoading(true)
    const r = await api.call<SessionData | null>('getActiveSession', castName)
    setSession(r)
    setLoading(false)
  }

  useEffect(() => { reload() }, [])

  return (
    <div className="screen">
      <header className="topbar">
        <h2>こんにちは、{castName} さん</h2>
        <button onClick={onLogout}>ログアウト</button>
      </header>
      <section className="card">
        <div className="row">
          <h3>現在の接客状況</h3>
          <button onClick={reload} disabled={loading}>{loading ? '...' : '更新'}</button>
        </div>
        {!session && <p>読み込み中...</p>}
        {session && !session.ok && <p className="err">エラー: {session.error}</p>}
        {session && session.ok && !session.data && <p>接客中のセッションはありません。</p>}
        {session && session.ok && session.data && (
          <dl>
            <dt>ルーム</dt><dd>{session.data.ルーム}</dd>
            <dt>顧客</dt><dd>{session.data.顧客名}</dd>
            <dt>種別</dt><dd>{session.data.接客種別表示名}</dd>
            <dt>開始</dt><dd>{session.data.開始時間}</dd>
            <dt>終了予定</dt><dd>{session.data.対応終了時間}</dd>
          </dl>
        )}
      </section>
    </div>
  )
}
