import { useEffect, useMemo, useState } from 'react'
import { fmtBizTime } from '../lib/format'
import type { SessionShape } from '../lib/db'
import './GanttTimeline.css'

// 予約タブから渡される予約の最小形
export interface GanttReservation {
  reservation_id: string
  キャスト名: string
  顧客名: string
  予約種別: string
  予約時間: number   // 対応時間（分）
  予約日時: string
  ルーム: string
  converted?: boolean   // 接客開始済み → タイムラインからは消す
}

interface Bar {
  id: string
  kind: 'session' | 'reservation' | 'interval'
  startMs: number
  endMs: number
  leftPct: number
  widthPct: number
  customer: string
  room: string
  resType?: string
}

interface Row {
  cast: string
  bars: Bar[]
}

const JST = 9 * 60 * 60 * 1000
const OPEN_HOUR = 21               // 営業開始 21:00
const WINDOW_HOURS = 5             // 表示枠: 21:00 〜 26:00（翌2:00）
const WINDOW_MS = WINDOW_HOURS * 60 * 60 * 1000
const GRID_STEP_MIN = 30           // 目盛り（グリッド線）は30分刻み
const RESERVATION_DEFAULT_MIN = 60 // 対応時間が無い場合の仮の枠
const INTERVAL_MIN = 10            // 対応終了後のインターバル（次の対応可能まで）

// offsetDays 日ぶんずらした「営業日」の開始時刻（その日の 21:00 JST）を UTC で返す
function businessDayStart(offsetDays: number): Date {
  const jst = new Date(Date.now() + JST)
  const y = jst.getUTCFullYear()
  const m = jst.getUTCMonth()
  const d = jst.getUTCDate()
  const h = jst.getUTCHours()
  // 4:00 より前なら営業日は前日扱い
  const dayDate = d + (h < 4 ? -1 : 0) + offsetDays
  return new Date(Date.UTC(y, m, dayDate, OPEN_HOUR) - JST)
}

