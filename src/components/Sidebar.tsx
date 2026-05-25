import { useEffect } from 'react'
import {
  Home,
  MessageSquare,
  Calendar,
  ListChecks,
  Users,
  UserX,
  TrendingUp,
  Wrench,
  Settings as SettingsIcon,
  Close,
  LogOut,
  Swap,
} from '../icons'
import './Sidebar.css'

export type RouteId =
  | 'home'
  | 'session'
  | 'reservation'
  | 'history'
  | 'customer'
  | 'blacklist'
  | 'revenue'
  | 'admin'
  | 'settings'

interface NavItem {
  id: RouteId
  label: string
  icon: typeof Home
  adminOnly?: boolean
}

const MAIN_NAV: NavItem[] = [
  { id: 'home', label: 'ホーム', icon: Home },
  { id: 'session', label: '接客', icon: MessageSquare },
  { id: 'reservation', label: '予約', icon: Calendar },
  { id: 'history', label: '履歴', icon: ListChecks },
  { id: 'customer', label: '顧客', icon: Users },
  { id: 'blacklist', label: 'ブラックリスト', icon: UserX },
  { id: 'revenue', label: '売上', icon: TrendingUp },
  { id: 'admin', label: '管理', icon: Wrench, adminOnly: true },
]

const FOOTER_NAV: NavItem[] = [
  { id: 'settings', label: '設定', icon: SettingsIcon },
]

interface Props {
  current: RouteId
  onNavigate: (id: RouteId) => void
  isAdmin: boolean
  castName: string
  isOpen: boolean
  onClose: () => void
  onLogout: () => void
  onChangeCast: () => void
}

export default function Sidebar({
  current,
  onNavigate,
  isAdmin,
  castName,
  isOpen,
  onClose,
  onLogout,
  onChangeCast,
}: Props) {
  // ESC でドロワーを閉じる + 開いている間は body スクロールロック
  useEffect(() => {
    if (!isOpen) return
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [isOpen, onClose])

  function handleNavClick(id: RouteId) {
    onNavigate(id)
    onClose()  // モバイル時は閉じる、PC時はもともと開いていない扱い
  }

  const visibleMain = MAIN_NAV.filter((i) => !i.adminOnly || isAdmin)

  return (
    <>
      {/* モバイル時のバックドロップ */}
      <div
        className={`sidebar-backdrop ${isOpen ? 'visible' : ''}`}
        onClick={onClose}
        aria-hidden
      />
      <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="メインナビゲーション">
        <div className="sidebar-header">
          <div className="sidebar-brand">
            <span className="sidebar-brand-mark">灯</span>
            <span className="sidebar-brand-name">対話店[灯]</span>
          </div>
          <button
            type="button"
            className="sidebar-close-btn"
            onClick={onClose}
            aria-label="メニューを閉じる"
          >
            <Close size={18} />
          </button>
        </div>

        <nav className="sidebar-nav">
          {visibleMain.map((item) => {
            const Icon = item.icon
            const active = current === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-link ${active ? 'active' : ''}`}
                onClick={() => handleNavClick(item.id)}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} />
                <span>{item.label}</span>
                {item.adminOnly && <span className="sidebar-badge">管理</span>}
              </button>
            )
          })}
        </nav>

        <div className="sidebar-footer">
          <nav>
            {FOOTER_NAV.map((item) => {
              const Icon = item.icon
              const active = current === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`sidebar-link ${active ? 'active' : ''}`}
                  onClick={() => handleNavClick(item.id)}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={18} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <div className="sidebar-user">
            <div className="sidebar-user-info">
              <div className="sidebar-user-name">{castName}</div>
              {isAdmin && <div className="sidebar-user-role">管理者</div>}
            </div>
            <div className="sidebar-user-actions">
              <button
                type="button"
                className="sidebar-user-btn"
                onClick={onChangeCast}
                title="別のキャストとして使う"
                aria-label="キャスト切替"
              >
                <Swap size={14} />
              </button>
              <button
                type="button"
                className="sidebar-user-btn"
                onClick={onLogout}
                title="ログアウト"
                aria-label="ログアウト"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </aside>
    </>
  )
}
