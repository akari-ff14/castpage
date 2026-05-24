import { useCallback, useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import Modal from './Modal'
import { useToast } from './Toast'
import './BlacklistSubtab.css'

interface BlEntry {
  name: string
  reason?: string
  note?: string
}

export default function BlacklistSubtab({ api }: { api: AkariApi }) {
  const [list, setList] = useState<BlEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [removing, setRemoving] = useState<BlEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await api.call<BlEntry[]>('getBlacklist')
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [api])

  useEffect(() => { load() }, [load])

  async function confirmRemove() {
    if (!removing) return
    setBusy(true)
    const r = await api.call('removeFromBlacklist', removing.name)
    setBusy(false)
    setRemoving(null)
    if (r.ok) {
      toast.show(`「${removing.name}」を解除しました`)
      load()
    } else {
      toast.show((r as { error: string }).error || '解除に失敗しました', 'err')
    }
  }

  return (
    <div className="bl-subtab">
      <div className="card filter-card">
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? '...' : '更新'}
        </button>
      </div>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !list.length && (
        <div className="card empty-state">ブラックリストは空です</div>
      )}

      {list.map((b) => (
        <div key={b.name} className="bl-card">
          <div className="bl-card-info">
            <div className="bl-card-name">{b.name}</div>
            {b.reason && <div className="bl-card-reason">理由: {b.reason}</div>}
            {b.note && <div className="bl-card-note">{b.note}</div>}
          </div>
          <button className="btn-secondary" onClick={() => setRemoving(b)}>
            解除
          </button>
        </div>
      ))}

      {removing && (
        <Modal onClose={() => !busy && setRemoving(null)}>
          <h3>ブラックリストから解除しますか？</h3>
          <p className="muted">対象: <strong>{removing.name}</strong></p>
          {removing.reason && <p className="muted">理由: {removing.reason}</p>}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setRemoving(null)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-danger" onClick={confirmRemove} disabled={busy}>
              {busy ? '解除中...' : '解除する'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
