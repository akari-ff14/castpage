import { useCallback, useEffect, useState } from 'react'
import { db } from '../lib/db'
import { fmtCurrency, fmtDateTime } from '../lib/format'
import { useRealtimeReservations } from '../lib/useRealtimeSessions'
import { Play } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import type { SessionPreset } from './StartSessionForm'
import './ReservationTab.css'

interface Reservation {
  reservation_id: string
  キャスト名: string
  顧客名: string
  予約種別: '当日' | '事前' | string
  予約金額: number
  予約日時: string
  ルーム: string
  備考: string
  作成日時: string
  更新日時: string
}

interface PricingEntry {
  key: string
  label: string
  price: number
}

type FilterType = '当日' | '事前' | 'all'

const RES_TYPES: Array<{ value: FilterType; label: string }> = [
  { value: '当日', label: '当日予約' },
  { value: '事前', label: '事前予約' },
  { value: 'all', label: 'すべて' },
]

// JSTのISO風文字列→ datetime-local input value (YYYY-MM-DDTHH:mm)
function toLocalInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // JST に変換
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 16)
}

// datetime-local input value (JST) → UTC ISO
function fromLocalInput(local: string): string {
  if (!local) return ''
  // localは「JSTの壁時計時刻」として扱い、UTCに戻す
  const [datePart, timePart] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  // JST = UTC + 9h なので UTC = JST - 9h
  const utc = new Date(Date.UTC(y, m - 1, d, hh, mm) - 9 * 60 * 60 * 1000)
  return utc.toISOString()
}

interface FormState {
  reservation_id?: string
  castName: string
  customerName: string
  datetime: string  // datetime-local input format
  room: string
  reservationType: '当日' | '事前'
  pricingKey: string
  pricingQty: number
  note: string
}

const emptyForm = (castName: string): FormState => ({
  castName,
  customerName: '',
  datetime: '',
  room: '',
  reservationType: '事前',
  pricingKey: 'normal',
  pricingQty: 0,
  note: '',
})

