// スタッフの受付ボード
//
// 電話やチャットで「今から入れますか？」と聞かれたときに、この1画面で答えられるようにする。
// 見たいのは 3 つだけ:
//   ・今日出ているのは誰か（お休みの人は出さない）
//   ・その人は何時から受けられるか（対応中・予約・休憩ぶんを引いたあと）
//   ・その人に今どのお客様の予約が付いているか
//
// 空き時刻の数え方は予約タブ（ReservationTab の castAvailability）と同じで、
// そこに受付日で止めた枠＝休憩を足している。

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  db,
  getReservationDays,
  listCastRoster,
  type ReservationDay,
  type ReservationShape,
  type SessionShape,
} from '../lib/db'
import { useActiveSessions, useRealtimeReservations } from '../lib/useRealtimeSessions'
import { fmtBizTime, jstBusinessDate } from '../lib/format'
import { Clock, Calendar, RefreshCw, AlertTriangle } from '../icons'
import type { RouteId } from './Sidebar'
import './StaffBoard.css'

// 接客と接客のあいだに置く片付けの時間
const INTERVAL_MIN = 10
// 止めた枠は「1組ぶん」埋まる。公開予約ページと同じ 60分＋インターバル で数える
const SLOT_HOLD_MIN = 70

interface BreakSpan {
  slotNo: number
  startMs: number
  endMs: number
}

interface BoardRow {
  castId: string
  cast: string
  availMs: number
  busyNow: boolean
  blockedBy: string
  active: SessionShape | null
  reservations: ReservationShape[]
  breaks: BreakSpan[]
}

// 受付日の枠時刻（"23:20"）を、その営業日の実時刻に直す。
// 4時より前は翌日にまたぐ、という区切りは DB の slot_start_at と揃えてある
function slotStartMs(businessDate: string, hhmm: string): number {
  const [y, m, d] = businessDate.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return NaN
  return Date.UTC(y, m - 1, d + (hh < 4 ? 1 : 0), hh, mm) - 9 * 60 * 60 * 1000
}

function bizDateLabel(businessDate: string): string {
  const [, m, d] = businessDate.split('-')
  return `${Number(m)}/${Number(d)} 営業日`
}

