import { useState } from 'react'
import CastAdmin from './admin/CastAdmin'
import RoomAdmin from './admin/RoomAdmin'
import PricingAdmin from './admin/PricingAdmin'
import StoreSettingsAdmin from './admin/StoreSettingsAdmin'
import SessionAdmin from './admin/SessionAdmin'
import BudgetAdmin from './admin/BudgetAdmin'
import InsightsAdmin from './admin/InsightsAdmin'
import AdminHome from './admin/AdminHome'
import AdminToolbar from './admin/AdminToolbar'
import type { AdminSub } from './admin/adminTypes'

export default function AdminTab() {
  const [sub, setSub] = useState<AdminSub>('home')

  if (sub === 'home') {
    return <AdminHome onNavigate={setSub} />
  }

  return (
    <div>
      <AdminToolbar current={sub} onNavigate={setSub} />
      {sub === 'cast' && <CastAdmin />}
      {sub === 'room' && <RoomAdmin />}
      {sub === 'pricing' && <PricingAdmin />}
      {sub === 'store' && <StoreSettingsAdmin />}
      {sub === 'session' && <SessionAdmin />}
      {sub === 'budget' && <BudgetAdmin />}
      {sub === 'insights' && <InsightsAdmin />}
    </div>
  )
}
