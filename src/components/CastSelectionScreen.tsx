import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { bindMyCast } from '../lib/db'

interface Props {
  onBound: (castName: string) => void
}

export default function CastSelectionScreen({ onBound }: Props) {
  const [castName, setCastName] = useState('')
  const [inviteCode, setInviteCode] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!castName.trim() || !inviteCode.trim()) return
    setBusy(true)
    setErr('')
    try {
      // 招待コードは大文字に正規化 (Crockford Base32)
      const info = await bindMyCast(castName.trim(), inviteCode.trim().toUpperCase())
      onBound(info.name)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ml-overlay">
      <div className="ml-deco">✦ &nbsp; ✦ &nbsp; ✦</div>
      <div className="ml-title">対話店[灯]</div>
      <div className="ml-sub">キャストを紐付けてください</div>
      <div className="ml-card">
        <form onSubmit={submit} className="ml-form-inner">
          <label className="form-label">キャスト名</label>
          <input
            type="text"
            className="form-input"
            value={castName}
            onChange={(e) => setCastName(e.target.value)}
            placeholder="例: みかん"
            autoComplete="off"
            required
            disabled={busy}
          />
          <label className="form-label" style={{ marginTop: 12 }}>招待コード</label>
          <input
            type="text"
            className="form-input"
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            placeholder="管理者から受け取った 8 文字"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            required
            disabled={busy}
            style={{ textTransform: 'uppercase', letterSpacing: '0.05em' }}
          />
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !castName.trim() || !inviteCode.trim()}
            style={{ marginTop: 12 }}
          >
            {busy ? '紐付け中...' : '紐付ける'}
          </button>
          {err && <p className="err" style={{ marginTop: 12 }}>{err}</p>}
        </form>

        <p className="muted ml-hint">
          初回のみ、管理者から伝達された招待コードを入力します。
          紐付け後はあなたのアカウント (メールアドレス) にこのキャストが固定されます。
          間違えたときは管理者に連絡してください。
        </p>

        <button
          className="btn-secondary"
          onClick={async () => {
            await supabase.auth.signOut()
          }}
          style={{ marginTop: 12, opacity: 0.6 }}
          disabled={busy}
        >
          別のメールアドレスでログイン
        </button>
      </div>
    </div>
  )
}