export default function ReservationTab({
  castName,
  onStartSession,
}: {
  castName: string
  onStartSession?: (preset: SessionPreset) => void
}) {
  const [list, setList] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [castFilter, setCastFilter] = useState<'mine' | 'all'>('mine')

  // フォーム関連
  const [casts, setCasts] = useState<string[]>([])
  const [rooms, setRooms] = useState<string[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm(castName))
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Reservation | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<Reservation[]>('getReservations')
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeReservations(load)

  useEffect(() => {
    (async () => {
      const [rCast, rPrice] = await Promise.all([
        db.call<{ casts: string[]; rooms: string[] }>('getCastsAndRooms'),
        db.call<PricingEntry[]>('getPricing'),
      ])
      if (rCast.ok) { setCasts(rCast.data.casts); setRooms(rCast.data.rooms) }
      if (rPrice.ok) setPricing(rPrice.data)
    })()
  }, [])

  const filtered = list.filter((r) => {
    if (filter !== 'all' && r.予約種別 !== filter) return false
    if (castFilter === 'mine' && r.キャスト名 !== castName) return false
    return true
  })

  function openAdd() {
    setForm(emptyForm(castName))
    setFormOpen(true)
  }

  function openEdit(r: Reservation) {
    const pricing0 = pricing.find((p) => p.price === r.予約金額)
    setForm({
      reservation_id: r.reservation_id,
      castName: r.キャスト名,
      customerName: r.顧客名,
      datetime: toLocalInput(r.予約日時),
      room: r.ルーム || '',
      reservationType: (r.予約種別 === '当日' ? '当日' : '事前'),
      pricingKey: pricing0?.key || 'normal',
      pricingQty: pricing0 ? 1 : 0,
      note: r.備考 || '',
    })
    setFormOpen(true)
  }

  const pricingEntry = pricing.find((p) => p.key === form.pricingKey)
  const calcPrice = pricingEntry ? pricingEntry.price * (form.pricingQty || 0) : 0

  async function save() {
    if (!form.castName) { toast.show('キャスト名が必要です', 'err'); return }
    if (!form.datetime) { toast.show('予約日時が必要です', 'err'); return }
    setBusy(true)
    const payload = {
      ...(form.reservation_id ? { reservationId: form.reservation_id } : {}),
      castName: form.castName,
      customerName: form.customerName.trim(),
      datetime: fromLocalInput(form.datetime),
      room: form.room,
      reservationType: form.reservationType,
      reservationPrice: calcPrice,
      note: form.note.trim(),
    }
    const r = form.reservation_id
      ? await db.call('updateReservation', payload)
      : await db.call('addReservation', payload)
    setBusy(false)
    if (r.ok) {
      toast.show(form.reservation_id ? '予約を更新しました' : '予約を追加しました')
      setFormOpen(false)
      load()
    } else {
      toast.show((r as { error: string }).error || '保存に失敗しました', 'err')
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    const r = await db.call('deleteReservation', deleting.reservation_id)
    setBusy(false)
    setDeleting(null)
    if (r.ok) {
      toast.show('予約を削除しました')
      load()
    } else {
      toast.show((r as { error: string }).error || '削除に失敗しました', 'err')
    }
  }

  return (
    <div className="reservation-tab">
      <div className="card filter-card">
        <div className="filter-actions">
          {RES_TYPES.map((t) => (
            <button
              key={t.value}
              className={`btn-pill ${filter === t.value ? 'active' : ''}`}
              onClick={() => setFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
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

      <button className="btn-add-top" onClick={openAdd}>＋ 予約を追加</button>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !filtered.length && <div className="card empty-state">該当する予約はありません</div>}

      {filtered.map((r) => (
        <div key={r.reservation_id} className="res-card">
          <div className="res-header">
            <span className={`badge ${r.予約種別 === '当日' ? 'badge-normal' : 'badge-vip'}`}>
              {r.予約種別}
            </span>
            <span className="res-datetime">{fmtDateTime(r.予約日時)}</span>
          </div>
          <div className="res-body">
            <div className="res-row">
              <span className="muted">キャスト</span>
              <span>{r.キャスト名}</span>
            </div>
            <div className="res-row">
              <span className="muted">顧客</span>
              <span>{r.顧客名 || '—'}</span>
            </div>
            {r.ルーム && (
              <div className="res-row">
                <span className="muted">ルーム</span>
                <span>{r.ルーム}</span>
              </div>
            )}
            {r.予約金額 > 0 && (
              <div className="res-row">
                <span className="muted">金額</span>
                <span className="c-gold">{fmtCurrency(r.予約金額)}</span>
              </div>
            )}
            {r.備考 && (
              <div className="res-row">
                <span className="muted">備考</span>
                <span>{r.備考}</span>
              </div>
            )}
          </div>
          <div className="res-actions">
            {onStartSession && (
              <button
                className="btn-res-start"
                onClick={() => onStartSession({ customerName: r.顧客名, room: r.ルーム })}
              >
                <Play size={12} />
                接客開始
              </button>
            )}
            <button className="btn-secondary" onClick={() => openEdit(r)}>編集</button>
            <button className="btn-danger" onClick={() => setDeleting(r)}>削除</button>
          </div>
        </div>
      ))}

      {formOpen && (
        <Modal onClose={() => !busy && setFormOpen(false)}>
          <h3>{form.reservation_id ? '予約を編集' : '予約を追加'}</h3>
          <div className="form-group">
            <label className="form-label">予約種別</label>
            <div className="filter-actions" style={{ marginTop: 0 }}>
              <button
                className={`btn-pill ${form.reservationType === '事前' ? 'active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, reservationType: '事前' }))}
              >
                事前予約
              </button>
              <button
                className={`btn-pill ${form.reservationType === '当日' ? 'active' : ''}`}
                onClick={() => setForm((f) => ({ ...f, reservationType: '当日' }))}
              >
                当日予約
              </button>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">キャスト</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.castName}
                  onChange={(e) => setForm((f) => ({ ...f, castName: e.target.value }))}
                >
                  {casts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">ルーム（任意）</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.room}
                  onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
                >
                  <option value="">—</option>
                  {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">顧客名</label>
            <input
              type="text"
              className="form-input"
              value={form.customerName}
              onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
              placeholder="顧客名"
            />
          </div>
          <div className="form-group">
            <label className="form-label">予約日時</label>
            <input
              type="datetime-local"
              className="form-input"
              value={form.datetime}
              onChange={(e) => setForm((f) => ({ ...f, datetime: e.target.value }))}
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">料金種別</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.pricingKey}
                  onChange={(e) => setForm((f) => ({ ...f, pricingKey: e.target.value }))}
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
              <label className="form-label">数量</label>
              <input
                type="number"
                className="form-input"
                min="0"
                value={form.pricingQty}
                onChange={(e) => setForm((f) => ({ ...f, pricingQty: Number(e.target.value) }))}
              />
            </div>
          </div>
          <div className="res-price-preview">
            予約金額: <strong>{calcPrice > 0 ? fmtCurrency(calcPrice) : '—'}</strong>
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="備考（任意）"
            />
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={save} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>予約を削除しますか？</h3>
          <p className="muted">{deleting.キャスト名} / {deleting.顧客名 || '（顧客名なし）'} / {fmtDateTime(deleting.予約日時)}</p>
          <p className="muted">この操作は取り消せません。</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>
              キャンセル
            </button>
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
