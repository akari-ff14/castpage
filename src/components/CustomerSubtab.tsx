import { useCallback, useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { fmtDate } from '../lib/format'
import { AlertTriangle, Sparkles, Edit } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import './CustomerSubtab.css'

interface CustomerRecord {
  session_id: string
  対応キャスト: string
  対応日: string
  顧客名: string
  作成日時: string
}

interface CustomerGroup {
  name: string
  records: CustomerRecord[]
  lastVisit: Date | null
  casts: string[]
}

type SortKey = 'last_visit' | 'visits_desc' | 'visits_asc'

export default function CustomerSubtab() {
  const [all, setAll] = useState<CustomerRecord[]>([])
  const [notes, setNotes] = useState<Map<string, string>>(new Map())
  const [casts, setCasts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [search, setSearch] = useState('')
  const [castFilter, setCastFilter] = useState('')
  const [sort, setSort] = useState<SortKey>('last_visit')
  const [regBl, setRegBl] = useState<string | null>(null)
  const [blReason, setBlReason] = useState('')
  const [blNote, setBlNote] = useState('')
  const [memoTarget, setMemoTarget] = useState<string | null>(null)
  const [memoEdit, setMemoEdit] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const [rCust, rNotes] = await Promise.all([
      db.call<CustomerRecord[]>('getCustomers'),
      db.call<Map<string, string>>('getAllCustomerNotes'),
    ])
    setLoading(false)
    if (rCust.ok) setAll(rCust.data || [])
    else setErr(rCust.error)
    if (rNotes.ok && rNotes.data instanceof Map) setNotes(rNotes.data)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    (async () => {
      const r = await db.call<{ casts: string[] }>('getCastsAndRooms')
      if (r.ok) setCasts(r.data.casts)
    })()
  }, [])

  const groups = useMemo<CustomerGroup[]>(() => {
    const lowerSearch = search.toLowerCase()
    const filtered = all.filter((c) => {
      if (castFilter && c.対応キャスト !== castFilter) return false
      if (lowerSearch && !String(c.顧客名 || '').toLowerCase().includes(lowerSearch)) return false
      return true
    })
    const map = new Map<string, CustomerGroup>()
    for (const c of filtered) {
      const name = c.顧客名 || '—'
      if (!map.has(name)) {
        map.set(name, { name, records: [], lastVisit: null, casts: [] })
      }
      const g = map.get(name)!
      g.records.push(c)
      if (c.対応日) {
        const d = new Date(c.対応日)
        if (!isNaN(d.getTime()) && (!g.lastVisit || d > g.lastVisit)) g.lastVisit = d
      }
      if (c.対応キャスト && !g.casts.includes(c.対応キャスト)) g.casts.push(c.対応キャスト)
    }
    const list = [...map.values()]
    if (sort === 'visits_desc') list.sort((a, b) => b.records.length - a.records.length)
    else if (sort === 'visits_asc') list.sort((a, b) => a.records.length - b.records.length)
    else list.sort((a, b) => (b.lastVisit?.getTime() || 0) - (a.lastVisit?.getTime() || 0))
    return list
  }, [all, castFilter, search, sort])

  function openMemo(name: string) {
    setMemoTarget(name)
    setMemoEdit(notes.get(name) || '')
  }

  async function saveMemo() {
    if (!memoTarget) return
    setBusy(true)
    const r = await db.call('saveCustomerNote', memoTarget, memoEdit.trim())
    setBusy(false)
    if (r.ok) {
      setNotes((prev) => {
        const next = new Map(prev)
        if (memoEdit.trim()) next.set(memoTarget, memoEdit.trim())
        else next.delete(memoTarget)
        return next
      })
      toast.show('メモを保存しました')
      setMemoTarget(null)
    } else {
      toast.show((r as { error: string }).error || '保存に失敗しました', 'err')
    }
  }

  function openRegBl(name: string) {
    setRegBl(name)
    setBlReason('')
    setBlNote('')
  }

  async function confirmRegBl() {
    if (!regBl) return
    setBusy(true)
    const r = await db.call('addToBlacklist', {
      name: regBl,
      reason: blReason.trim(),
      note: blNote.trim(),
    })
    setBusy(false)
    setRegBl(null)
    if (r.ok) toast.show(`「${regBl}」をブラックリストに登録しました`)
    else toast.show((r as { error: string }).error || '登録に失敗しました', 'err')
  }

  return (
    <div className="customer-subtab">
      <div className="card filter-card">
        <input
          type="text"
          className="form-input"
          placeholder="顧客名で検索..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="form-row" style={{ marginTop: 8 }}>
          <div className="select-wrap">
            <select
              className="form-select"
              value={castFilter}
              onChange={(e) => setCastFilter(e.target.value)}
            >
              <option value="">全員</option>
              {casts.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="select-wrap">
            <select
              className="form-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              <option value="last_visit">最終来店（新しい順）</option>
              <option value="visits_desc">来店回数（多い順）</option>
              <option value="visits_asc">来店回数（少ない順）</option>
            </select>
          </div>
        </div>
      </div>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !groups.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !groups.length && (
        <div className="card empty-state">該当する顧客がありません</div>
      )}

      {groups.map((g) => {
        const memo = notes.get(g.name)
        return (
          <div key={g.name} className="customer-card">
            <div className="customer-info">
              <div className="customer-name">
                {g.name}
                {g.records.length === 1 ? (
                  <span className="badge-new"><Sparkles size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />新規</span>
                ) : (
                  <span className="visit-count">{g.records.length}回来店</span>
                )}
              </div>
              <div className="customer-meta">
                最終来店: {g.lastVisit ? fmtDate(g.lastVisit) : '—'} ｜ 担当: {g.casts.join('、') || '—'}
              </div>
              {memo && <div className="customer-note-preview">{memo}</div>}
            </div>
            <div className="customer-card-actions">
              <button className="btn-sm-note" onClick={() => openMemo(g.name)}>
                <Edit size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                メモ
              </button>
              <button className="btn-sm-bl" onClick={() => openRegBl(g.name)}>
                <AlertTriangle size={12} style={{ verticalAlign: '-1px', marginRight: 4 }} />
                BL登録
              </button>
            </div>
          </div>
        )
      })}

      {memoTarget && (
        <Modal onClose={() => !busy && setMemoTarget(null)}>
          <h3>
            <Edit size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            顧客メモ
          </h3>
          <p className="muted">対象: <strong>{memoTarget}</strong></p>
          <div className="form-group">
            <textarea
              className="form-input"
              style={{ minHeight: 100 }}
              value={memoEdit}
              onChange={(e) => setMemoEdit(e.target.value)}
              placeholder="好み、注意事項、常連情報など（空欄で削除）"
            />
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setMemoTarget(null)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={saveMemo} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {regBl && (
        <Modal onClose={() => !busy && setRegBl(null)}>
          <h3>
            <AlertTriangle size={18} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--red)' }} />
            ブラックリスト登録
          </h3>
          <p className="muted">対象: <strong>{regBl}</strong></p>
          <div className="form-group">
            <label className="form-label">理由（任意）</label>
            <input
              type="text"
              className="form-input"
              value={blReason}
              onChange={(e) => setBlReason(e.target.value)}
              placeholder="例: トラブル、迷惑行為など"
            />
          </div>
          <div className="form-group">
            <label className="form-label">備考（任意）</label>
            <textarea
              className="form-input"
              value={blNote}
              onChange={(e) => setBlNote(e.target.value)}
              placeholder="詳細メモ"
            />
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setRegBl(null)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-danger" onClick={confirmRegBl} disabled={busy}>
              {busy ? '登録中...' : '登録'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
