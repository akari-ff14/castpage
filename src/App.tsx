import { useState } from 'react'
import { AkariApi } from './lib/akariApi'
import PinScreen from './components/PinScreen'
import SessionTab from './components/SessionTab'
import HistoryTab from './components/HistoryTab'
import RevenueTab from './components/RevenueTab'
import ReservationTab from './components/ReservationTab'
import './App.css'

const API_URL = import.meta.env.VITE_AKARI_API_URL as string | undefined

type TabId = 'session' | 'reservation' | 'history' | 'revenue'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'session', label: '接客' },
  { id: 'reservation', label: '予約' },
  { id: 'history', label: '履歴' },
  { id: 'revenue', label: '売上' },
]

export default function App() {
  if (!API_URL) return <ConfigError />
  return <AppInner apiUrl={API_URL} />
}

function ConfigError() {
  return (
    <div className="error-box">
      <h2>VITE_AKARI_API_URL が未設定です</h2>
      <p>プロジェクトルートに <code>.env.local</code> を作って以下を追加してください:</p>
      <pre>VITE_AKARI_API_URL=https://script.google.com/macros/s/.../exec</pre>
    </div>
  )
}

function AppInner({ apiUrl }: { apiUrl: string }) {
  const [api] = useState(() => new AkariApi(apiUrl))
  const [authed, setAuthed] = useState(api.isAuthenticated)
  const [castName, setCastName] = useState(api.currentCastName)

  if (!authed) {
    return (
      <PinScreen
        api={api}
        onLogin={(name) => {
          setCastName(name)
          setAuthed(true)
        }}
      />
    )
  }
  return (
    <Dashboard
      api={api}
      castName={castName}
      onLogout={() => {
        api.logout()
        setAuthed(false)
      }}
    />
  )
}

function Dashboard({
  api,
  castName,
  onLogout,
}: {
  api: AkariApi
  castName: string
  onLogout: () => void
}) {
  const [tab, setTab] = useState<TabId>('session')

  return (
    <div className="screen">
      <header className="topbar">
        <h2>対話店[灯] / {castName}</h2>
        <button className="btn-secondary" onClick={onLogout}>ログアウト</button>
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
      {tab === 'session' && <SessionTab api={api} castName={castName} />}
      {tab === 'reservation' && <ReservationTab api={api} castName={castName} />}
      {tab === 'history' && <HistoryTab api={api} castName={castName} />}
      {tab === 'revenue' && <RevenueTab api={api} />}
    </div>
  )
}
