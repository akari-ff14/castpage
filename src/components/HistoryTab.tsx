import { useCallback, useEffect, useState } from 'react'
import { db } from '../lib/db'
import { fmtCurrency, fmtDateTime, fmtTime } from '../lib/format'
import './HistoryTab.css'

interface HistorySession {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  接客種別: string
  接客種別表示名: string
  基本単価: number
  延長回数: number
  オプション回数: number
  開始時間: string
  対応終了時間: string
  作成日時: string
  収益金: number
  備考: string
}

function nowJstYearMonth(): { year: number; month: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
  }
}

export default function HistoryTab({ castName }: { castName: string }) {
  const initial = nowJstYearMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [castFilter, setCastFilter] = useState<'mine' | 'all'>('mine')
  const [list, setList] = useState<HistorySession[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<HistorySession[]>('getHistory', { year, month })
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [year, month])

  useEffect(() => {
    load()
  }, [load])

  const filtered = castFilter === 'mine' ? list.filter((s) => s.対応者 === castName) : list

  return (
    <div className="history-tab">
      <div className="card filter-card">
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">年</label>
            <input
              type="number"
              className="form-input"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min="2020"
              max="2099"
            />
          </div>
          <div className="form-group">
            <label className="form-label">月</label>
            <div className="select-wrap">
              <select
                className="form-select"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <button
            className={`btn-pill ${castFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setCastFilter('mine')}
          >
            自分のみ
          </button>
          <button
            className={`btn-pill ${castFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCastFilter('all')}
          >
            全員
          </button>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? '...' : '更新'}
          </button>
        </div>
      </div>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !filtered.length && (
        <div className="card empty-state">この期間の履歴はありません</div>
      )}

      {filtered.map((s) => (
        <div key={s.session_id} className="history-card">
          <div className="history-header">
            <span className={`badge ${s.接客種別 === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
              {s.接客種別 === 'vip' ? '✦ ' : ''}
              {s.接客種別表示名 || s.接客種別}
            </span>
            <span className="history-revenue">{fmtCurrency(s.収益金)}</span>
          </div>
          <div className="history-row">
            <span className="muted">日時</span>
            <span>{fmtDateTime(s.作成日時)}</span>
          </div>
          <div className="history-row">
            <span className="muted">時間</span>
            <span>{fmtTime(s.開始時間)} 〜 {fmtTime(s.対応終了時間)}</span>
          </div>
          <div className="history-row">
            <span className="muted">対応者 / ルーム</span>
            <span>{s.対応者} / {s.ルーム}</span>
          </div>
          <div className="history-row">
            <span className="muted">顧客</span>
            <span>{s.顧客名 || '—'}</span>
          </div>
          {(s.延長回数 > 0 || s.オプション回数 > 0) && (
            <div className="history-row">
              <span className="muted">延長 / オプ</span>
              <span>{s.延長回数}回 / {s.オプション回数}回</span>
            </div>
          )}
          {s.備考 && (
            <div className="history-row">
              <span className="muted">備考</span>
              <span>{s.備考}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
