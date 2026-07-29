import { useEffect, useState } from 'react'
import { getReservationTimeStep, setReservationTimeStep } from '../../lib/db'
import { useToast } from '../Toast'
import './AdminCommon.css'

// 予約時刻の入力単位の選択肢（秒）
const STEP_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1秒単位（即時対応をそのままの時刻で記録）' },
  { value: 60, label: '1分単位' },
  { value: 300, label: '5分単位' },
  { value: 600, label: '10分単位' },
  { value: 900, label: '15分単位' },
  { value: 1800, label: '30分単位' },
]

export default function StoreSettingsAdmin() {
  const [step, setStep] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toast = useToast()

  useEffect(() => {
    (async () => {
      try {
        setStep(await getReservationTimeStep())
      } catch (e) {
        setErr((e as Error).message)
      }
    })()
  }, [])

  async function save(next: number) {
    setBusy(true)
    try {
      await setReservationTimeStep(next)
      setStep(next)
      toast.show('予約時刻の入力単位を保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // DB に選択肢以外の値が入っていても表示できるよう先頭に補う
  const options =
    step !== null && !STEP_OPTIONS.some((o) => o.value === step)
      ? [{ value: step, label: `${step}秒単位` }, ...STEP_OPTIONS]
      : STEP_OPTIONS

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>店舗設定</h3>
      </div>
      <p className="muted small">店舗全体で共有される設定です。変更するとすぐ保存されます。</p>

      {err && <p className="err">エラー: {err}</p>}

      <div className="card">
        <div className="form-group">
          <label className="form-label">予約時刻の入力単位</label>
          <p className="muted small" style={{ marginTop: 0 }}>
            予約フォームの時刻入力の刻みです。「1秒単位」にすると「現在時刻を入力」が丸めなしで入り、
            それ以外は選んだ刻みに丸められます。
          </p>
          {step === null && !err ? (
            <p className="muted">読み込み中...</p>
          ) : step !== null ? (
            <div className="select-wrap">
              <select
                className="form-select"
                value={step}
                onChange={(e) => save(Number(e.target.value))}
                disabled={busy}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </div>

      {toast.element}
    </div>
  )
}
