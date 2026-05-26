import { useCallback, useEffect, useState } from 'react'
import { db, type SessionShape, type ReservationShape, type RevenueStatus } from '../lib/db'
import { useActiveSessions, useRealtimeReservations } from '../lib/useRealtimeSessions'
import { fmtCurrency, fmtTime, jstToday } from '../lib/format'
import {
  MessageSquare,
  Home as HomeIcon,
  Calendar,
  TrendingUp,
  Play,
  Clock,
} from '../icons'
import StatusCard from './StatusCard'
import type { RouteId } from './Sidebar'
import './HomeView.css'

interface Props {
  castName: string
  onNavigate: (id: RouteId) => void
}

export default function HomeView({ castName, onNavigate }: Props) {
  return (
    <div className="home-view">
      <header className="home-header">
        <p className="home-greet">こんにちは、<strong>{castName}</strong> さん。</p>
        <p className="home-sub muted">今日の状況をひと目で確認できます。</p>
      </header>

      <div className="home-grid">
        <ActiveSessionCard castName={castName} onNavigate={onNavigate} />
        <RoomUsageCard onNavigate={onNavigate} />
        <TodayReservationsCard castName={castName} onNavigate={onNavigate} />
        <TodayRevenueCard castName={castName} onNavigate={onNavigate} />
      </div>
    </div>
  )
}

// ============================================================
// カード1: 現在の接客状況
// ============================================================
function ActiveSessionCard({
  castName,
  onNavigate,
}: {
  castName: string
  onNavigate: (id: RouteId) => void
}) {
  const [session, setSession] = useState<SessionShape | null>(null)
  const [loading, setLoading] = useState(true)
  const [tick, setTick] = useState(0)
  const { sessions } = useActiveSessions()  // リアルタイム同期で間接的に再フェッチ

  const reload = useCallback(async () => {
    const r = await db.call<SessionShape | null>('getActiveSession', castName)
    if (r.ok) setSession(r.data)
    setLoading(false)
  }, [castName])

  useEffect(() => {
    reload()
  }, [reload, sessions.length])

  useEffect(() => {
    if (!session?.対応終了時間) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.対応終了時間])

  // 残り時間計算
  const endMs = session ? new Date(session.対応終了時間).getTime() : 0
  const leftMs = endMs - Date.now()
  const leftMin = Math.max(0, Math.floor(leftMs / 60000))
  const leftSec = Math.max(0, Math.floor((leftMs % 60000) / 1000))
  const warning = leftMs > 0 && leftMs <= 5 * 60 * 1000
  const overdue = leftMs <= 0 && session

  if (loading) {
    return (
      <StatusCard title="現在の接客状況" icon={<MessageSquare size={16} />} accent="teal">
        <p className="muted small">読み込み中...</p>
      </StatusCard>
    )
  }

  if (!session) {
    return (
      <StatusCard
        title="現在の接客状況"
        icon={<MessageSquare size={16} />}
        accent="teal"
      >
        <p className="muted small" style={{ minHeight: 24 }}>進行中の接客はありません。</p>
        <button
          type="button"
          className="status-card-cta"
          onClick={() => onNavigate('session')}
        >
          <Play size={14} style={{ marginRight: 6, verticalAlign: 'middle' }} />
          応対を開始する
        </button>
      </StatusCard>
    )
  }

  // void で参照（再描画用、未使用警告を抑制）
  void tick

  return (
    <StatusCard
      title="現在の接客状況"
      icon={<MessageSquare size={16} />}
      accent="teal"
      onClick={() => onNavigate('session')}
      actionLabel="詳細を見る"
      emphasized
    >
      <div className="home-active-row">
        <div className="home-active-time">
          <Clock size={14} />
          <span className={overdue ? 'overdue' : warning ? 'warning' : ''}>
            {overdue ? '時間超過' : `残り ${leftMin}:${String(leftSec).padStart(2, '0')}`}
          </span>
        </div>
        <div className="home-active-end muted small">〜 {fmtTime(session.対応終了時間)}</div>
      </div>
      <div className="status-card-row">
        <span className="status-card-row-label">ルーム</span>
        <span className="status-card-row-value">{session.ルーム || '—'}</span>
      </div>
      <div className="status-card-row">
        <span className="status-card-row-label">顧客</span>
        <span className="status-card-row-value">{session.顧客名 || '—'}</span>
      </div>
      <div className="status-card-row">
        <span className="status-card-row-label">収益（現時点）</span>
        <span className="status-card-row-value c-gold">{fmtCurrency(session.収益金)}</span>
      </div>
    </StatusCard>
  )
}

// ============================================================
// カード2: 現在使用中のルーム（残り時間タイマー付き）
// ============================================================

