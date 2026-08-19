import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { db, getMyCast } from './lib/db'
import { applyTheme, getStoredTheme, type ThemeName } from './lib/theme'
import MagicLinkScreen from './components/MagicLinkScreen'
import CastSelectionScreen from './components/CastSelectionScreen'
import Sidebar, { type RouteId } from './components/Sidebar'
import HomeView from './components/HomeView'
import WelcomeModal from './components/WelcomeModal'
import SessionTab, { type SessionPreset } from './components/SessionTab'
import ReservationTab from './components/ReservationTab'
import HistoryTab from './components/HistoryTab'
import CustomerSubtab from './components/CustomerSubtab'
import BlacklistSubtab from './components/BlacklistSubtab'
import RevenueTab from './components/RevenueTab'
import CompanyChestTab from './components/CompanyChestTab'
import SettingsTab from './components/SettingsTab'
import AdminTab from './components/AdminTab'
import { Menu } from './icons'
import './App.css'

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

  // session オブジェクトはタブ復帰やトークン更新のたびに新しい参照で
  // 差し替わる。ユーザーが変わったときだけキャスト情報/設定を読み直すよう、
  // user.id を依存にする（さもないと画面復帰のたびに全画面ローディングが走り
  // Dashboard が再マウント→全タブ再読込されてしまう）
  const userId = session?.user?.id ?? null

  useEffect(() => {
    if (!userId) {
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
  }, [userId])

  useEffect(() => {
    if (!userId) return
    (async () => {
      const r = await db.call<{ theme?: ThemeName }>('getUserSettings')
      if (r.ok && r.data?.theme) applyTheme(r.data.theme)
    })()
  }, [userId])

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
    />
  )
}

const WELCOMED_KEY = 'akari_welcomed'

function Dashboard({
  castName,
  isAdmin,
  onLogout,
}: {
  castName: string
  isAdmin: boolean
  onLogout: () => void
}) {
  const [route, setRoute] = useState<RouteId>('home')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showWelcome, setShowWelcome] = useState(
    () => localStorage.getItem(WELCOMED_KEY) !== '1',
  )
  const [sessionPreset, setSessionPreset] = useState<SessionPreset | null>(null)

  return (
    <div className="app-shell">
      {showWelcome && (
        <WelcomeModal
          castName={castName}
          onClose={() => {
            localStorage.setItem(WELCOMED_KEY, '1')
            setShowWelcome(false)
          }}
        />
      )}
      <Sidebar
        current={route}
        onNavigate={setRoute}
        isAdmin={isAdmin}
        castName={castName}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        onLogout={onLogout}
      />

      <div className="app-main">
        <header className="app-topbar">
          <button
            type="button"
            className="topbar-hamburger"
            onClick={() => setSidebarOpen(true)}
            aria-label="メニューを開く"
          >
            <Menu size={20} />
          </button>
          <h1 className="topbar-title">{routeTitle(route)}</h1>
        </header>

        <div className="app-content">
          {route === 'home' && <HomeView castName={castName} onNavigate={setRoute} />}
          {route === 'session' && (
            <SessionTab
              castName={castName}
              onNavigate={(r) => setRoute(r)}
              preset={sessionPreset}
              onPresetConsumed={() => setSessionPreset(null)}
            />
          )}
          {route === 'reservation' && (
            <ReservationTab
              castName={castName}
              isAdmin={isAdmin}
              onStartSession={(preset) => {
                setSessionPreset(preset)
                setRoute('session')
              }}
            />
          )}
          {route === 'history' && <HistoryTab castName={castName} isAdmin={isAdmin} />}
          {route === 'customer' && <CustomerSubtab />}
          {route === 'blacklist' && <BlacklistSubtab />}
          {route === 'revenue' && <RevenueTab />}
          {route === 'chest' && <CompanyChestTab castName={castName} isAdmin={isAdmin} />}
          {route === 'admin' && isAdmin && <AdminTab />}
          {route === 'settings' && <SettingsTab castName={castName} />}
        </div>
      </div>
    </div>
  )
}

function routeTitle(r: RouteId): string {
  switch (r) {
    case 'home':        return 'ホーム'
    case 'session':     return '接客'
    case 'reservation': return '予約'
    case 'history':     return '履歴'
    case 'customer':    return '顧客'
    case 'blacklist':   return 'ブラックリスト'
    case 'revenue':     return '売上'
    case 'chest':       return 'カンチェ'
    case 'admin':       return '管理'
    case 'settings':    return '設定'
  }
}

