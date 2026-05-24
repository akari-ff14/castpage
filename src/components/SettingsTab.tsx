import { useEffect, useState } from 'react'
import type { AkariApi } from '../lib/akariApi'
import { fmtCurrency } from '../lib/format'
import { applyTheme, getStoredTheme, type ThemeName } from '../lib/theme'
import { useToast } from './Toast'
import './SettingsTab.css'

interface PricingEntry {
  key: string
  label: string
  price: number
}

interface RoomData {
  name: string
  vip: number
}

const THEMES: Array<{ id: ThemeName; label: string; swatch: string }> = [
  { id: 'dark', label: 'ダーク', swatch: '#1a0c0c' },
  { id: 'light', label: 'ライト', swatch: '#f8f2ec' },
  { id: 'midnight', label: 'ミッドナイト', swatch: '#080404' },
]

export default function SettingsTab({
  api,
  castName,
}: {
  api: AkariApi
  castName: string
}) {
  const [theme, setTheme] = useState<ThemeName>(getStoredTheme())
  const [busy, setBusy] = useState(false)
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [casts, setCasts] = useState<string[]>([])
  const toast = useToast()

  useEffect(() => {
    (async () => {
      const [rPrice, rCast] = await Promise.all([
        api.call<PricingEntry[]>('getPricing'),
        api.call<{ casts: string[]; rooms: string[]; roomsData: RoomData[] }>('getCastsAndRooms'),
      ])
      if (rPrice.ok) setPricing(rPrice.data)
      if (rCast.ok) {
        setCasts(rCast.data.casts)
        setRooms(rCast.data.roomsData || rCast.data.rooms.map((n) => ({ name: n, vip: 0 })))
      }
    })()
  }, [api])

  function chooseTheme(t: ThemeName) {
    setTheme(t)
    applyTheme(t)  // 即時反映
  }

  async function save() {
    setBusy(true)
    const r = await api.call('saveUserSettings', castName, { theme })
    setBusy(false)
    if (r.ok) toast.show('設定を保存しました')
    else toast.show((r as { error: string }).error || '保存に失敗しました', 'err')
  }

  return (
    <div className="settings-tab">
      <div className="card">
        <div className="card-title">⚙ テーマ</div>
        <div className="theme-selector">
          {THEMES.map((t) => (
            <button
              key={t.id}
              className={`theme-btn ${theme === t.id ? 'active' : ''}`}
              onClick={() => chooseTheme(t.id)}
            >
              <span className="theme-swatch" style={{ background: t.swatch }} />
              {t.label}
            </button>
          ))}
        </div>
        <p className="muted theme-cast-label">ユーザー: {castName}</p>
        <button className="btn-primary" onClick={save} disabled={busy}>
          {busy ? '保存中...' : '設定を保存'}
        </button>
      </div>

      <div className="card">
        <div className="card-title">📋 マスタ情報（参照のみ）</div>

        <h4 className="settings-section-h">料金</h4>
        <div className="settings-pricing">
          {pricing.map((p) => (
            <div key={p.key} className="settings-pricing-item">
              <span className="muted">{p.label}</span>
              <span className="c-gold">{fmtCurrency(p.price)}</span>
              <span className="muted small">{p.key === 'option' ? '/ 1回' : '/ 30分'}</span>
            </div>
          ))}
        </div>

        <h4 className="settings-section-h">キャスト</h4>
        <div className="settings-tag-row">
          {casts.length ? casts.map((c) => (
            <span key={c} className="settings-tag">{c}</span>
          )) : <span className="muted">未登録</span>}
        </div>

        <h4 className="settings-section-h">ルーム</h4>
        <div className="settings-tag-row">
          {rooms.length ? rooms.map((r) => (
            <span key={r.name} className={`settings-tag ${r.vip ? 'settings-tag-vip' : ''}`}>
              {r.vip ? '✦ ' : ''}{r.name}
            </span>
          )) : <span className="muted">未登録</span>}
        </div>

        <p className="muted small" style={{ marginTop: 12 }}>
          ※ 料金・キャスト・ルームの変更は Google スプレッドシートを直接編集してください。
        </p>
      </div>

      {toast.element}
    </div>
  )
}
