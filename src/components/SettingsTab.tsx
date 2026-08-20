import { useEffect, useState } from 'react'
import { db } from '../lib/db'
import { fmtCurrency } from '../lib/format'
import {
  disableStaffPush,
  enableStaffPush,
  getStaffPushState,
  sendStaffTestPush,
  type StaffPushState,
} from '../lib/push'
import { applyTheme, getStoredTheme, type ThemeName } from '../lib/theme'
import { Settings as SettingsIcon, ListChecks, Crown, Mail } from '../icons'
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

export default function SettingsTab({ castName }: { castName: string }) {
  const [theme, setTheme] = useState<ThemeName>(getStoredTheme())
  const [busy, setBusy] = useState(false)
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  const [rooms, setRooms] = useState<RoomData[]>([])
  const [casts, setCasts] = useState<string[]>([])
  const toast = useToast()

  useEffect(() => {
    (async () => {
      const [rPrice, rCast] = await Promise.all([
        db.call<PricingEntry[]>('getPricing'),
        db.call<{ casts: string[]; rooms: string[]; roomsData: RoomData[] }>('getCastsAndRooms'),
      ])
      if (rPrice.ok) setPricing(rPrice.data)
      if (rCast.ok) {
        setCasts(rCast.data.casts)
        setRooms(rCast.data.roomsData || rCast.data.rooms.map((n) => ({ name: n, vip: 0 })))
      }
    })()
  }, [])

  function chooseTheme(t: ThemeName) {
    setTheme(t)
    applyTheme(t)  // 即時反映
  }

  async function save() {
    setBusy(true)
    // db.call('saveUserSettings', settings) — Supabase版は castName 不要（auth.uid()で識別）
    const r = await db.call('saveUserSettings', { theme })
    setBusy(false)
    if (r.ok) toast.show('設定を保存しました')
    else toast.show((r as { error: string }).error || '保存に失敗しました', 'err')
  }

  return (
    <div className="settings-tab">
      <div className="card">
        <div className="card-title">
          <SettingsIcon size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          テーマ
        </div>
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

      <StaffPushCard />

      <div className="card">
        <div className="card-title">
          <ListChecks size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          マスタ情報（参照のみ）
        </div>

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
              {r.vip && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
              {r.name}
            </span>
          )) : <span className="muted">未登録</span>}
        </div>

        <p className="muted small" style={{ marginTop: 12 }}>
          ※ 料金・キャスト・ルームの変更は Supabase ダッシュボードから直接編集してください（管理画面は今後実装予定）。
        </p>
      </div>

      {toast.element}
    </div>
  )
}

// お客様の申込・取り消し・変更申請を、この端末の通知で受け取る設定。
// 予約タブを開いていないと気づけない、という状態をなくすためのもの。
function StaffPushCard() {
  const [state, setState] = useState<StaffPushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toast = useToast()

  useEffect(() => {
    getStaffPushState().then(setState)
  }, [])

  async function turnOn() {
    setBusy(true)
    setErr('')
    const r = await enableStaffPush()
    setState(r.state)
    if (!r.ok && r.error) setErr(r.error)
    else if (r.ok) toast.show('この端末でお知らせを受け取ります')
    setBusy(false)
  }

  async function turnOff() {
    setBusy(true)
    setState(await disableStaffPush())
    setBusy(false)
  }

  async function test() {
    setBusy(true)
    setErr('')
    const r = await sendStaffTestPush()
    if (!r.ok) setErr(r.error || '送信できませんでした')
    else toast.show('テストのお知らせを送りました')
    setBusy(false)
  }

  if (state === null) return null

  return (
    <div className="card">
      <div className="card-title">
        <Mail size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
        お客様からのお知らせ
      </div>

      {state === 'unsupported' && (
        <p className="muted small">このブラウザでは通知を扱えません。</p>
      )}

      {state === 'ios-needs-pwa' && (
        <p className="muted small">
          iPhone・iPad でお知らせを受け取るには、共有ボタンから「ホーム画面に追加」して、
          追加したアイコンから開いてください。
        </p>
      )}

      {state === 'denied' && (
        <p className="muted small">
          このサイトからの通知がブラウザ側で止められています。
          アドレスバーの左にある鍵のマークから通知を「許可」に変えてください。
        </p>
      )}

      {state === 'off' && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            新しい申込・お客様の取り消し・日時変更の申請を、この端末にお知らせします。
            予約タブを開いていなくても届くので、承認漏れを防げます。
          </p>
          <button className="btn-primary" onClick={turnOn} disabled={busy}>
            {busy ? '設定中...' : 'お知らせを受け取る'}
          </button>
        </>
      )}

      {state === 'on' && (
        <>
          <p className="muted small" style={{ marginTop: 0 }}>
            この端末でお知らせを受け取ります。管理者は全件、キャストは自分あての予約が届きます。
          </p>
          <div className="settings-push-actions">
            <button className="btn-secondary" onClick={test} disabled={busy}>
              テスト送信
            </button>
            <button className="btn-secondary" onClick={turnOff} disabled={busy}>
              受け取りを止める
            </button>
          </div>
        </>
      )}

      {err && <p className="err small">{err}</p>}
      {toast.element}
    </div>
  )
}
