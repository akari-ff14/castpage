import { useEffect, useState } from 'react'
import StatusCard from '../StatusCard'
import ActivityFeed from '../ActivityFeed'
import {
  fetchAdminHomeStats,
  getExpenses,
  getPricing,
  listAllCasts,
  listAllRooms,
  type AdminHomeStats,
  type PricingEntry,
} from '../../lib/db'
import { fmtCurrency } from '../../lib/format'
import {
  ArrowLeft,
  DoorOpen,
  MessageSquare,
  RefreshCw,
  Tag,
  TrendingUp,
  Users,
  Wallet,
} from '../../icons'
import type { AdminSub } from './adminTypes'
import './AdminHome.css'

interface Props {
  onNavigate: (sub: AdminSub) => void
}

interface DerivedStats {
  activeCasts: number
  pendingInvites: number
  activeRooms: number
  vipRooms: number
  normalPrice: number | null
  vipPrice: number | null
  optionPrice: number | null
  thisMonthExpense: number
  thisMonthExpenseCount: number
  sessions: AdminHomeStats | null
}

const EMPTY: DerivedStats = {
  activeCasts: 0,
  pendingInvites: 0,
  activeRooms: 0,
  vipRooms: 0,
  normalPrice: null,
  vipPrice: null,
  optionPrice: null,
  thisMonthExpense: 0,
  thisMonthExpenseCount: 0,
  sessions: null,
}

function priceOf(pricing: PricingEntry[], key: string): number | null {
  const row = pricing.find((p) => p.key === key)
  return row ? Number(row.price) : null
}

export default function AdminHome({ onNavigate }: Props) {
  const [stats, setStats] = useState<DerivedStats | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setBusy(true)
    setErr('')
    try {
      const [casts, rooms, pricing, expenses, sessions] = await Promise.all([
        listAllCasts(),
        listAllRooms(),
        getPricing(),
        getExpenses(),
        fetchAdminHomeStats(),
      ])
      const now = new Date()
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      const thisMonth = expenses.filter((e) => e.日付.startsWith(ym))
      setStats({
        activeCasts: casts.filter((c) => c.active).length,
        pendingInvites: casts.filter((c) => c.invite_code && !c.user_id).length,
        activeRooms: rooms.filter((r) => r.active).length,
        vipRooms: rooms.filter((r) => r.active && r.vip).length,
        normalPrice: priceOf(pricing, 'normal'),
        vipPrice: priceOf(pricing, 'vip'),
        optionPrice: priceOf(pricing, 'option'),
        thisMonthExpense: thisMonth.reduce((sum, e) => sum + e.金額, 0),
        thisMonthExpenseCount: thisMonth.length,
        sessions,
      })
    } catch (e) {
      setErr((e as Error).message)
      setStats(EMPTY)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const s = stats

  return (
    <div className="admin-home">
      <div className="admin-home-toolbar">
        <div className="admin-home-title">
          <ArrowLeft size={14} /> 管理ホーム
        </div>
        <button
          type="button"
          className="admin-home-refresh"
          onClick={load}
          disabled={busy}
          title="再取得"
          aria-label="再取得"
        >
          <RefreshCw size={14} />
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      <section className="admin-home-group">
        <h4 className="admin-section-h">マスタ管理</h4>
        <div className="admin-home-grid">
          <StatusCard
            accent="gold"
            icon={<Users size={20} />}
            title="キャスト"
            onClick={() => onNavigate('cast')}
            actionLabel="開く"
          >
            <Kpi value={s ? `${s.activeCasts}人` : '—'} sub={s ? `招待コード未配布 ${s.pendingInvites}件` : '読み込み中…'} mutedIfZero={s?.activeCasts === 0} />
          </StatusCard>

          <StatusCard
            accent="gold"
            icon={<DoorOpen size={20} />}
            title="ルーム"
            onClick={() => onNavigate('room')}
            actionLabel="開く"
          >
            <Kpi value={s ? `${s.activeRooms}室` : '—'} sub={s ? `うち VIP ${s.vipRooms}室` : '読み込み中…'} mutedIfZero={s?.activeRooms === 0} />
          </StatusCard>

          <StatusCard
            accent="gold"
            icon={<Tag size={20} />}
            title="料金"
            onClick={() => onNavigate('pricing')}
            actionLabel="開く"
          >
            <Kpi
              value={s?.normalPrice != null ? fmtCurrency(s.normalPrice) : '—'}
              sub={s?.vipPrice != null ? `VIP ${fmtCurrency(s.vipPrice)} / オプション ${s.optionPrice != null ? fmtCurrency(s.optionPrice) : '—'}` : '読み込み中…'}
            />
          </StatusCard>
        </div>
      </section>

      <section className="admin-home-group">
        <h4 className="admin-section-h">運用</h4>
        <div className="admin-home-grid">
          <StatusCard
            accent="teal"
            icon={<MessageSquare size={20} />}
            title="接客"
            onClick={() => onNavigate('session')}
            actionLabel="開く"
          >
            <Kpi
              value={s?.sessions ? `進行中 ${s.sessions.activeCount}件` : '—'}
              sub={s?.sessions ? `今日 ${s.sessions.todayCount}件完了` : '読み込み中…'}
              mutedIfZero={s?.sessions?.activeCount === 0}
            />
          </StatusCard>

          <StatusCard
            accent="teal"
            icon={<Wallet size={20} />}
            title="予算"
            onClick={() => onNavigate('budget')}
            actionLabel="開く"
          >
            <Kpi
              value={s ? fmtCurrency(s.thisMonthExpense) : '—'}
              sub={s ? `今月 ${s.thisMonthExpenseCount}件` : '読み込み中…'}
              mutedIfZero={s?.thisMonthExpense === 0}
            />
          </StatusCard>
        </div>
      </section>

      <section className="admin-home-group">
        <h4 className="admin-section-h">分析</h4>
        <div className="admin-home-grid">
          <StatusCard
            accent="purple"
            icon={<TrendingUp size={20} />}
            title="インサイト"
            onClick={() => onNavigate('insights')}
            actionLabel="開く"
          >
            <Kpi
              value={s?.sessions ? fmtCurrency(s.sessions.monthRevenue) : '—'}
              sub={s?.sessions ? `今月 ${s.sessions.monthCount}件` : '読み込み中…'}
              mutedIfZero={s?.sessions?.monthRevenue === 0}
            />
          </StatusCard>
        </div>
      </section>

      <ActivityFeed limit={20} />
    </div>
  )
}

function Kpi({ value, sub, mutedIfZero }: { value: string; sub?: string; mutedIfZero?: boolean }) {
  return (
    <>
      <div className={`admin-home-kpi ${mutedIfZero ? 'muted' : ''}`}>{value}</div>
      {sub && <div className="admin-home-kpi-sub">{sub}</div>}
    </>
  )
}
