import { useCallback, useEffect, useRef, useState } from 'react'
import { db } from '../lib/db'
import { useSessionUpdates } from '../lib/useRealtimeSessions'
import { fmtCurrency, fmtTime } from '../lib/format'
import { Crown, RotateCw, Sparkles, Stop, Clock, ListChecks, TrendingUp, Play, Plus, Minus } from '../icons'
import Modal from './Modal'
import Tooltip from './Tooltip'
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
  castName: string
  onChanged?: () => void  // セッション開始/終了時に親に通知（StartSessionForm再表示用）
  onNavigate?: (route: 'history' | 'revenue') => void  // 終了モーダルから他タブへ
}

export default function ActiveSession({ castName, onChanged, onNavigate }: Props) {
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
    const r = await db.call<ActiveSessionData | null>('getActiveSession', castName)
    setLoading(false)
    if (r.ok) {
      const prevId = session?.session_id
      const newId = r.data?.session_id
      setSession(r.data)
      if (!r.data) reminderShownRef.current = null
      if (prevId !== newId) onChanged?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [castName])

  useEffect(() => {
    reload()
    const t = setInterval(reload, POLL_INTERVAL_MS)
    return () => clearInterval(t)
  }, [reload])

  // Realtime: 自分のセッションが変更されたら即時再取得（管理者による編集・強制終了等）
  useSessionUpdates(session?.session_id ?? null, reload)

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
      () => db.call<ActiveSessionData>('extendSession', session.session_id),
      '30分延長しました',
    )
  }

  async function onOption() {
    if (!session) return
    await doAction(
      'option',
      () => db.call<ActiveSessionData>('addOption', session.session_id),
      'オプションを追加しました',
    )
  }

  async function onReduceExtend() {
    if (!session || (session.延長回数 ?? 0) <= 0) return
    await doAction(
      'extend',
      () => db.call<ActiveSessionData>('reduceExtend', session.session_id),
      '延長を1回取り消しました',
    )
  }

  async function onReduceOption() {
    if (!session || (session.オプション回数 ?? 0) <= 0) return
    await doAction(
      'option',
      () => db.call<ActiveSessionData>('reduceOption', session.session_id),
      'オプションを1回取り消しました',
    )
  }

  async function onFinishConfirm() {
    if (!session) return
    setBusy(true)
    const r = await db.call<{ breakdown: FinishBreakdown }>('finishSession', {
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
                {session.接客種別 === 'vip' && <Crown size={12} style={{ marginRight: 4, verticalAlign: '-2px' }} />}
                {session.接客種別表示名 || session.接客種別}
              </span>
            }
          />
          <Field label="基本単価" value={fmtCurrency(session.基本単価)} className="c-gold" />
        </div>
        <div className="session-steppers">
          <Stepper
            icon={<RotateCw size={15} />}
            label="延長"
            sub="+30分/回"
            value={session.延長回数 ?? 0}
            accent="teal"
            onMinus={onReduceExtend}
            onPlus={onExtend}
            busy={busy}
            minusTip="延長を1回取り消す（終了予定を30分戻す）"
            plusTip="終了予定を30分のばす（料金加算）"
          />
          <Stepper
            icon={<Sparkles size={15} />}
            label="オプション"
            sub="1回ごと加算"
            value={session.オプション回数 ?? 0}
            accent="purple"
            onMinus={onReduceOption}
            onPlus={onOption}
            busy={busy}
            minusTip="オプションを1回取り消す"
            plusTip="オプションを1回追加する（料金加算）"
          />
        </div>
      </div>
      <div className="btn-action-grid single">
        <Tooltip content="この接客を終了する">
          <button className="btn-finish" onClick={() => setFinishOpen(true)} disabled={busy}>
            <Stop size={16} />
            <span>終了</span>
          </button>
        </Tooltip>
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

          <p className="muted small" style={{ marginTop: 16, marginBottom: 8, textAlign: 'center' }}>
            このあと何をしますか？
          </p>
          <div className="breakdown-next-actions">
            {onNavigate && (
              <>
                <button
                  className="breakdown-next-btn"
                  onClick={() => {
                    setBreakdown(null)
                    onNavigate('history')
                  }}
                >
                  <ListChecks size={18} className="breakdown-next-icon" />
                  <span className="breakdown-next-label">履歴を確認・編集</span>
                </button>
                <button
                  className="breakdown-next-btn"
                  onClick={() => {
                    setBreakdown(null)
                    onNavigate('revenue')
                  }}
                >
                  <TrendingUp size={18} className="breakdown-next-icon" />
                  <span className="breakdown-next-label">今日の売上を確認</span>
                </button>
              </>
            )}
            <button
              className="breakdown-next-btn secondary"
              onClick={() => setBreakdown(null)}
            >
              <Play size={16} className="breakdown-next-icon" />
              <span className="breakdown-next-label">次の接客を準備</span>
            </button>
          </div>
        </Modal>
      )}

      {reminderOpen && (
        <Modal onClose={() => setReminderOpen(false)}>
          <h3>
            <Clock size={18} style={{ verticalAlign: '-3px', marginRight: 6 }} />
            もうすぐ終了時刻です
          </h3>
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

function Stepper({
  icon,
  label,
  sub,
  value,
  accent,
  onMinus,
  onPlus,
  busy,
  minusTip,
  plusTip,
}: {
  icon: React.ReactNode
  label: string
  sub: string
  value: number
  accent: 'teal' | 'purple'
  onMinus: () => void
  onPlus: () => void
  busy: boolean
  minusTip: string
  plusTip: string
}) {
  return (
    <div className={`stepper-row stepper-${accent}`}>
      <div className="stepper-info">
        <div className="stepper-label">
          {icon}
          <span>{label}</span>
        </div>
        <div className="stepper-sub">{sub}</div>
      </div>
      <div className="stepper-control">
        <Tooltip content={minusTip}>
          <button
            className="stepper-btn"
            onClick={onMinus}
            disabled={busy || value <= 0}
            aria-label={`${label}を減らす`}
          >
            <Minus size={16} />
          </button>
        </Tooltip>
        <span className="stepper-value">{value}回</span>
        <Tooltip content={plusTip}>
          <button
            className="stepper-btn"
            onClick={onPlus}
            disabled={busy}
            aria-label={`${label}を増やす`}
          >
            <Plus size={16} />
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
