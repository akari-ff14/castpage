import type { ReactNode } from 'react'
import {
  ArrowLeft,
  Calendar,
  DoorOpen,
  MessageSquare,
  Settings,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from '../../icons'
import type { AdminSub, AdminSubGroup } from './adminTypes'

interface SubDef {
  id: Exclude<AdminSub, 'home'>
  label: string
  icon: ReactNode
  group: AdminSubGroup
}

const ICON_SIZE = 14

const SUBS: SubDef[] = [
  { id: 'cast',     label: 'キャスト',   icon: <Users size={ICON_SIZE} />,         group: 'master' },
  { id: 'room',     label: 'ルーム',     icon: <DoorOpen size={ICON_SIZE} />,      group: 'master' },
  { id: 'pricing',  label: '料金',       icon: <Tag size={ICON_SIZE} />,           group: 'master' },
  { id: 'store',    label: '店舗設定',   icon: <Settings size={ICON_SIZE} />,      group: 'master' },
  { id: 'days',     label: '受付日',     icon: <Calendar size={ICON_SIZE} />,      group: 'ops' },
  { id: 'session',  label: '接客',       icon: <MessageSquare size={ICON_SIZE} />, group: 'ops' },
  { id: 'budget',   label: '予算',       icon: <Wallet size={ICON_SIZE} />,        group: 'ops' },
  { id: 'insights', label: 'インサイト', icon: <TrendingUp size={ICON_SIZE} />,    group: 'analytics' },
]

interface Props {
  current: Exclude<AdminSub, 'home'>
  onNavigate: (sub: AdminSub) => void
}

export default function AdminToolbar({ current, onNavigate }: Props) {
  return (
    <div className="admin-toolbar">
      <button
        type="button"
        className="admin-back-btn"
        onClick={() => onNavigate('home')}
      >
        <ArrowLeft size={ICON_SIZE} />
        ホーム
      </button>

      <nav className="subtab-nav admin-subtab-scroll admin-toolbar-tabs">
        {SUBS.map((s, i) => {
          const prev = SUBS[i - 1]
          const showSep = prev && prev.group !== s.group
          return (
            <span key={s.id} className="admin-toolbar-tab-wrap">
              {showSep && <span className="subtab-sep" aria-hidden />}
              <button
                type="button"
                className={`subtab-btn ${current === s.id ? 'active' : ''}`}
                onClick={() => onNavigate(s.id)}
              >
                <span className="subtab-icon">{s.icon}</span>
                {s.label}
              </button>
            </span>
          )
        })}
      </nav>
    </div>
  )
}
