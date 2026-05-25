import { useState } from 'react'
import CastAdmin from './admin/CastAdmin'
import RoomAdmin from './admin/RoomAdmin'
import PricingAdmin from './admin/PricingAdmin'
import SessionAdmin from './admin/SessionAdmin'

type AdminSubtab = 'cast' | 'room' | 'pricing' | 'session'

const SUBS: Array<{ id: AdminSubtab; label: string }> = [
  { id: 'cast', label: 'キャスト' },
  { id: 'room', label: 'ルーム' },
  { id: 'pricing', label: '料金' },
  { id: 'session', label: '接客' },
]

export default function AdminTab() {
  const [sub, setSub] = useState<AdminSubtab>('cast')
  return (
    <div>
      <nav className="subtab-nav">
        {SUBS.map((s) => (
          <button
            key={s.id}
            className={`subtab-btn ${sub === s.id ? 'active' : ''}`}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {sub === 'cast' && <CastAdmin />}
      {sub === 'room' && <RoomAdmin />}
      {sub === 'pricing' && <PricingAdmin />}
      {sub === 'session' && <SessionAdmin />}
    </div>
  )
}