function roomTimerInfo(endTimeIso: string): { text: string; cls: string } {
  const leftMs = new Date(endTimeIso).getTime() - Date.now()
  if (leftMs <= 0) return { text: '超過', cls: 'overdue' }
  const min = Math.floor(leftMs / 60000)
  const sec = Math.floor((leftMs % 60000) / 1000)
  const warning = leftMs <= 5 * 60 * 1000
  return { text: `${min}:${String(sec).padStart(2, '0')}`, cls: warning ? 'warning' : '' }
}

function RoomUsageCard({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const { sessions, loading } = useActiveSessions()
  const [, setTick] = useState(0)

  useEffect(() => {
    if (sessions.length === 0) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [sessions.length])

  return (
    <StatusCard
      title="現在使用中のルーム"
      icon={<HomeIcon size={16} />}
      accent="green"
      onClick={() => onNavigate('session')}
      actionLabel={`${sessions.length}件`}
    >
      {loading && <p className="muted small">読み込み中...</p>}
      {!loading && sessions.length === 0 && (
        <p className="muted small">すべてのルームが空いています。</p>
      )}
      {!loading && sessions.length > 0 && (
        <ul className="home-rooms">
          {sessions.slice(0, 4).map((s) => {
            const { text, cls } = roomTimerInfo(s.対応終了時間)
            return (
              <li key={s.session_id} className="home-rooms-item">
                <span className="home-rooms-room">{s.ルーム || '—'}</span>
                <span className="muted home-rooms-cast">{s.対応者}</span>
                <span className={`home-rooms-timer${cls ? ` ${cls}` : ''}`}>{text}</span>
              </li>
            )
          })}
          {sessions.length > 4 && (
            <li className="muted small">他 {sessions.length - 4} 件…</li>
          )}
        </ul>
      )}
    </StatusCard>
  )
}

// ============================================================
// カード3: 今日の予約
// ============================================================
function TodayReservationsCard({
  castName,
  onNavigate,
}: {
  castName: string
  onNavigate: (id: RouteId) => void
}) {
  const [list, setList] = useState<ReservationShape[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const r = await db.call<ReservationShape[]>('getReservations')
    setLoading(false)
    if (!r.ok) return
    const today = jstToday()
    const mine = (r.data || []).filter((res) => {
      if (res.キャスト名 !== castName) return false
      const d = new Date(res.予約日時)
      if (isNaN(d.getTime())) return false
      const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
      const dateStr = `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`
      return dateStr === today
    })
    mine.sort((a, b) => new Date(a.予約日時).getTime() - new Date(b.予約日時).getTime())
    setList(mine)
  }, [castName])

  useEffect(() => { load() }, [load])
  useRealtimeReservations(load)

  return (
    <StatusCard
      title="今日の予約（自分）"
      icon={<Calendar size={16} />}
      accent="gold"
      onClick={() => onNavigate('reservation')}
      actionLabel={`${list.length}件`}
    >
      {loading && <p className="muted small">読み込み中...</p>}
      {!loading && list.length === 0 && (
        <p className="muted small">本日の自分の予約はありません。</p>
      )}
      {!loading && list.length > 0 && (
        <ul className="home-reservations">
          {list.slice(0, 4).map((r) => (
            <li key={r.reservation_id}>
              <span className="home-reservations-time">{fmtTime(r.予約日時)}</span>
              <span className="home-reservations-customer">{r.顧客名 || '（顧客未指定）'}</span>
              {r.ルーム && <span className="muted small">{r.ルーム}</span>}
            </li>
          ))}
          {list.length > 4 && (
            <li className="muted small">他 {list.length - 4} 件…</li>
          )}
        </ul>
      )}
    </StatusCard>
  )
}

// ============================================================
// カード4: 今日の売上（自分）
// ============================================================
function TodayRevenueCard({
  castName,
  onNavigate,
}: {
  castName: string
  onNavigate: (id: RouteId) => void
}) {
  const [data, setData] = useState<RevenueStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const { sessions } = useActiveSessions()

  const reload = useCallback(async () => {
    const r = await db.call<RevenueStatus>('getRevenueStatus')
    setLoading(false)
    if (r.ok) setData(r.data)
  }, [])

  useEffect(() => {
    reload()
  }, [reload, sessions.length])

  const mine = data?.casts.find((c) => c.cast === castName)

  return (
    <StatusCard
      title="今日の売上（自分）"
      icon={<TrendingUp size={16} />}
      accent="green"
      onClick={() => onNavigate('revenue')}
      actionLabel="詳細を見る"
    >
      {loading && <p className="muted small">読み込み中...</p>}
      {!loading && !mine && (
        <>
          <div className="status-card-big">¥0</div>
          <p className="muted small">本日の応対はまだありません。</p>
        </>
      )}
      {!loading && mine && (
        <>
          <div className="status-card-big">{fmtCurrency(mine.revenue)}</div>
          <div className="status-card-row">
            <span className="status-card-row-label">給与（自分の取り分）</span>
            <span className="status-card-row-value c-gold">{fmtCurrency(mine.salary)}</span>
          </div>
          <div className="muted small">{data?.businessDay}</div>
        </>
      )}
    </StatusCard>
  )
}
