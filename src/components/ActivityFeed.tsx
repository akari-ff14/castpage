import { useCallback, useEffect, useState } from 'react'
import { db, type ActivityLog, type ActivityType } from '../lib/db'
import { useRealtimeActivityLogs } from '../lib/useRealtimeSessions'
import { fmtTime } from '../lib/format'
import { Play, Stop, RotateCw, Sparkles, Edit } from '../icons'
import './ActivityFeed.css'

interface Props {
  limit?: number
  title?: string
}

// 顧客名(カンマ/読点区切り)に「様」を付けて整形
function formatCustomer(raw: string | null | undefined): string {
  if (!raw) return '顧客'
  const names = String(raw).split(/[,、]/).map((s) => s.trim()).filter(Boolean)
  if (names.length === 0) return '顧客'
  return names.map((n) => `${n}様`).join('、')
}

function messageOf(log: ActivityLog): string {
  const who = log.cast_name || '誰か'
  const target = formatCustomer(log.customer_name)
  switch (log.type) {
    case 'start':  return `${who} が ${target} の対応を開始しました`
    case 'end':    return `${who} が ${target} の対応を終了しました`
    case 'extend': return `${who} が ${target} の対応を延長しました`
    case 'option': return `${who} が ${target} のオプションを受け付けました`
    case 'record': return `${who} が ${target} の接客を記録しました`
  }
}

function iconOf(type: ActivityType) {
  switch (type) {
    case 'start':  return <Play size={12} />
    case 'end':    return <Stop size={12} />
    case 'extend': return <RotateCw size={12} />
    case 'option': return <Sparkles size={12} />
    case 'record': return <Edit size={12} />
  }
}

export default function ActivityFeed({ limit = 10, title = '最近のアクティビティ' }: Props) {
  const [logs, setLogs] = useState<ActivityLog[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const r = await db.call<ActivityLog[]>('getActivityLogs', limit)
    setLoading(false)
    if (r.ok) {
      setLogs(r.data || [])
      setErr('')
    } else {
      setErr((r as { error: string }).error || '読み込みに失敗しました')
    }
  }, [limit])

  useEffect(() => { load() }, [load])
  useRealtimeActivityLogs(load)

  return (
    <section className="activity-feed">
      <h4 className="activity-feed-title">{title}</h4>
      {err && <p className="err small">{err}</p>}
      {loading && logs.length === 0 && <p className="muted small">読み込み中...</p>}
      {!loading && logs.length === 0 && (
        <p className="muted small">まだアクティビティはありません。</p>
      )}
      {logs.length > 0 && (
        <ul className="activity-feed-list">
          {logs.map((log) => (
            <li key={log.id} className={`activity-feed-item activity-${log.type}`}>
              <span className="activity-feed-time">[{fmtTime(log.created_at)}]</span>
              <span className="activity-feed-icon" aria-hidden="true">{iconOf(log.type)}</span>
              <span className="activity-feed-msg">{messageOf(log)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
