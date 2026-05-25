import { useState } from 'react'
import CastAdmin from './admin/CastAdmin'
import RoomAdmin from './admin/RoomAdmin'
import PricingAdmin from './admin/PricingAdmin'
import SessionAdmin from './admin/SessionAdmin'
import BudgetAdmin from './admin/BudgetAdmin'
import InsightsAdmin from './admin/InsightsAdmin'

type AdminSubtab = 'cast' | 'room' | 'pricing' | 'session' | 'budget' | 'insights'

const SUBS: Array<{ id: AdminSubtab; label: string }> = [
  { id: 'cast', label: 'キャスト' },
  { id: 'room', label: 'ルーム' },
  { id: 'pricing', label: '料金' },
  { id: 'session', label: '接客' },
  { id: 'budget', label: '予算' },
  { id: 'insights', label: 'インサイト' },
]

export default function AdminTab() {
  const [sub, setSub] = useState<AdminSubtab>('cast')
  return (
    <div>
      <nav className="subtab-nav admin-subtab-scroll">
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
      {sub === 'budget' && <BudgetAdmin />}
      {sub === 'insights' && <InsightsAdmin />}
    </div>
  )
}
