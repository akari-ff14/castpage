import { useState } from 'react'
import HistoryTab from './HistoryTab'
import CustomerSubtab from './CustomerSubtab'
import BlacklistSubtab from './BlacklistSubtab'

type SubtabId = 'history' | 'customer' | 'blacklist'

const SUBTABS: Array<{ id: SubtabId; label: string }> = [
  { id: 'history', label: '当日対応履歴' },
  { id: 'customer', label: '顧客履歴' },
  { id: 'blacklist', label: 'BL' },
]

export default function ListTab({
  castName,
  isAdmin,
}: {
  castName: string
  isAdmin: boolean
}) {
  const [sub, setSub] = useState<SubtabId>('history')

  return (
    <div>
      <nav className="subtab-nav">
        {SUBTABS.map((s) => (
          <button
            key={s.id}
            className={`subtab-btn ${sub === s.id ? 'active' : ''}`}
            onClick={() => setSub(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>
      {sub === 'history' && <HistoryTab castName={castName} isAdmin={isAdmin} />}
      {sub === 'customer' && <CustomerSubtab />}
      {sub === 'blacklist' && <BlacklistSubtab />}
    </div>
  )
}
