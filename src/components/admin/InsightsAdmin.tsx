import { useCallback, useEffect, useState } from 'react'
import { getInsights, type InsightsData } from '../../lib/db'
import { fmtCurrency } from '../../lib/format'
import { Crown, TrendingUp, Clock, Users } from '../../icons'
import './AdminCommon.css'
import './InsightsAdmin.css'

export default function InsightsAdmin() {
  const [data, setData] = useState<InsightsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setData(await getInsights())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !data) return <p className="muted">読み込み中...</p>
  if (err) return <p className="err">エラー: {err}</p>
  if (!data) return null

  return (
    <div className="insights">
      <div className="admin-header">
        <h3>インサイト</h3>
        <button className="btn-secondary" onClick={load} disabled={loading}>
          {loading ? '...' : '更新'}
        </button>
      </div>
      <p className="muted small">完了済みの接客データから集計しています。</p>

      <WeeklySection data={data} />
      <HourlySection data={data} />
      <ServiceRoomSection data={data} />
      <RetentionSection data={data} />
    </div>
  )
}

// ====================================================
// 週次収益・給与
// ====================================================
function WeeklySection({ data }: { data: InsightsData }) {
  const weeks = data.weekly
  const maxRevenue = Math.max(1, ...weeks.map((w) => w.revenue))

  return (
    <section className="insights-section">
      <h4 className="insights-title">
        <TrendingUp size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        週次の収益・給与（直近12週）
      </h4>
      {weeks.length === 0 ? (
        <p className="muted small">データがまだありません。</p>
      ) : (
        <div className="weekly-chart">
          {weeks.map((w) => (
            <div key={w.weekKey} className="weekly-row">
              <div className="weekly-label">{w.weekLabel}</div>
              <div className="weekly-bar-wrap">
                <div
                  className="weekly-bar revenue"
                  style={{ width: `${(w.revenue / maxRevenue) * 100}%` }}
                />
                <div
                  className="weekly-bar salary"
                  style={{ width: `${(w.salary / maxRevenue) * 100}%` }}
                />
              </div>
              <div className="weekly-stats">
                <div>
                  <span className="muted small">収益</span>
                  <span className="c-green">{fmtCurrency(w.revenue)}</span>
                </div>
                <div>
                  <span className="muted small">給与</span>
                  <span className="c-gold">{fmtCurrency(w.salary)}</span>
                </div>
                <div>
                  <span className="muted small">差額</span>
                  <span className={w.cashFlow >= 0 ? 'c-teal' : 'c-red'}>{fmtCurrency(w.cashFlow)}</span>
                </div>
                <div>
                  <span className="muted small">件数</span>
                  <span>{w.sessionCount}件</span>
                </div>
              </div>
            </div>
          ))}
          <div className="weekly-legend">
            <span className="legend-dot revenue" /> 収益
            <span className="legend-dot salary" /> 給与
          </div>
        </div>
      )}
    </section>
  )
}

// ====================================================
// 時間帯分布
// ====================================================
function HourlySection({ data }: { data: InsightsData }) {
  const max = Math.max(1, ...data.hourly.map((h) => h.count))
  // 6-29時の24h表示（営業時間に合わせるため 6時始まり）
  const ordered = [...data.hourly.slice(6), ...data.hourly.slice(0, 6)]

  return (
    <section className="insights-section">
      <h4 className="insights-title">
        <Clock size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        接客件数・時間帯分布
      </h4>
      <p className="muted small">接客開始時刻ベース（JST）</p>
      <div className="hourly-chart">
        {ordered.map((h) => {
          const heightPct = (h.count / max) * 100
          const label = `${h.hour}時`
          return (
            <div key={h.hour} className="hourly-bar-wrap" title={`${label}: ${h.count}件`}>
              <div
                className="hourly-bar"
                style={{ height: `${heightPct}%` }}
              />
              <div className="hourly-label">{h.hour}</div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ====================================================
// 接客種別 + ルーム比率
// ====================================================
function ServiceRoomSection({ data }: { data: InsightsData }) {
  return (
    <section className="insights-section">
      <h4 className="insights-title">
        <Crown size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        接客種別 ＆ 人気ルーム
      </h4>

      <h5 className="insights-subtitle">接客種別ごとの収益比率</h5>
      {data.serviceBreakdown.length === 0 ? (
        <p className="muted small">データなし</p>
      ) : (
        <div className="service-breakdown">
          {data.serviceBreakdown.map((s) => (
            <div key={s.key} className="service-row">
              <div className="service-label">
                <span className={`badge ${s.key === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
                  {s.key === 'vip' && <Crown size={10} style={{ verticalAlign: '-1px', marginRight: 2 }} />}
                  {s.label}
                </span>
                <span className="muted small">{s.count}件</span>
              </div>
              <div className="service-bar-wrap">
                <div
                  className={`service-bar ${s.key === 'vip' ? 'vip' : 'normal'}`}
                  style={{ width: `${s.percent * 100}%` }}
                />
              </div>
              <div className="service-value">
                <span className="c-green">{fmtCurrency(s.revenue)}</span>
                <span className="muted small"> ({Math.round(s.percent * 100)}%)</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <h5 className="insights-subtitle">よく使われているルーム TOP 6</h5>
      {data.topRooms.length === 0 ? (
        <p className="muted small">データなし</p>
      ) : (
        <div className="rooms-ranking">
          {data.topRooms.map((r, i) => (
            <div key={r.name} className="room-row">
              <span className="room-rank">{i + 1}</span>
              <span className="room-name">{r.name}</span>
              <span className="room-count">{r.count}件</span>
              <span className="room-revenue muted small">{fmtCurrency(r.revenue)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ====================================================
// リピート率 + 新規比率
// ====================================================
function RetentionSection({ data }: { data: InsightsData }) {
  const r = data.retention
  return (
    <section className="insights-section">
      <h4 className="insights-title">
        <Users size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        顧客リピート率
      </h4>

      <div className="retention-totals">
        <div className="retention-card">
          <div className="retention-label">のべ顧客数</div>
          <div className="retention-value">{r.totalCustomers}</div>
        </div>
        <div className="retention-card">
          <div className="retention-label">新規（1回のみ）</div>
          <div className="retention-value c-teal">{r.newCustomers}</div>
          <div className="muted small">{Math.round(r.newRatio * 100)}%</div>
        </div>
        <div className="retention-card">
          <div className="retention-label">リピート（2回以上）</div>
          <div className="retention-value c-gold">{r.repeatCustomers}</div>
          <div className="muted small">{Math.round(r.repeatRatio * 100)}%</div>
        </div>
        <div className="retention-card">
          <div className="retention-label">平均来店回数</div>
          <div className="retention-value">{r.avgVisits.toFixed(1)}</div>
          <div className="muted small">回 / 顧客</div>
        </div>
      </div>

      {r.totalCustomers > 0 && (
        <div className="retention-bar-wrap">
          <div
            className="retention-bar new"
            style={{ width: `${r.newRatio * 100}%` }}
          >
            {r.newRatio > 0.1 && <span>新規 {Math.round(r.newRatio * 100)}%</span>}
          </div>
          <div
            className="retention-bar repeat"
            style={{ width: `${r.repeatRatio * 100}%` }}
          >
            {r.repeatRatio > 0.1 && <span>リピート {Math.round(r.repeatRatio * 100)}%</span>}
          </div>
        </div>
      )}
    </section>
  )
}