function dayLabel(start: Date): string {
  const jst = new Date(start.getTime() + JST)
  const wd = ['日', '月', '火', '水', '木', '金', '土'][jst.getUTCDay()]
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}（${wd}）`
}

// 1時間ごとのラベル（深夜は 24/25/26 の表記）
const LABELS = Array.from({ length: WINDOW_HOURS + 1 }, (_, i) => ({
  pct: (i / WINDOW_HOURS) * 100,
  label: `${OPEN_HOUR + i}`,
}))

// 30分ごとのグリッド線（毎正時は強調）
const GRIDS = Array.from({ length: (WINDOW_HOURS * 60) / GRID_STEP_MIN + 1 }, (_, i) => {
  const relMin = i * GRID_STEP_MIN
  return { pct: (relMin / (WINDOW_HOURS * 60)) * 100, major: relMin % 60 === 0 }
})

export default function GanttTimeline({
  sessions,
  reservations,
  highlightCast,
}: {
  sessions: SessionShape[]
  reservations: GanttReservation[]
  highlightCast?: string
}) {
  const [offset, setOffset] = useState(0)
  // 現在時刻ライン更新用（1分ごと）
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  const winStart = useMemo(() => businessDayStart(offset), [offset])
  const winStartMs = winStart.getTime()
  const winEndMs = winStartMs + WINDOW_MS

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, Bar[]>()
    const ensure = (cast: string) => {
      const key = cast || '（未割当）'
      if (!map.has(key)) map.set(key, [])
      return map.get(key)!
    }
    const clampBar = (startMs: number, endMs: number): { left: number; width: number } | null => {
      if (endMs <= winStartMs || startMs >= winEndMs) return null // 窓の外
      const s = Math.max(startMs, winStartMs)
      const e = Math.min(endMs, winEndMs)
      const left = ((s - winStartMs) / WINDOW_MS) * 100
      const width = Math.max(1.2, ((e - s) / WINDOW_MS) * 100)
      return { left, width }
    }

    // 対応中セッション
    for (const s of sessions) {
      const startMs = new Date(s.開始時間).getTime()
      const endMs = new Date(s.対応終了時間).getTime()
      if (isNaN(startMs) || isNaN(endMs)) continue
      const c = clampBar(startMs, endMs)
      if (c) {
        ensure(s.対応者).push({
          id: `s-${s.session_id}`,
          kind: 'session',
          startMs,
          endMs,
          leftPct: c.left,
          widthPct: c.width,
          customer: s.顧客名 || '—',
          room: s.ルーム || '',
        })
      }
      // 対応終了後の10分インターバル（この後から対応可能）
      const intEnd = endMs + INTERVAL_MIN * 60 * 1000
      const ci = clampBar(endMs, intEnd)
      if (ci) {
        ensure(s.対応者).push({
          id: `i-${s.session_id}`,
          kind: 'interval',
          startMs: endMs,
          endMs: intEnd,
          leftPct: ci.left,
          widthPct: ci.width,
          customer: '',
          room: '',
        })
      }
    }

    // 予約
    for (const r of reservations) {
      // 接客開始済みの予約は、対応バーを優先してタイムラインから消す
      if (r.converted) continue
      const startMs = new Date(r.予約日時).getTime()
      if (isNaN(startMs)) continue
      const endMs = startMs + (Number(r.予約時間) || RESERVATION_DEFAULT_MIN) * 60 * 1000
      const c = clampBar(startMs, endMs)
      if (c) {
        ensure(r.キャスト名).push({
          id: `r-${r.reservation_id}`,
          kind: 'reservation',
          startMs,
          endMs,
          leftPct: c.left,
          widthPct: c.width,
          customer: r.顧客名 || '（顧客名なし）',
          room: r.ルーム || '',
          resType: r.予約種別,
        })
      }
      // 予約終了後の10分インターバル（この後から対応可能）
      const intEnd = endMs + INTERVAL_MIN * 60 * 1000
      const ci = clampBar(endMs, intEnd)
      if (ci) {
        ensure(r.キャスト名).push({
          id: `ri-${r.reservation_id}`,
          kind: 'interval',
          startMs: endMs,
          endMs: intEnd,
          leftPct: ci.left,
          widthPct: ci.width,
          customer: '',
          room: '',
        })
      }
    }

    const list: Row[] = [...map.entries()].map(([cast, bars]) => ({
      cast,
      bars: bars.sort((a, b) => a.startMs - b.startMs),
    }))
    // 自分を先頭、その後は名前順
    list.sort((a, b) => {
      if (highlightCast) {
        if (a.cast === highlightCast) return -1
        if (b.cast === highlightCast) return 1
      }
      return a.cast.localeCompare(b.cast, 'ja')
    })
    return list
  }, [sessions, reservations, winStartMs, winEndMs, highlightCast])

  // 現在時刻ライン
  const nowMs = Date.now()
  const nowPct =
    nowMs >= winStartMs && nowMs <= winEndMs
      ? ((nowMs - winStartMs) / WINDOW_MS) * 100
      : null

  return (
    <div className="card gantt-card">
      <div className="gantt-toolbar">
        <button className="gantt-nav" onClick={() => setOffset((o) => o - 1)} aria-label="前日">◀</button>
        <div className="gantt-day">
          {dayLabel(winStart)} <span className="muted">営業日</span>
          {offset !== 0 && (
            <button className="gantt-today" onClick={() => setOffset(0)}>今日へ</button>
          )}
        </div>
        <button className="gantt-nav" onClick={() => setOffset((o) => o + 1)} aria-label="翌日">▶</button>
      </div>

      <div className="gantt-axis">
        <div className="gantt-axis-label" />
        <div className="gantt-axis-track">
          {LABELS.map((t) => (
            <span key={t.pct} className="gantt-tick-label" style={{ left: `${t.pct}%` }}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="muted small gantt-empty">この営業日の対応・予約はありません</p>
      ) : (
        <div className="gantt-body">
          {rows.map((row) => (
            <div
              key={row.cast}
              className={`gantt-row${row.cast === highlightCast ? ' is-me' : ''}`}
            >
              <div className="gantt-row-label" title={row.cast}>{row.cast}</div>
              <div className="gantt-row-track">
                {GRIDS.map((g) => (
                  <span
                    key={g.pct}
                    className={`gantt-gridline${g.major ? ' major' : ''}`}
                    style={{ left: `${g.pct}%` }}
                  />
                ))}
                {nowPct !== null && (
                  <span className="gantt-now" style={{ left: `${nowPct}%` }} />
                )}
                {row.bars.map((bar) =>
                  bar.kind === 'interval' ? (
                    <div
                      key={bar.id}
                      className="gantt-bar gantt-bar-interval"
                      style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                      title={`インターバル ${INTERVAL_MIN}分\n次対応可能：${fmtBizTime(bar.endMs)}〜`}
                    >
                      <span className="gantt-avail">次対応可能：{fmtBizTime(bar.endMs)}〜</span>
                    </div>
                  ) : (
                    <div
                      key={bar.id}
                      className={`gantt-bar gantt-bar-${bar.kind}${bar.resType === '当日' ? ' is-sameday' : ''}`}
                      style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                      title={`${row.cast}｜${bar.customer}${bar.room ? `（${bar.room}）` : ''}\n${fmtBizTime(bar.startMs)}〜${fmtBizTime(bar.endMs)}（${Math.round((bar.endMs - bar.startMs) / 60000)}分）${
                        bar.kind === 'reservation' ? ' ※予約' : ''
                      }`}
                    >
                      <span className="gantt-bar-time">
                        {fmtBizTime(bar.startMs)}〜{fmtBizTime(bar.endMs)}
                      </span>
                      <span className="gantt-bar-cust">{bar.customer}</span>
                    </div>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="gantt-legend">
        <span className="gantt-legend-item"><span className="swatch swatch-session" />対応中</span>
        <span className="gantt-legend-item"><span className="swatch swatch-interval" />インターバル({INTERVAL_MIN}分)</span>
        <span className="gantt-legend-item"><span className="swatch swatch-reservation" />予約</span>
        {nowPct !== null && <span className="gantt-legend-item"><span className="swatch swatch-now" />現在</span>}
      </div>
    </div>
  )
}
