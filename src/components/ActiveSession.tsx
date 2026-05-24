import { useCallback, useEffect, useRef, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import { fmtCurrency, fmtTime } from '../lib/format'
import Modal from './Modal'
import { useToast } from './Toast'
import './ActiveSession.css'

export interface ActiveSessionData {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  顧客数: number
  接客種別: string
  接客種別表示名: string
  基本単価: number
  オプション単価: number
  開始時間: string
  対応終了時間: string
  延長回数: number
  オプション回数: number
  備考: string
  収益金: number
}

interface FinishBreakdown {
  total: number
  basePrice: number
  extendPrice: number
  extendCount: number
  optionPrice: number
  optionCount: number
}

const REMINDER_THRESHOLD_MS = 5 * 60 * 1000
const POLL_INTERVAL_MS = 60 * 1000

interface Props {
  api: AkariApi
  castName: string
  onChanged?: () => void  // セッション開始/終了時に親に通知（StartSessionForm再表示用）
}

export default function ActiveSession({ api, castName, onChanged }: Props) {
  const [session, setSession] = useState<ActiveSessionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [finishOpen, setFinishOpen] = useState(false)
  const [finishNote, setFinishNote] = useState('')
  const [breakdown, setBreakdown] = useState<FinishBreakdown | null>(null)
  const [reminderOpen, setReminderOpen] = useState(false)
  const [_tick, setTick] = useState(0)
  const reminderShownRef = useRef<string | null>(null)
  const toast = useToast()

  const reload = useCallback(async () => {
    setLoading(true)
    const r = await api.call<ActiveSessionData | null>('getActiveSession', castName)
    setLoading(false)
    if (r.ok) {
      const prevId = session?.session_id
      const newId = r.data?.session_id
      setSession(r.data)
      if (!r.data) reminderShownRef.current = null
      if (prevId !== newId) onChanged?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, castName])

  useEffect(() => {
    reload()
    const t = setInterval(reload, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [reload])

  useEffect(() => {
    if (!session?.対応終了時間) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [session?.対応終了時間])

  useEffect(() => {
    if (!session) return
    const endMs = new Date(session.対応終了時間).getTime()
    if (isNaN(endMs)) return
    const left = endMs - Date.now()
    if (left > 0 && left <= REMINDER_THRESHOLD_MS && reminderShownRef.current !== session.session_id) {
      reminderShownRef.current = session.session_id
      setReminderOpen(true)
    }
  })

  async function doAction(
    label: string,
    fn: () => Promise<{ ok: boolean; data?: ActiveSessionData; error?: string }>,
    successMsg: string,
  ) {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    if (r.ok) {
      if (r.data) setSession(r.data)
      else reload()
      toast.show(successMsg)
      if (label === 'extend') reminderShownRef.current = null
    } else {
      toast.show(r.error || `${label}に失敗しました`, 'err')
    }
  }

  async function onExtend() {
    if (!session) return
    await doAction(
      'extend',
      () => api.call<ActiveSessionData>('extendSession', session.session_id),
      '30分延長しました',
    )
  }

  async function onOption() {
    if (!session) return
    await doAction(
      'option',
      () => api.call<ActiveSessionData>('addOption', session.session_id),
      'オプションを追加しました',
    )
  }

  async function onFinishConfirm() {
    if (!session) return
    setBusy(true)
    const r = await api.call<{ breakdown: FinishBreakdown }>('finishSession', {
      sessionId: session.session_id,
      note: finishNote.trim(),
    })
    setBusy(false)
    setFinishOpen(false)
    setFinishNote('')
    if (r.ok) {
      setSession(null)
      reminderShownRef.current = null
      if (r.data?.breakdown) setBreakdown(r.data.breakdown)
      else toast.show('応対を終了しました')
      onChanged?.()
    } else {
      toast.show(r.error || '終了に失敗しました', 'err')
    }
  }

  if (loading && !session) {
    return <div className="card"><p className="muted">読み込み中...</p></div>
  }
  if (!session) {
    return null  // セッション無しの表示は親（SessionTab）に任せる
  }

  const endMs = new Date(session.対応終了時間).getTime()
  const isWarning = !isNaN(endMs) && endMs - Date.now() <= REMINDER_THRESHOLD_MS

  return (
    <>
      <div className="session-card">
        <div className="session-header">
          <div className="status-dot" />
          <span className="status-label">応対中</span>
          <div className="revenue-badge">
            <div className="revenue-badge-label">収益金</div>
            <div className="revenue-badge-value">{fmtCurrency(session.収益金)}</div>
          </div>
        </div>
        <div className="session-times">
          <div>
            <div className="session-time-label">開始時間</div>
            <div className="session-time-value">{fmtTime(session.開始時間)}</div>
          </div>
          <div>
            <div className="session-time-label">終了予定時間</div>
            <div className={`session-time-value${isWarning ? ' warning' : ''}`}>
              {fmtTime(session.対応終了時間)}
            </div>
          </div>
        </div>
        <div className="session-grid">
          <Field label="対応者" value={session.対応者} />
          <Field label="ルーム" value={session.ルーム} />
          <Field label="顧客名" value={session.顧客名} />
          <Field
            label="接客種別"
            value={
              <span className={`badge ${session.接客種別 === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
                {session.接客種別 === 'vip' ? '✦ ' : ''}
                {session.接客種別表示名 || session.接客種別}
              </span>
            }
          />
          <Field label="基本単価" value={fmtCurrency(session.基本単価)} className="c-gold" />
          <Field label="延長回数" value={`${session.延長回数 ?? 0}回`} />
          <Field label="オプション" value={`${session.オプション回数 ?? 0}回`} className="c-purple" />
        </div>
      </div>
      <div className="btn-action-grid">
        <button className="btn-extend" onClick={onExtend} disabled={busy}>↺ 延長 +30分</button>
        <button className="btn-option" onClick={onOption} disabled={busy}>✦ オプション</button>
        <button className="btn-finish" onClick={() => setFinishOpen(true)} disabled={busy}>■ 終了</button>
      </div>

      {finishOpen && (
        <Modal onClose={() => !busy && setFinishOpen(false)}>
          <h3>応対を終了しますか？</h3>
          <p className="muted">最終的な備考があれば記入してください。</p>
          <textarea
            className="form-input"
            placeholder="備考（任意）"
            value={finishNote}
            onChange={(e) => setFinishNote(e.target.value)}
          />
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setFinishOpen(false)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-finish" onClick={onFinishConfirm} disabled={busy}>
              {busy ? '処理中...' : '終了する'}
            </button>
          </div>
        </Modal>
      )}

      {breakdown && (
        <Modal onClose={() => setBreakdown(null)}>
          <h3>今回の収益</h3>
          <div className="breakdown-total">
            <div className="breakdown-total-label">合計</div>
            <div className="breakdown-total-value">{fmtCurrency(breakdown.total)}</div>
          </div>
          <div className="breakdown-row">
            <span>基本料金</span><span>{fmtCurrency(breakdown.basePrice)}</span>
          </div>
          <div className="breakdown-row">
            <span>延長（{breakdown.extendCount}回）</span><span>{fmtCurrency(breakdown.extendPrice)}</span>
          </div>
          <div className="breakdown-row">
            <span>オプション（{breakdown.optionCount}回）</span><span>{fmtCurrency(breakdown.optionPrice)}</span>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setBreakdown(null)}>閉じる</button>
          </div>
        </Modal>
      )}

      {reminderOpen && (
        <Modal onClose={() => setReminderOpen(false)}>
          <h3>⏰ もうすぐ終了時刻です</h3>
          <p>終了予定時間まで5分を切りました。延長または終了の準備をしてください。</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setReminderOpen(false)}>閉じる</button>
          </div>
        </Modal>
      )}

      {toast.element}
    </>
  )
}

function Field({
  label,
  value,
  className,
}: {
  label: string
  value: React.ReactNode
  className?: string
}) {
  return (
    <div>
      <div className="session-field-label">{label}</div>
      <div className={`session-field-value ${className || ''}`}>{value}</div>
    </div>
  )
}
