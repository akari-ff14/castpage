import { useState } from 'react'
import { AkariApi } from './lib/akariApi'
import PinScreen from './components/PinScreen'
import ActiveSession from './components/ActiveSession'
import './App.css'

const API_URL = import.meta.env.VITE_AKARI_API_URL as string | undefined

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
  return (
    <div className="screen">
      <header className="topbar">
        <h2>こんにちは、{castName} さん</h2>
        <button className="btn-secondary" onClick={onLogout}>ログアウト</button>
      </header>
      <ActiveSession api={api} castName={castName} />
    </div>
  )
}
