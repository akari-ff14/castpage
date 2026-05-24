import { useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import ActiveSession from './ActiveSession'
import StartSessionForm from './StartSessionForm'

// 進行中接客があれば ActiveSession、なければ StartSessionForm を表示
// 親が再マウントしなくて済むよう、子側で active session の有無を判定する
export default function SessionTab({
  api,
  castName,
}: {
  api: AkariApi
  castName: string
}) {
  const [hasActive, setHasActive] = useState<boolean | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    (async () => {
      const r = await api.call<unknown>('getActiveSession', castName)
      if (r.ok) setHasActive(!!(r.data))
      else setHasActive(false)
    })()
  }, [api, castName, refreshKey])

  if (hasActive === null) {
    return <div className="card"><p className="muted">読み込み中...</p></div>
  }

  if (hasActive) {
    return (
      <ActiveSession
        api={api}
        castName={castName}
        onChanged={() => setRefreshKey((k) => k + 1)}
      />
    )
  }

  return (
    <StartSessionForm
      api={api}
      castName={castName}
      onStarted={() => setRefreshKey((k) => k + 1)}
    />
  )
}
