import { useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import { fmtCurrency } from '../lib/format'
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
  api: AkariApi
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

export default function StartSessionForm({ api, castName, onStarted }: Props) {
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [room, setRoom] = useState('')
  const [customerNames, setCustomerNames] = useState<string[]>([''])
  const [note, setNote] = useState('')
  const [presetSlots, setPresetSlots] = useState(0)
  const [busy, setBusy] = useState(false)
  const [blWarning, setBlWarning] = useState<BlMatch[] | null>(null)
  const toast = useToast()

  useEffect(() => {
    (async () => {
      const [rRoom, rPrice] = await Promise.all([
        api.call<{ casts: string[]; rooms: string[]; roomsData: RoomData[] }>('getCastsAndRooms'),
        api.call<PricingEntry[]>('getPricing'),
      ])
      if (rRoom.ok && rRoom.data.roomsData) setRooms(rRoom.data.roomsData)
      if (rPrice.ok) setPricing(rPrice.data)
    })()
  }, [api])

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
      // checkRoomAvailability は GAS 側でフラット形式 ({ok, available, usedBy}) を返す
      const rRoom = await api.call('checkRoomAvailability', room) as
        | { ok: true; available: boolean; usedBy?: string }
        | { ok: false; error: string }
      if (!rRoom.ok) {
        toast.show(rRoom.error || 'ルーム確認に失敗しました', 'err')
        return
      }
      if (!rRoom.available) {
        toast.show(`「${room}」は現在 ${rRoom.usedBy || '他のキャスト'} が使用中です`, 'err')
        return
      }
      // 2) ブラックリストチェック（複数顧客で並列）
      const blResults = await Promise.all(
        filledCustomerNames.map((name) => api.call<BlMatch[]>('checkBlacklist', name)),
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
      const r = await api.call('startSession', {
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
                <option value="">選択</option>
                {rooms.map((r) => (
                  <option key={r.name} value={r.name}>
                    {r.vip === 1 ? '✦ ' : ''}
                    {r.name}
                  </option>
                ))}
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
              {serviceType === 'vip' ? '✦ VIP' : '通常'}
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
          <h3>⚠ ブラックリスト該当</h3>
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
