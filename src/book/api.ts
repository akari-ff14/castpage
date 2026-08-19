// お客様向け予約ページのデータアクセス層。
//
// キャスト用アプリの lib/db.ts は読み込まない。あちらは売上・顧客・出禁など
// 店内業務のクエリを抱えているので、お客様に配るファイルには入れない。
// ここから触るのは公開 RPC だけで、テーブルを直接読み書きはしない。

import { supabase } from '../lib/supabase'

export type SlotState = 'open' | 'pending' | 'confirmed' | 'closed'

export interface PublicSlot {
  businessDate: string
  dayNote: string
  acceptFrom: string | null
  acceptUntil: string | null
  isAccepting: boolean
  castId: string
  castName: string
  slotNo: number
  slotTime: string
  startsAt: string
  state: SlotState
}

// 1日分をまとめた形。画面はこの単位で描く
export interface BookingDay {
  businessDate: string
  dayNote: string
  acceptFrom: string | null
  acceptUntil: string | null
  isAccepting: boolean
  slotTimes: string[]              // 列見出し（枠1..3の開始時刻）
  casts: Array<{
    castId: string
    castName: string
    slots: PublicSlot[]            // 枠番号順
  }>
}

// 受付中の日を取ってくる。未ログインでも呼べる
export async function fetchBookingDays(fromDate: string, toDate: string): Promise<BookingDay[]> {
  const { data, error } = await supabase.rpc('get_public_slots', {
    p_from: fromDate,
    p_to: toDate,
  })
  if (error) throw error

  const rows: PublicSlot[] = (data || []).map((r: Record<string, unknown>) => ({
    businessDate: String(r.business_date),
    dayNote: String(r.day_note || ''),
    acceptFrom: (r.accept_from as string | null) ?? null,
    acceptUntil: (r.accept_until as string | null) ?? null,
    isAccepting: !!r.is_accepting,
    castId: String(r.cast_id),
    castName: String(r.cast_name || ''),
    slotNo: Number(r.slot_no),
    slotTime: String(r.slot_time || ''),
    startsAt: String(r.starts_at),
    state: (r.state as SlotState) || 'closed',
  }))

  const byDate = new Map<string, BookingDay>()
  for (const row of rows) {
    let day = byDate.get(row.businessDate)
    if (!day) {
      day = {
        businessDate: row.businessDate,
        dayNote: row.dayNote,
        acceptFrom: row.acceptFrom,
        acceptUntil: row.acceptUntil,
        isAccepting: row.isAccepting,
        slotTimes: [],
        casts: [],
      }
      byDate.set(row.businessDate, day)
    }
    if (!day.slotTimes[row.slotNo - 1]) day.slotTimes[row.slotNo - 1] = row.slotTime

    let cast = day.casts.find((c) => c.castId === row.castId)
    if (!cast) {
      cast = { castId: row.castId, castName: row.castName, slots: [] }
      day.casts.push(cast)
    }
    cast.slots.push(row)
  }

  const days = Array.from(byDate.values())
  for (const day of days) {
    for (const cast of day.casts) cast.slots.sort((a, b) => a.slotNo - b.slotNo)
    day.casts.sort((a, b) => a.castName.localeCompare(b.castName, 'ja'))
  }
  days.sort((a, b) => a.businessDate.localeCompare(b.businessDate))
  return days
}

// 申し込みの直前だけ匿名アカウントを作る。
// ページを見ているだけの人にはアカウントを作らない（無駄なアカウントを増やさないため）
async function ensureSession(): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return
  const { error } = await supabase.auth.signInAnonymously()
  if (error) throw new Error('接続できませんでした。時間をおいてもう一度お試しください')
}

export interface SubmitResult {
  ok: boolean
  error?: string
  code?: string
  startsAt?: string
  slotTime?: string
}

export async function submitReservation(payload: {
  businessDate: string
  castId: string
  slotNo: number
  customerName: string
  email?: string
  note?: string
}): Promise<SubmitResult> {
  await ensureSession()

  const { data, error } = await supabase.rpc('request_reservation', {
    p_business_date: payload.businessDate,
    p_cast_id: payload.castId,
    p_slot_no: payload.slotNo,
    p_customer_name: payload.customerName,
    p_email: payload.email || null,
    p_note: payload.note || '',
  })
  if (error) return { ok: false, error: '送信できませんでした。もう一度お試しください' }

  const r = (data || {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: String(r.error || '送信できませんでした') }
  return {
    ok: true,
    code: String(r.code || ''),
    startsAt: String(r.startsAt || ''),
    slotTime: String(r.slotTime || ''),
  }
}