export default function StaffBoard({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const [reservations, setReservations] = useState<ReservationShape[]>([])
  const [day, setDay] = useState<ReservationDay | null>(null)
  const [roster, setRoster] = useState<Array<{ id: string; name: string; role: string }>>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [tick, setTick] = useState(0)
  const { sessions: activeSessions } = useActiveSessions()

  // 営業日は 4:00 区切り。深夜1時に開いても「昨日の営業日」を見せる。
  // tick は 4:00 をまたいだときに日付を繰り上げるためだけに見ている
  const businessDate = useMemo(() => {
    void tick
    return jstBusinessDate()
  }, [tick])

  const load = useCallback(async () => {
    setErr('')
    const bd = jstBusinessDate()
    const [resList, days, castList] = await Promise.all([
      db.call<ReservationShape[]>('getReservations'),
      getReservationDays(bd, bd).catch(() => [] as ReservationDay[]),
      listCastRoster().catch(() => []),
    ])
    if (resList.ok) setReservations(resList.data || [])
    else setErr(resList.error)
    setDay(days[0] ?? null)
    setRoster(castList)
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeReservations(load)

  // 「何時から受けられるか」は時間が経つだけで変わるので、1分ごとに引き直す
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // 今日の予約だけ。キャンセルと却下は受付の判断に要らないので落とす
  const todayReservations = useMemo(
    () =>
      reservations.filter(
        (r) =>
          !r.キャンセル済 &&
          r.status !== 'rejected' &&
          jstBusinessDate(r.予約日時) === businessDate,
      ),
    [reservations, businessDate],
  )

  const castsOnDuty = useMemo(() => {
    const casts = roster.filter((c) => c.role === 'cast')
    if (!day) return casts                                  // 受付日が未登録の日は全員を出す
    const working = new Set(day.castIds)
    return casts.filter((c) => working.has(c.id))
  }, [roster, day])

  const castsOff = useMemo(() => {
    if (!day) return []
    const working = new Set(day.castIds)
    return roster.filter((c) => c.role === 'cast' && !working.has(c.id))
  }, [roster, day])

  const rows: BoardRow[] = useMemo(() => {
    void tick
    const now = Date.now()
    const INTERVAL_MS = INTERVAL_MIN * 60 * 1000

    return castsOnDuty
      .map((c) => {
        const blocks: Array<{ start: number; end: number; label: string }> = []

        // 対応中は、終わる予定＋片付けまで塞がっている
        const active = activeSessions.find((s) => s.対応者 === c.name) ?? null
        if (active) {
          const end = new Date(active.対応終了時間).getTime()
          if (!isNaN(end)) {
            blocks.push({
              start: 0,
              end: end + INTERVAL_MS,
              label: `対応中${active.顧客名 ? `（${active.顧客名}様）` : ''}`,
            })
          }
        }

        const mine = todayReservations
          .filter((r) => r.キャスト名 === c.name)
          .sort((a, b) => new Date(a.予約日時).getTime() - new Date(b.予約日時).getTime())

        for (const r of mine) {
          if (r.converted) continue                          // すでに接客に変わったぶんは対応中が拾う
          const start = new Date(r.予約日時).getTime()
          if (isNaN(start)) continue
          const end = start + (r.予約時間 || 60) * 60 * 1000 + INTERVAL_MS
          if (end <= now) continue                           // 終わった予約は空きの判断に関係ない
          blocks.push({
            start,
            end,
            label: `予約${r.顧客名 ? `（${r.顧客名}様）` : ''}`,
          })
        }

        // 受付日で止めた枠 = その時間は受けない（休憩・私用など）
        const breaks: BreakSpan[] = []
        for (const b of day?.blocks ?? []) {
          if (b.castId !== c.id) continue
          const hhmm = day?.slotTimes[b.slotNo - 1]
          if (!hhmm) continue
          const startMs = slotStartMs(businessDate, hhmm)
          if (isNaN(startMs)) continue
          const endMs = startMs + SLOT_HOLD_MIN * 60 * 1000
          breaks.push({ slotNo: b.slotNo, startMs, endMs })
          if (endMs > now) blocks.push({ start: startMs, end: endMs, label: '休憩（受付停止）' })
        }
        breaks.sort((a, b) => a.startMs - b.startMs)

        // 今から順に、塞がっている区間をたどって最初の空きを探す
        blocks.sort((a, b) => a.start - b.start)
        let availMs = now
        let blockedBy = ''
        for (const b of blocks) {
          if (b.start <= availMs && availMs < b.end) {
            availMs = b.end
            blockedBy = b.label
          }
        }

        return {
          castId: c.id,
          cast: c.name,
          availMs,
          busyNow: availMs > now,
          blockedBy,
          active,
          reservations: mine,
          breaks,
        }
      })
      .sort((a, b) => a.availMs - b.availMs || a.cast.localeCompare(b.cast, 'ja'))
  }, [castsOnDuty, activeSessions, todayReservations, day, businessDate, tick])

  const freeNow = rows.filter((r) => !r.busyNow).length
  const pendingCount = todayReservations.filter((r) => r.status === 'pending').length

  return (
    <div className="board">
      <div className="board-head">
        <div className="board-head-main">
          <span className="board-date">
            <Calendar size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {bizDateLabel(businessDate)}
          </span>
          {!loading && (
            <span className="board-summary muted">
              出勤 {rows.length}人 ／ 今すぐ受けられる {freeNow}人
            </span>
          )}
        </div>
        <button type="button" className="btn-secondary board-reload" onClick={load}>
          <RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          更新
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      {pendingCount > 0 && (
        <button type="button" className="board-pending" onClick={() => onNavigate('reservation')}>
          <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          承認待ちの申込が {pendingCount}件あります。予約タブで承認してください。
        </button>
      )}

      {!day && !loading && (
        <p className="board-note muted">
          今日の受付日がまだ登録されていないので、全キャストを出しています。
          お休みの人を反映するには 管理 → 受付日 でこの日を作ってください。
        </p>
      )}

      {loading && <p className="muted">読み込み中...</p>}

      {!loading && rows.length === 0 && (
        <p className="muted">今日の出勤に登録されているキャストがいません。</p>
      )}

      <div className="board-grid">
        {rows.map((r) => (
          <CastCard key={r.castId} row={r} />
        ))}
      </div>

      {castsOff.length > 0 && (
        <p className="board-off muted">
          本日お休み: {castsOff.map((c) => c.name).join('、')}
        </p>
      )}
    </div>
  )
}

function CastCard({ row }: { row: BoardRow }) {
  return (
    <div className={`board-card ${row.busyNow ? 'busy' : 'free'}`}>
      <div className="board-card-head">
        <strong className="board-cast">{row.cast}</strong>
        {row.busyNow ? (
          <span className="board-state board-state-busy">
            <Clock size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {fmtBizTime(row.availMs)} 〜 受付可能
          </span>
        ) : (
          <span className="board-state board-state-free">今すぐ受付OK</span>
        )}
      </div>

      {row.busyNow && row.blockedBy && (
        <div className="board-reason muted small">{row.blockedBy} のため</div>
      )}

      {row.active && (
        <div className="board-active">
          対応中 {row.active.顧客名 ? `${row.active.顧客名}様` : ''}
          <span className="muted"> 〜 {fmtBizTime(row.active.対応終了時間)}</span>
          {row.active.ルーム && <span className="muted"> ／ {row.active.ルーム}</span>}
        </div>
      )}

      <div className="board-section-label">今日の予約</div>
      {row.reservations.length === 0 ? (
        <p className="muted small board-empty">予約は入っていません。</p>
      ) : (
        <ul className="board-res">
          {row.reservations.map((r) => (
            <li key={r.reservation_id} className={r.converted ? 'done' : ''}>
              <span className="board-res-time">{fmtBizTime(r.予約日時)}</span>
              <span className="board-res-name">{r.顧客名 || '（お名前なし）'}</span>
              <span className="board-res-badges">
                {r.converted && <span className="board-badge done">対応済</span>}
                {!r.converted && r.status === 'pending' && (
                  <span className="board-badge pending">承認待ち</span>
                )}
                {r.予約時間 !== 60 && <span className="board-badge plain">{r.予約時間}分</span>}
                {r.希望席表示名 && <span className="board-badge plain">{r.希望席表示名}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {row.breaks.length > 0 && (
        <div className="board-breaks muted small">
          休憩（受付停止）:{' '}
          {row.breaks
            .map((b) => `${fmtBizTime(b.startMs)}〜${fmtBizTime(b.endMs)}`)
            .join('、')}
        </div>
      )}
    </div>
  )
}
