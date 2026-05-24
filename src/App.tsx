import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { db, getMyCast, unbindMyCast } from './lib/db'
import { applyTheme, getStoredTheme, type ThemeName } from './lib/theme'
import MagicLinkScreen from './components/MagicLinkScreen'
import CastSelectionScreen from './components/CastSelectionScreen'
import SessionTab from './components/SessionTab'
import ReservationTab from './components/ReservationTab'
import ListTab from './components/ListTab'
import RevenueTab from './components/RevenueTab'
import SettingsTab from './components/SettingsTab'
import './App.css'

type TabId = 'session' | 'reservation' | 'list' | 'revenue' | 'settings'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'session', label: '接客' },
  { id: 'reservation', label: '予約' },
  { id: 'list', label: 'リスト' },
  { id: 'revenue', label: '売上' },
  { id: 'settings', label: '設定' },
]

// 初回ロード時、localStorageに保存されたテーマを即時適用
applyTheme(getStoredTheme())

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [castName, setCastName] = useState<string | null>(null)
  const [castLoading, setCastLoading] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) setCastName(null)
    })
    return () => subscription.unsubscribe()
  }, [])

  // ログイン後: バインド済みのキャストを取得
  useEffect(() => {
    if (!session) {
      setCastName(null)
      return
    }
    setCastLoading(true)
    getMyCast()
      .then((name) => setCastName(name))
      .catch(() => setCastName(null))
      .finally(() => setCastLoading(false))
  }, [session])

  // ログイン後: 保存テーマを適用
  useEffect(() => {
    if (!session) return
    (async () => {
      const r = await db.call<{ theme?: ThemeName }>('getUserSettings')
      if (r.ok && r.data?.theme) applyTheme(r.data.theme)
    })()
  }, [session])

  if (authLoading || (session && castLoading)) {
    return (
      <div className="ml-overlay">
        <div className="ml-title">対話店[灯]</div>
        <p className="muted">読み込み中...</p>
      </div>
    )
  }

  if (!session) return <MagicLinkScreen />

  if (!castName) {
    return <CastSelectionScreen onBound={(name) => setCastName(name)} />
  }

  return (
    <Dashboard
      castName={castName}
      onLogout={async () => {
        await supabase.auth.signOut()
      }}
      onChangeCast={async () => {
        await unbindMyCast()
        setCastName(null)
      }}
    />
  )
}

function Dashboard({
  castName,
  onLogout,
  onChangeCast,
}: {
  castName: string
  onLogout: () => void
  onChangeCast: () => void
}) {
  const [tab, setTab] = useState<TabId>('session')

  return (
    <div className="screen">
      <header className="topbar">
        <h2>対話店[灯] / {castName}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-secondary" onClick={onChangeCast} title="別のキャストとして使う">↔</button>
          <button className="btn-secondary" onClick={onLogout}>ログアウト</button>
        </div>
      </header>
      <nav className="tab-nav">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
      {tab === 'session' && <SessionTab castName={castName} />}
      {tab === 'reservation' && <ReservationTab castName={castName} />}
      {tab === 'list' && <ListTab castName={castName} />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'settings' && <SettingsTab castName={castName} />}
    </div>
  )
}
