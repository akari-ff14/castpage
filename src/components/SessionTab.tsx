import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import ActiveSession from './ActiveSession'
import StartSessionForm from './StartSessionForm'

// 進行中接客があれば ActiveSession、なければ StartSessionForm を表示
export default function SessionTab({ castName }: { castName: string }) {
  const [hasActive, setHasActive] = useState<boolean | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    (async () => {
      const r = await db.call<unknown>('getActiveSession', castName)
      if (r.ok) setHasActive(!!r.data)
      else setHasActive(false)
    })()
  }, [castName, refreshKey])

  if (hasActive === null) {
    return <div className="card"><p className="muted">読み込み中...</p></div>
  }

  if (hasActive) {
    return (
      <ActiveSession
        castName={castName}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    )
  }

  return (
    <StartSessionForm
      castName={castName}
      onStarted={() => setRefreshKey((k) => k + 1)}
    />
  )
}
