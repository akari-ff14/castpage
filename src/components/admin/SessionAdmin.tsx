import { useEffect, useState } from 'react'
import {
  forceEndSession,
  updateHistorySession,
  deleteSession,
  getCastsAndRooms,
  type SessionShape,
} from '../../lib/db'
import { useActiveSessions } from '../../lib/useRealtimeSessions'
import { fmtCurrency, fmtDateTime, fmtTime } from '../../lib/format'
import { Crown, AlertTriangle } from '../../icons'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'

interface EditState {
  session_id: string
  顧客名: string
  ルーム: string
  延長回数: number
  オプション回数: number
  備考: string
}

export default function SessionAdmin() {
  // Realtime購読で自動更新
  const { sessions: active, loading, reload: load } = useActiveSessions()
  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<SessionShape | null>(null)
  const [forcing, setForcing] = useState<SessionShape | null>(null)
  const [rooms, setRooms] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  // ルーム編集用の選択肢を一度だけ取得
  useEffect(() => {
    (async () => {
      try {
        const cr = await getCastsAndRooms()
        setRooms(cr.rooms)
      } catch {
        // 編集モーダルを開いた時にルーム候補が空になるだけ
      }
    })()
  }, [])

  async function doForceEnd() {
    if (!forcing) return
    setBusy(true)
    try {
      await forceEndSession(forcing.session_id)
      toast.show(`${forcing.対応者} の接客を強制終了しました`)
      setForcing(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function doSaveEdit() {
    if (!editing) return
    setBusy(true)
    try {
      await updateHistorySession(editing.session_id, {
        room_name: editing.ルーム || null,
        extend_count: editing.延長回数,
        option_count: editing.オプション回数,
        note: editing.備考,
        customer_names: editing.顧客名,
      })
      toast.show('接客を更新しました')
      setEditing(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function doDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteSession(deleting.session_id)
      toast.show('接客を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>接客管理</h3>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? '...' : '更新'}
        </button>
      </div>
      <p className="muted small">
        進行中の接客を強制終了、または完了済み接客を編集・削除できます。<br />
        強制終了は「完了」フラグを立てるだけで、収益はそのまま記録されます。
      </p>

      {loading && !active.length && <p className="muted">読み込み中...</p>}
      {!loading && !active.length && (
        <div className="card empty-state">進行中の接客はありません</div>
      )}

      <h4 className="admin-section-h">進行中</h4>
      {active.map((s) => (
        <div key={s.session_id} className="admin-card">
          <div className="admin-card-body">
            <div className="admin-card-title">
              <strong>{s.対応者}</strong>
              <span className={`badge ${s.接客種別 === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
                {s.接客種別 === 'vip' && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
                {s.接客種別表示名}
              </span>
            </div>
            <div className="admin-card-meta">
              ルーム: {s.ルーム || '—'} ｜ 顧客: {s.顧客名 || '—'}
            </div>
            <div className="admin-card-meta">
              開始: {fmtTime(s.開始時間)} ｜ 終了予定: {fmtTime(s.対応終了時間)} ｜ 延長 {s.延長回数}回 / オプ {s.オプション回数}回
            </div>
            <div className="admin-card-meta">
              <span className="c-gold">{fmtCurrency(s.収益金)}</span>
            </div>
          </div>
          <div className="admin-card-actions">
            <button
              className="btn-secondary"
              onClick={() =>
                setEditing({
                  session_id: s.session_id,
                  顧客名: s.顧客名,
                  ルーム: s.ルーム || '',
                  延長回数: s.延長回数,
                  オプション回数: s.オプション回数,
                  備考: s.備考,
                })
              }
            >
              編集
            </button>
            <button className="btn-danger" onClick={() => setForcing(s)}>強制終了</button>
            <button className="btn-danger" onClick={() => setDeleting(s)}>削除</button>
          </div>
        </div>
      ))}

      {/* 強制終了確認 */}
      {forcing && (
        <Modal onClose={() => !busy && setForcing(null)}>
          <h3>接客を強制終了しますか？</h3>
          <p className="muted">
            {forcing.対応者} / {forcing.ルーム || '—'} / {forcing.顧客名 || '—'}<br />
            開始: {fmtDateTime(forcing.開始時間)}
          </p>
          <p className="muted small">
            完了マークを立てて履歴に移します。収益は現在の金額（{fmtCurrency(forcing.収益金)}）で確定されます。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setForcing(null)} disabled={busy}>キャンセル</button>
            <button className="btn-danger" onClick={doForceEnd} disabled={busy}>
              {busy ? '処理中...' : '強制終了する'}
            </button>
          </div>
        </Modal>
      )}

      {/* 編集 */}
      {editing && (
        <Modal onClose={() => !busy && setEditing(null)}>
          <h3>接客を編集</h3>
          <p className="muted small">延長回数・オプション回数を変更すると、収益金が自動再計算されます。</p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">顧客名</label>
              <input
                type="text"
                className="form-input"
                value={editing.顧客名}
                onChange={(e) => setEditing((p) => (p ? { ...p, 顧客名: e.target.value } : null))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">ルーム</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.ルーム}
                  onChange={(e) => setEditing((p) => (p ? { ...p, ルーム: e.target.value } : null))}
                >
                  <option value="">—</option>
                  {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">延長回数</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={editing.延長回数}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, 延長回数: Math.max(0, Number(e.target.value) || 0) } : null))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">オプション回数</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={editing.オプション回数}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, オプション回数: Math.max(0, Number(e.target.value) || 0) } : null,
                  )
                }
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={editing.備考}
              onChange={(e) => setEditing((p) => (p ? { ...p, 備考: e.target.value } : null))}
            />
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={doSaveEdit} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 削除確認 */}
      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>接客を削除しますか？</h3>
          <p className="muted">
            {deleting.対応者} / {deleting.ルーム || '—'} / {deleting.顧客名 || '—'}<br />
            収益: {fmtCurrency(deleting.収益金)}
          </p>
          <p className="err">
            <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            この操作は取り消せません。売上集計からも除外されます。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>キャンセル</button>
            <button className="btn-danger" onClick={doDelete} disabled={busy}>
              {busy ? '削除中...' : '削除する'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
