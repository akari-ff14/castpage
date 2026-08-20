import { useEffect, useState } from 'react'
import {
  getPublicNotice,
  getReservationTimeStep,
  setPublicNotice,
  setReservationTimeStep,
} from '../../lib/db'
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
  // 公開ページに出す案内文
  const [notice, setNotice] = useState('')
  const [savedNotice, setSavedNotice] = useState('')
  const [noticeBusy, setNoticeBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    (async () => {
      try {
        setStep(await getReservationTimeStep())
        const n = await getPublicNotice()
        setNotice(n)
        setSavedNotice(n)
      } catch (e) {
        setErr((e as Error).message)
      }
    })()
  }, [])

  async function saveNotice() {
    setNoticeBusy(true)
    try {
      await setPublicNotice(notice)
      setSavedNotice(notice)
      toast.show('案内文を保存しました。お客様のページに反映されます')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setNoticeBusy(false)
    }
  }

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

      <div className="card">
        <div className="form-group">
          <label className="form-label" htmlFor="public-notice">お客様の予約ページに出す案内</label>
          <p className="muted small" style={{ marginTop: 0 }}>
            料金、当日の流れ、場所、注意事項など。予約ページの一番上に出ます。
            空欄にすると何も表示されません。
          </p>
          <textarea
            id="public-notice"
            className="form-input"
            rows={7}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder={'例）\n・1枠60分、お一人 8,000円です\n・お時間の5分前にお越しください\n・ご確定後のキャンセルはご予約ページから行えます'}
          />
          <div className="store-notice-actions">
            <button className="btn-primary" onClick={saveNotice} disabled={noticeBusy || notice === savedNotice}>
              {noticeBusy ? '保存中...' : notice === savedNotice ? '保存済み' : '案内を保存'}
            </button>
            {notice !== savedNotice && (
              <button className="btn-secondary" onClick={() => setNotice(savedNotice)} disabled={noticeBusy}>
                元に戻す
              </button>
            )}
          </div>
        </div>
      </div>

      {toast.element}
    </div>
  )
}
