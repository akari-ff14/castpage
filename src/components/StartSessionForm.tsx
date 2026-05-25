import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { fmtCurrency, fmtTime } from '../lib/format'
import { useActiveSessions } from '../lib/useRealtimeSessions'
import { Crown, AlertTriangle } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import './StartSessionForm.css'

interface RoomData {
  name: string
  vip: number
}

interface PricingEntry {
  key: string
  label: string
  price: number
}

interface BlMatch {
  name: string
  reason?: string
}

interface Props {
  castName: string
  onStarted: () => void
}

const PRESET_OPTIONS = [
  { value: 0, label: '選択しない' },
  { value: 1, label: '30分（1口）' },
  { value: 2, label: '1時間（2口）' },
  { value: 3, label: '1時間半（3口）' },
  { value: 4, label: '2時間（4口）' },
  { value: 5, label: '2時間半（5口）' },
  { value: 6, label: '3時間（6口）' },
]

export default function StartSessionForm({ castName, onStarted }: Props) {
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [room, setRoom] = useState('')
  const [customerNames, setCustomerNames] = useState<string[]>([''])
  const [note, setNote] = useState('')
  const [presetSlots, setPresetSlots] = useState(0)
  const [busy, setBusy] = useState(false)
  const [blWarning, setBlWarning] = useState<BlMatch[] | null>(null)
  const toast = useToast()

  // 全キャストの進行中セッションをリアルタイム購読
  const { sessions: activeSessions } = useActiveSessions()
  // ルーム名 → 使用中セッション情報 のマップ
  const roomUsage = useMemo(() => {
    const m = new Map<string, typeof activeSessions[number]>()
    for (const s of activeSessions) {
      if (s.ルーム) m.set(s.ルーム, s)
    }
    return m
  }, [activeSessions])

  useEffect(() => {
    (async () => {
      const [rRoom, rPrice] = await Promise.all([
        db.call<{ casts: string[]; rooms: string[]; roomsData: RoomData[] }>('getCastsAndRooms'),
        db.call<PricingEntry[]>('getPricing'),
      ])
      if (rRoom.ok && rRoom.data.roomsData) setRooms(rRoom.data.roomsData)
      if (rPrice.ok) setPricing(rPrice.data)
    })()
  }, [])

  const roomInfo = rooms.find((r) => r.name === room)
  const serviceType = roomInfo?.vip === 1 ? 'vip' : 'normal'
  const servicePrice = pricing.find((p) => p.key === serviceType)
  const filledCustomerNames = customerNames.map((s) => s.trim()).filter(Boolean)
  const numCustomers = Math.max(1, filledCustomerNames.length)

  const seatFeeEstimate =
    presetSlots > 0 && servicePrice
      ? servicePrice.price * numCustomers * presetSlots
      : 0

  const canSubmit = !busy && !!room && filledCustomerNames.length > 0

  function updateCustName(i: number, value: string) {
    setCustomerNames((prev) => {
      const next = [...prev]
      next[i] = value
      return next
    })
  }

  function addCustName() {
    if (customerNames.length >= 10) return
    setCustomerNames((prev) => [...prev, ''])
  }

  function removeCustName(i: number) {
    if (customerNames.length === 1) {
      setCustomerNames([''])
      return
    }
    setCustomerNames((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function attemptStart() {
    setBusy(true)
    try {
      // 1) ルーム空き確認
      // Supabase版の checkRoomAvailability は db.call 経由で {ok, data: {available, usedBy}} 形式
      const rRoom = await db.call<{ available: boolean; usedBy?: string }>('checkRoomAvailability', room)
      if (!rRoom.ok) {
        toast.show(rRoom.error || 'ルーム確認に失敗しました', 'err')
        return
      }
      if (!rRoom.data.available) {
        toast.show(`「${room}」は現在 ${rRoom.data.usedBy || '他のキャスト'} が使用中です`, 'err')
        return
      }
      // 2) ブラックリストチェック（複数顧客で並列）
      const blResults = await Promise.all(
        filledCustomerNames.map((name) => db.call<BlMatch[]>('checkBlacklist', name)),
      )
      const allMatches: BlMatch[] = []
      const seen = new Set<string>()
      for (const r of blResults) {
        if (r.ok && Array.isArray(r.data)) {
          for (const m of r.data) {
            if (!seen.has(m.name)) {
              seen.add(m.name)
              allMatches.push(m)
            }
          }
        }
      }
      if (allMatches.length) {
        setBlWarning(allMatches)
        return
      }
      // 3) 開始
      await callStart()
    } catch (e) {
      toast.show(`予期せぬエラー: ${(e as Error).message || String(e)}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function callStart() {
    setBlWarning(null)
    setBusy(true)
    try {
      const r = await db.call('startSession', {
        castName,
        room,
        customerNames: filledCustomerNames,
        note: note.trim(),
        serviceType,
        presetSlots: presetSlots || 1,
      })
      if (r.ok) {
        toast.show('応対を開始しました')
        setCustomerNames([''])
        setNote('')
        setPresetSlots(0)
        onStarted()
      } else {
        toast.show((r as { error: string }).error || '開始に失敗しました', 'err')
      }
    } catch (e) {
      toast.show(`予期せぬエラー: ${(e as Error).message || String(e)}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="start-form">
      {/* 現在使用中のルーム（リアルタイム反映） */}
      {activeSessions.length > 0 && (
        <div className="card room-usage-card">
          <div className="card-title">
            <span className="live-dot" />
            現在使用中（{activeSessions.length}件）
          </div>
          {activeSessions.map((s) => (
            <div key={s.session_id} className="room-usage-row">
              <span className="room-usage-room">{s.ルーム || '(ルーム未指定)'}</span>
              <span className="muted"> ｜ </span>
              <span>{s.対応者}</span>
              {s.顧客名 && <><span className="muted"> ｜ </span><span className="muted small">{s.顧客名}</span></>}
              <span className="room-usage-time">〜 {fmtTime(s.対応終了時間)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-title">基本情報</div>
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">キャスト名</label>
            <div className="form-readonly">{castName}</div>
          </div>
          <div className="form-group">
            <label className="form-label">ルーム</label>
            <div className="select-wrap">
              <select
                className="form-select"
                value={room}
                onChange={(e) => setRoom(e.target.value)}
              >
                <option value="">選択してください</option>
                {rooms.map((r) => {
                  const usage = roomUsage.get(r.name)
                  return (
                    <option key={r.name} value={r.name} disabled={!!usage}>
                      {r.name}
                      {usage ? ` (使用中: ${usage.対応者})` : ''}
                    </option>
                  )
                })}
              </select>
            </div>
          </div>
        </div>

        <div className="form-group">
          <label className="form-label">
            顧客名 <span className="hint">（必須・最大10名）</span>
          </label>
          <div className="customer-names">
            {customerNames.map((n, i) => (
              <div key={i} className="customer-name-row">
                <input
                  type="text"
                  className="form-input"
                  placeholder={i === 0 ? '顧客名' : `顧客名 ${i + 1}`}
                  value={n}
                  onChange={(e) => updateCustName(i, e.target.value)}
                  autoComplete="off"
                />
                {i === customerNames.length - 1 && customerNames.length < 10 ? (
                  <button
                    type="button"
                    className="btn-cust-add"
                    onClick={addCustName}
                    title="追加"
                  >
                    ＋
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-cust-rm"
                    onClick={() => removeCustName(i)}
                    title="削除"
                  >
                    －
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">
          <span>料金</span>
          {room && (
            <span
              className={`badge ${serviceType === 'vip' ? 'badge-vip' : 'badge-normal'}`}
              style={{ marginLeft: 8, fontSize: 12 }}
            >
              {serviceType === 'vip' && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
              {serviceType === 'vip' ? 'VIP' : '通常'}
            </span>
          )}
        </div>
        <div className="pricing-grid">
          {pricing.map((p) => (
            <div
              key={p.key}
              className={`pricing-item${
                room && p.key !== 'option' && p.key !== serviceType ? ' dimmed' : ''
              }`}
            >
              <div className="pricing-item-label">{p.label}</div>
              <div className="pricing-item-value">{fmtCurrency(p.price)}</div>
              <div className="pricing-item-unit">{p.key === 'option' ? '/ 1回' : '/ 30分'}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <div className="card-title">備考</div>
        <textarea
          className="form-input"
          placeholder="備考（任意）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="card">
        <div className="card-title">席代の目安（任意）</div>
        <div className="form-group">
          <label className="form-label">予定時間</label>
          <div className="select-wrap">
            <select
              className="form-select"
              value={presetSlots}
              onChange={(e) => setPresetSlots(Number(e.target.value))}
            >
              {PRESET_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        {presetSlots > 0 && servicePrice && (
          <div className="seat-fee-preview">
            席代の目安: <strong>{fmtCurrency(seatFeeEstimate)}</strong>
            <span className="muted">
              （{servicePrice.label} × {numCustomers}名 × {presetSlots}口）
            </span>
          </div>
        )}
      </div>

      <button className="btn-primary btn-start" disabled={!canSubmit} onClick={attemptStart}>
        {busy ? '処理中...' : '応対開始'}
      </button>

      {blWarning && (
        <Modal onClose={() => setBlWarning(null)}>
          <h3>
            <AlertTriangle size={18} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--red)' }} />
            ブラックリスト該当
          </h3>
          <p className="muted">以下の顧客がブラックリストに登録されています:</p>
          <ul className="bl-list">
            {blWarning.map((m) => (
              <li key={m.name}>
                <strong>{m.name}</strong>
                {m.reason && <span className="muted">（{m.reason}）</span>}
              </li>
            ))}
          </ul>
          <p className="muted">それでも応対を開始しますか？</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setBlWarning(null)}>
              キャンセル
            </button>
            <button className="btn-finish" onClick={callStart}>続行</button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
