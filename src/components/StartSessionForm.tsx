import { useEffect, useMemo, useState } from 'react'
import { db } from '../lib/db'
import { fmtCurrency, fmtTime } from '../lib/format'
import { useActiveSessions } from '../lib/useRealtimeSessions'
import { Crown, AlertTriangle, Plus, Minus, Play, Users, Home, Clock } from '../icons'
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

export interface SessionPreset {
  customerName: string
  room: string
  reservationId?: string   // 予約から開始した場合のみ。開始後にその予約をタイムラインから消す
}

interface Props {
  castName: string
  onStarted: () => void
  preset?: SessionPreset | null
  onPresetConsumed?: () => void
}

// 予定時間ボタン群: value は 30分単位の口数
const DURATIONS = [
  { value: 0, label: 'なし' },
  { value: 1, label: '30分' },
  { value: 2, label: '1時間' },
  { value: 3, label: '1.5時間' },
  { value: 4, label: '2時間' },
  { value: 5, label: '2.5時間' },
  { value: 6, label: '3時間' },
]

export default function StartSessionForm({ castName, onStarted, preset, onPresetConsumed }: Props) {
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [room, setRoom] = useState(preset?.room || '')
  // 予約由来の顧客名はカンマ/読点区切りの複数名（お連れ様）を各入力欄に展開する
  const [customerNames, setCustomerNames] = useState<string[]>(() => {
    const names = String(preset?.customerName || '')
      .split(/[,、]/)
      .map((s) => s.trim())
      .filter(Boolean)
    return names.length ? names : ['']
  })
  const [note, setNote] = useState('')
  // 予約由来の場合だけ保持（preset は mount 直後に親側で null に戻されるため初期値で確保）
  const [reservationId] = useState(preset?.reservationId)
  const [presetSlots, setPresetSlots] = useState(0)
  const [busy, setBusy] = useState(false)
  const [blWarning, setBlWarning] = useState<BlMatch[] | null>(null)
  const toast = useToast()

  // 全キャストの進行中セッションをリアルタイム購読
  const { sessions: activeSessions } = useActiveSessions()
  const roomUsage = useMemo(() => {
    const m = new Map<string, typeof activeSessions[number]>()
    for (const s of activeSessions) {
      if (s.ルーム) m.set(s.ルーム, s)
    }
    return m
  }, [activeSessions])

  useEffect(() => {
    if (preset) onPresetConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const blocker = !filledCustomerNames.length
    ? 'お客様の名前を入力してください'
    : !room
    ? 'ルームを選んでください'
    : ''

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
      const rRoom = await db.call<{ available: boolean; usedBy?: string }>('checkRoomAvailability', room)
      if (!rRoom.ok) {
        toast.show(rRoom.error || 'ルーム確認に失敗しました', 'err')
        return
      }
      if (!rRoom.data.available) {
        toast.show(`「${room}」は現在 ${rRoom.data.usedBy || '他のキャスト'} が使用中です`, 'err')
        return
      }
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
        reservationId,
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
      {/* 現在使用中（リアルタイム反映、密表示） */}
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

      {/* Step 1: 顧客名 */}
      <section className="step-card">
        <header className="step-header">
          <span className="step-num">1</span>
          <Users size={16} className="step-icon" />
          <h3 className="step-title">お客様の名前</h3>
          <span className="step-badge required">必須</span>
        </header>
        <div className="customer-names">
          {customerNames.map((n, i) => (
            <div key={i} className="customer-name-row">
              <input
                type="text"
                className="form-input"
                placeholder={i === 0 ? 'お客様の名前を入力' : `お客様 ${i + 1}`}
                value={n}
                onChange={(e) => updateCustName(i, e.target.value)}
                autoComplete="off"
              />
              {i === customerNames.length - 1 && customerNames.length < 10 ? (
                <button
                  type="button"
                  className="btn-cust-add"
                  onClick={addCustName}
                  title="もう1名追加"
                  aria-label="お客様を追加"
                >
                  <Plus size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-cust-rm"
                  onClick={() => removeCustName(i)}
                  title="この欄を削除"
                  aria-label="このお客様を削除"
                >
                  <Minus size={18} />
                </button>
              )}
            </div>
          ))}
        </div>
        <p className="step-hint">複数名なら「＋」で追加（最大10名）</p>
      </section>

      {/* Step 2: ルーム */}
      <section className="step-card">
        <header className="step-header">
          <span className="step-num">2</span>
          <Home size={16} className="step-icon" />
          <h3 className="step-title">ルーム</h3>
          <span className="step-badge required">必須</span>
        </header>
        <div className="select-wrap">
          <select
            className="form-select"
            value={room}
            onChange={(e) => setRoom(e.target.value)}
          >
            <option value="">選んでください</option>
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
        {room && servicePrice && (
          <div className="step-price-chip">
            <span className={`badge ${serviceType === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
              {serviceType === 'vip' && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
              {serviceType === 'vip' ? 'VIP' : '通常'}
            </span>
            <span className="muted small">
              料金 <strong className="c-gold">{fmtCurrency(servicePrice.price)}</strong> / 30分
            </span>
          </div>
        )}
      </section>

      {/* Step 3: 予定時間 */}
      <section className="step-card">
        <header className="step-header">
          <span className="step-num">3</span>
          <Clock size={16} className="step-icon" />
          <h3 className="step-title">予定時間</h3>
          <span className="step-badge optional">任意</span>
        </header>
        <div className="duration-grid">
          {DURATIONS.map((d) => (
            <button
              key={d.value}
              type="button"
              className={`duration-btn ${presetSlots === d.value ? 'active' : ''}`}
              onClick={() => setPresetSlots(d.value)}
            >
              {d.label}
            </button>
          ))}
        </div>
        {presetSlots > 0 && servicePrice && (
          <div className="step-fee-preview">
            <span className="muted small">
              {numCustomers}名 × {presetSlots}コマ ＝
            </span>
            <strong className="step-fee-amount">{fmtCurrency(seatFeeEstimate)}</strong>
            <span className="muted small">の見込み</span>
          </div>
        )}
        <p className="step-hint">後で「延長」ボタンで30分ずつ追加できます。指定しなくてもOK。</p>
      </section>

      {/* 備考（折りたたみ） */}
      <details className="note-collapse">
        <summary>備考を追加する（任意）</summary>
        <textarea
          className="form-input"
          placeholder="特記事項があれば（例：常連、注意事項など）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </details>

      {/* 応対開始 */}
      <button
        type="button"
        className="btn-start-cta"
        disabled={!canSubmit}
        onClick={attemptStart}
        title={blocker || '応対を開始'}
      >
        {busy ? (
          '処理中...'
        ) : (
          <>
            <Play size={18} />
            <span>応対開始</span>
          </>
        )}
      </button>
      {blocker && !busy && (
        <p className="start-blocker-hint">{blocker}</p>
      )}

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
