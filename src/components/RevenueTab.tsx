import { useCallback, useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import { fmtCurrency } from '../lib/format'
import './RevenueTab.css'

interface CastRevenue {
  cast: string
  guarantee: number
  baseTotal: number
  optTotal: number
  revenue: number
  salary: number
  cashFlow: number
}

interface RevenueStatus {
  casts: CastRevenue[]
  totals: { revenue: number; salary: number; cashFlow: number }
  businessDay: string
  busStart: string
}

export default function RevenueTab({ api }: { api: AkariApi }) {
  const [data, setData] = useState<RevenueStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await api.call<RevenueStatus>('getRevenueStatus')
    setLoading(false)
    if (r.ok) setData(r.data)
    else setErr(r.error)
  }, [api])

  useEffect(() => {
    load()
  }, [load])

  if (loading && !data) return <div className="card"><p className="muted">読み込み中...</p></div>
  if (err) return <div className="card"><p className="err">エラー: {err}</p></div>
  if (!data) return <div className="card empty-state">データなし</div>

  return (
    <div className="revenue-tab">
      <div className="card revenue-header-card">
        <div className="rev-business-day">📅 {data.businessDay}</div>
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

      {data.casts.length === 0 ? (
        <div className="card empty-state">今ビジネスデーの応対実績はまだありません</div>
      ) : (
        <div className="card">
          <div className="card-title">キャスト別内訳</div>
          <div className="rev-cast-table">
            <div className="rev-cast-row rev-cast-head">
              <span>キャスト</span>
              <span>収益</span>
              <span>給与</span>
              <span>差額</span>
            </div>
            {data.casts.map((c) => (
              <div key={c.cast} className="rev-cast-row">
                <span className="rev-cast-name">{c.cast}</span>
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
    </div>
  )
}
