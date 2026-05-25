import { useCallback, useEffect, useState } from 'react'
import { db, deleteSession, getCastsAndRooms, getPricing, updateHistorySession } from '../lib/db'
import { fmtCurrency, fmtDateTime, fmtTime } from '../lib/format'
import { Crown, AlertTriangle } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import './HistoryTab.css'

interface HistorySession {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  接客種別: string
  接客種別表示名: string
  基本単価: number
  延長回数: number
  オプション回数: number
  開始時間: string
  対応終了時間: string
  作成日時: string
  収益金: number
  備考: string
}

interface EditState {
  session_id: string
  cast_name: string
  room_name: string
  service_type: string
  customer_names: string
  extend_count: number
  option_count: number
  note: string
}

interface PricingEntry {
  key: string
  label: string
  price: number
}

function nowJstYearMonth(): { year: number; month: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
  }
}

export default function HistoryTab({
  castName,
  isAdmin,
}: {
  castName: string
  isAdmin: boolean
}) {
  const initial = nowJstYearMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [castFilter, setCastFilter] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<HistorySession[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // 編集モーダル用の参照データ
  const [casts, setCasts] = useState<string[]>([])
  const [rooms, setRooms] = useState<string[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])

  const [editing, setEditing] = useState<EditState | null>(null)
  const [deleting, setDeleting] = useState<HistorySession | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<HistorySession[]>('getHistory', { year, month })
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [year, month])

  useEffect(() => {
    load()
  }, [load])

  // 編集モーダル用の選択肢を一度だけ取得
  useEffect(() => {
    (async () => {
      try {
        const [cr, pr] = await Promise.all([getCastsAndRooms(), getPricing()])
        setCasts(cr.casts)
        setRooms(cr.rooms)
        setPricing(pr.filter((p) => p.key !== 'option'))
      } catch {
        // 編集時に必要なデータなので無視（モーダル開いた時にエラー出る）
      }
    })()
  }, [])

  const filtered = castFilter === 'mine' ? list.filter((s) => s.対応者 === castName) : list

  function canEdit(s: HistorySession): boolean {
    return isAdmin || s.対応者 === castName
  }

  function openEdit(s: HistorySession) {
    setEditing({
      session_id: s.session_id,
      cast_name: s.対応者,
      room_name: s.ルーム || '',
      service_type: s.接客種別,
      customer_names: s.顧客名,
      extend_count: s.延長回数,
      option_count: s.オプション回数,
      note: s.備考,
    })
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true)
    try {
      await updateHistorySession(editing.session_id, {
        cast_name: editing.cast_name,
        room_name: editing.room_name || null,
        service_type: editing.service_type,
        customer_names: editing.customer_names,
        extend_count: editing.extend_count,
        option_count: editing.option_count,
        note: editing.note,
      })
      toast.show('履歴を更新しました')
      setEditing(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteSession(deleting.session_id)
      toast.show('履歴を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // 編集中の収益プレビュー
  const editPreview = (() => {
    if (!editing) return 0
    const svc = pricing.find((p) => p.key === editing.service_type)
    const optEntry = pricing.find((p) => p.key === 'option')
    const basePrice = svc?.price ?? 0
    const optPrice = optEntry?.price ?? 500000  // フォールバック
    const custs = editing.customer_names.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
    const nCust = Math.max(1, custs.length)
    const ext = Math.max(0, editing.extend_count)
    const opt = Math.max(0, editing.option_count)
    return basePrice * nCust * (1 + ext) + optPrice * opt
  })()

  return (
    <div className="history-tab">
      <div className="card filter-card">
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">年</label>
            <input
              type="number"
              className="form-input"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min="2020"
              max="2099"
            />
          </div>
          <div className="form-group">
            <label className="form-label">月</label>
            <div className="select-wrap">
              <select
                className="form-select"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <button
            className={`btn-pill ${castFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setCastFilter('mine')}
          >
            自分のみ
          </button>
          <button
            className={`btn-pill ${castFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCastFilter('all')}
          >
            全員
          </button>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? '...' : '更新'}
          </button>
        </div>
      </div>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !filtered.length && (
        <div className="card empty-state">この期間の履歴はありません</div>
      )}

      {filtered.map((s) => (
        <div key={s.session_id} className="history-card">
          <div className="history-header">
            <span className={`badge ${s.接客種別 === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
              {s.接客種別 === 'vip' && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
              {s.接客種別表示名 || s.接客種別}
            </span>
            <span className="history-revenue">{fmtCurrency(s.収益金)}</span>
          </div>
          <div className="history-row">
            <span className="muted">日時</span>
            <span>{fmtDateTime(s.作成日時)}</span>
          </div>
          <div className="history-row">
            <span className="muted">時間</span>
            <span>{fmtTime(s.開始時間)} 〜 {fmtTime(s.対応終了時間)}</span>
          </div>
          <div className="history-row">
            <span className="muted">対応者 / ルーム</span>
            <span>{s.対応者} / {s.ルーム || '—'}</span>
          </div>
          <div className="history-row">
            <span className="muted">顧客</span>
            <span>{s.顧客名 || '—'}</span>
          </div>
          {(s.延長回数 > 0 || s.オプション回数 > 0) && (
            <div className="history-row">
              <span className="muted">延長 / オプ</span>
              <span>{s.延長回数}回 / {s.オプション回数}回</span>
            </div>
          )}
          {s.備考 && (
            <div className="history-row">
              <span className="muted">備考</span>
              <span>{s.備考}</span>
            </div>
          )}
          {canEdit(s) && (
            <div className="history-actions">
              <button className="btn-secondary" onClick={() => openEdit(s)}>編集</button>
              <button className="btn-danger" onClick={() => setDeleting(s)}>削除</button>
            </div>
          )}
        </div>
      ))}

      {/* 編集モーダル */}
      {editing && (
        <Modal onClose={() => !busy && setEditing(null)}>
          <h3>履歴を編集</h3>
          <p className="muted small">数量や種別を変えると、収益金は自動再計算されます。</p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">対応者</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.cast_name}
                  onChange={(e) => setEditing((p) => (p ? { ...p, cast_name: e.target.value } : null))}
                  disabled={!isAdmin}
                  title={!isAdmin ? '管理者のみ変更可能' : ''}
                >
                  {casts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">ルーム</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.room_name}
                  onChange={(e) => setEditing((p) => (p ? { ...p, room_name: e.target.value } : null))}
                >
                  <option value="">—</option>
                  {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">接客種別</label>
            <div className="select-wrap">
              <select
                className="form-select"
                value={editing.service_type}
                onChange={(e) => setEditing((p) => (p ? { ...p, service_type: e.target.value } : null))}
              >
                {pricing.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label} ({fmtCurrency(p.price)})
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">顧客名（カンマ区切りで複数）</label>
            <input
              type="text"
              className="form-input"
              value={editing.customer_names}
              onChange={(e) => setEditing((p) => (p ? { ...p, customer_names: e.target.value } : null))}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">延長回数</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={editing.extend_count}
                onChange={(e) =>
                  setEditing((p) => (p ? { ...p, extend_count: Math.max(0, Number(e.target.value) || 0) } : null))
                }
              />
            </div>
            <div className="form-group">
              <label className="form-label">オプション回数</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={editing.option_count}
                onChange={(e) =>
                  setEditing((p) =>
                    p ? { ...p, option_count: Math.max(0, Number(e.target.value) || 0) } : null,
                  )
                }
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={editing.note}
              onChange={(e) => setEditing((p) => (p ? { ...p, note: e.target.value } : null))}
            />
          </div>
          <div className="edit-revenue-preview">
            再計算後の収益金: <strong>{fmtCurrency(editPreview)}</strong>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={saveEdit} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 削除確認 */}
      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>履歴を削除しますか？</h3>
          <p className="muted">
            {fmtDateTime(deleting.作成日時)} ｜ {deleting.対応者} ｜ {deleting.顧客名 || '—'}<br />
            収益: {fmtCurrency(deleting.収益金)}
          </p>
          <p className="err">
            <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            この操作は取り消せません。売上集計からも除外されます。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>キャンセル</button>
            <button className="btn-danger" onClick={confirmDelete} disabled={busy}>
              {busy ? '削除中...' : '削除する'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
