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
import AdminTab from './components/AdminTab'
import './App.css'

type TabId = 'session' | 'reservation' | 'list' | 'revenue' | 'settings' | 'admin'

const BASE_TABS: Array<{ id: TabId; label: string }> = [
  { id: 'session', label: '接客' },
  { id: 'reservation', label: '予約' },
  { id: 'list', label: 'リスト' },
  { id: 'revenue', label: '売上' },
  { id: 'settings', label: '設定' },
]

const ADMIN_TAB: { id: TabId; label: string } = { id: 'admin', label: '管理' }

// 初回ロード時、localStorageに保存されたテーマを即時適用
applyTheme(getStoredTheme())

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [castName, setCastName] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
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
      setIsAdmin(false)
      return
    }
    setCastLoading(true)
    getMyCast()
      .then((info) => {
        setCastName(info?.name ?? null)
        setIsAdmin(info?.is_admin ?? false)
      })
      .catch(() => {
        setCastName(null)
        setIsAdmin(false)
      })
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
    return (
      <CastSelectionScreen
        onBound={(name) => {
          setCastName(name)
          // バインド時に is_admin を再取得
          getMyCast().then((info) => setIsAdmin(info?.is_admin ?? false))
        }}
      />
    )
  }

  return (
    <Dashboard
      castName={castName}
      isAdmin={isAdmin}
      onLogout={async () => {
        await supabase.auth.signOut()
      }}
      onChangeCast={async () => {
        await unbindMyCast()
        setCastName(null)
        setIsAdmin(false)
      }}
    />
  )
}

function Dashboard({
  castName,
  isAdmin,
  onLogout,
  onChangeCast,
}: {
  castName: string
  isAdmin: boolean
  onLogout: () => void
  onChangeCast: () => void
}) {
  const [tab, setTab] = useState<TabId>('session')
  const tabs = isAdmin ? [...BASE_TABS, ADMIN_TAB] : BASE_TABS

  return (
    <div className="screen">
      <header className="topbar">
        <h2>対話店[灯] / {castName}{isAdmin && <span className="admin-badge">管理者</span>}</h2>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn-secondary" onClick={onChangeCast} title="別のキャストとして使う">↔</button>
          <button className="btn-secondary" onClick={onLogout}>ログアウト</button>
        </div>
      </header>
      <nav className="tab-nav">
        {tabs.map((t) => (
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
      {tab === 'list' && <ListTab castName={castName} isAdmin={isAdmin} />}
      {tab === 'revenue' && <RevenueTab />}
      {tab === 'settings' && <SettingsTab castName={castName} />}
      {tab === 'admin' && isAdmin && <AdminTab />}
    </div>
  )
}
