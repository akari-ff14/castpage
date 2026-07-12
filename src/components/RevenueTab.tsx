import { useCallback, useEffect, useState } from 'react'
import { db, type RevenueStatus } from '../lib/db'
import { fmtCurrency, fmtBizTime } from '../lib/format'
import { Calendar, ChevronLeft, ChevronRight } from '../icons'
import './RevenueTab.css'

// 今の営業日 (JST 4:00 区切り) を "YYYY-MM-DD" で返す
function currentBizDateStr(): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000 - 4 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 10)
}

// "YYYY-MM-DD" を days 日ずらす
function shiftDate(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

export default function RevenueTab() {
  const [bizDate, setBizDate] = useState(currentBizDateStr())
  const [data, setData] = useState<RevenueStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<RevenueStatus>('getRevenueStatus', { businessDay: bizDate })
    setLoading(false)
    if (r.ok) setData(r.data)
    else setErr(r.error)
  }, [bizDate])

  useEffect(() => {
    load()
  }, [load])

  const today = currentBizDateStr()
  const isToday = bizDate === today

  if (loading && !data) return <div className="card"><p className="muted">読み込み中...</p></div>
  if (err) return <div className="card"><p className="err">エラー: {err}</p></div>
  if (!data) return <div className="card empty-state">データなし</div>

  return (
    <div className="revenue-tab">
      {/* 営業日ナビゲーション（過去の営業日の売上も見られる） */}
      <div className="card revenue-header-card">
        <button
          className="btn-icon-nav"
          onClick={() => setBizDate((d) => shiftDate(d, -1))}
          aria-label="前の営業日"
          title="前の営業日"
        >
          <ChevronLeft size={18} />
        </button>
        <div className="rev-business-day">
          <Calendar size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          {data.businessDay}
          {isToday && <span className="rev-today-badge">今日</span>}
        </div>
        <button
          className="btn-icon-nav"
          onClick={() => setBizDate((d) => shiftDate(d, 1))}
          disabled={isToday}
          aria-label="次の営業日"
          title="次の営業日"
        >
          <ChevronRight size={18} />
        </button>
      </div>
      <div className="rev-nav-sub">
        <input
          type="date"
          className="form-input rev-date-input"
          value={bizDate}
          max={today}
          onChange={(e) => e.target.value && setBizDate(e.target.value)}
        />
        {!isToday && (
          <button className="btn-secondary" onClick={() => setBizDate(today)}>
            今日に戻る
          </button>
        )}
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? '...' : '更新'}
        </button>
      </div>

      <div className="rev-totals">
        <div className="rev-total-box">
          <div className="rev-total-label">収益</div>
          <div className="rev-total-value c-green">{fmtCurrency(data.totals.revenue)}</div>
        </div>
        <div className="rev-total-box">
          <div className="rev-total-label">給与</div>
          <div className="rev-total-value c-gold">{fmtCurrency(data.totals.salary)}</div>
        </div>
        <div className="rev-total-box">
          <div className="rev-total-label">キャッシュフロー</div>
          <div className={`rev-total-value ${data.totals.cashFlow >= 0 ? 'c-teal' : 'c-red'}`}>
            {fmtCurrency(data.totals.cashFlow)}
          </div>
        </div>
      </div>
      <p className="muted small rev-guarantee-note">
        ※給与 = 待機保証 + 席料50% + オプション全額（待機保証はキャストごとに管理→キャストで設定。既定は0）
      </p>

      {data.casts.length === 0 ? (
        <div className="card empty-state">この営業日の応対実績はありません</div>
      ) : (
        <div className="card">
          <div className="card-title">キャスト別内訳（{data.totals.count}件）</div>
          <div className="rev-cast-table">
            <div className="rev-cast-row rev-cast-head">
              <span>キャスト</span>
              <span>件数</span>
              <span>収益</span>
              <span>給与</span>
              <span>差額</span>
            </div>
            {data.casts.map((c) => (
              <div key={c.cast} className="rev-cast-row">
                <span className="rev-cast-name">{c.cast}</span>
                <span>{c.count}件</span>
                <span className="c-green">{fmtCurrency(c.revenue)}</span>
                <span className="c-gold">{fmtCurrency(c.salary)}</span>
                <span className={c.cashFlow >= 0 ? 'c-teal' : 'c-red'}>
                  {fmtCurrency(c.cashFlow)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* この営業日の接客明細 */}
      {data.sessions.length > 0 && (
        <div className="card">
          <div className="card-title">この営業日の接客履歴</div>
          <div className="rev-day-sessions">
            {data.sessions.map((s) => (
              <div key={s.session_id} className={`rev-day-row${s.cancelled ? ' is-cancelled' : ''}`}>
                <span className="rev-day-time">{fmtBizTime(s.started_at)}</span>
                <span className="rev-day-cast">{s.cast}</span>
                <span className="rev-day-customer">{s.customer || '—'}</span>
                <span className={`rev-day-type${s.cancelled ? ' c-red' : ''}`}>{s.serviceLabel}</span>
                <span className="rev-day-revenue">{s.cancelled ? '—' : fmtCurrency(s.revenue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
