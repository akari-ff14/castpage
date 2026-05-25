import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { bindMyCast, getUnboundCasts } from '../lib/db'

interface Props {
  onBound: (castName: string) => void
}

export default function CastSelectionScreen({ onBound }: Props) {
  const [casts, setCasts] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busyName, setBusyName] = useState<string | null>(null)

  async function reload() {
    setLoading(true)
    setErr('')
    try {
      const list = await getUnboundCasts()
      setCasts(list.map((c) => c.name))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  async function pick(name: string) {
    setBusyName(name)
    setErr('')
    try {
      await bindMyCast(name)
      onBound(name)
    } catch (e) {
      setErr((e as Error).message)
      // 他の人に奪われてた可能性 → 再読み込み
      reload()
    } finally {
      setBusyName(null)
    }
  }

  return (
    <div className="ml-overlay">
      <div className="ml-deco">✦ &nbsp; ✦ &nbsp; ✦</div>
      <div className="ml-title">対話店[灯]</div>
      <div className="ml-sub">あなたはどのキャストですか？</div>
      <div className="ml-card">
        {loading && <p className="muted">読み込み中...</p>}
        {err && <p className="err">{err}</p>}
        {!loading && casts.length === 0 && !err && (
          <p className="muted">
            選択可能なキャストがありません。<br />
            既に他のキャスト用に登録済の可能性があります。管理者に確認してください。
          </p>
        )}
        {casts.map((name) => (
          <button
            key={name}
            className="btn-secondary cast-select-btn"
            onClick={() => pick(name)}
            disabled={busyName !== null}
          >
            {busyName === name ? '紐付け中...' : name}
          </button>
        ))}
        <p className="muted ml-hint">
          一度選択すると、あなたのアカウント（メールアドレス）にそのキャストが紐付きます。
          後でサイドバー下部のキャスト切替ボタンから変更できます。
        </p>
        <button
          className="btn-secondary"
          onClick={async () => {
            await supabase.auth.signOut()
          }}
          style={{ marginTop: 12, opacity: 0.6 }}
        >
          別のメールアドレスでログイン
        </button>
      </div>
    </div>
  )
}
