// お客様向け予約ページのデータアクセス層。
//
// キャスト用アプリの lib/db.ts は読み込まない。あちらは売上・顧客・出禁など
// 店内業務のクエリを抱えているので、お客様に配るファイルには入れない。
// ここから触るのは公開 RPC だけで、テーブルを直接読み書きはしない。

import { supabase } from './supabaseClient'

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
// ページを見ているだけの人にはアカウントを作らない（無駄なアカウントを増やさないため）。
//
// captchaToken は Turnstile の確認結果。Supabase Auth 側で Captcha protection を
// 有効にしてあると、これが無い匿名ログインは弾かれる。
// 機械的にアカウントを作り直して連投するのを、ここで止める。
async function ensureSession(captchaToken?: string): Promise<void> {
  const { data } = await supabase.auth.getSession()
  if (data.session) return

  const { error } = await supabase.auth.signInAnonymously(
    captchaToken ? { options: { captchaToken } } : undefined,
  )
  if (error) {
    // captcha で弾かれたときは、やり直せば通ることを伝える
    if (/captcha/i.test(error.message)) {
      throw new Error('確認に失敗しました。ページを開き直してもう一度お試しください')
    }
    throw new Error('接続できませんでした。時間をおいてもう一度お試しください')
  }
}


// 店に「申込が入った / 取り消された / 変更申請が来た」を知らせる。
// 届かなくてもお客様の操作は成立しているので、失敗は黙って飲み込む
async function notifyStaff(reservationId: string, kind: 'new' | 'cancel' | 'change'): Promise<void> {
  try {
    await supabase.functions.invoke('notify-staff', { body: { reservationId, kind } })
  } catch {
    // 通知が飛ばなくても、店は予約タブを開けば気づける
  }
}

// 接客の種別と、30分あたりの単価。
// pricing テーブルそのものは店の人しか読めないので、公開してよい分だけを
// get_public_prices から受け取る。オプションはここには入らない
export interface ServicePrice {
  key: string
  label: string
  price: number      // 30分あたり・お一人あたり
}

export async function fetchServicePrices(): Promise<ServicePrice[]> {
  const { data, error } = await supabase.rpc('get_public_prices')
  if (error) throw error
  return ((data || []) as Record<string, unknown>[]).map((r) => ({
    key: String(r.key),
    label: String(r.label || r.key),
    price: Number(r.price) || 0,
  }))
}

export interface SubmitResult {
  ok: boolean
  error?: string
  code?: string
  startsAt?: string
  slotTime?: string
  price?: number
  serviceType?: string
  durationMin?: number
}

export async function submitReservation(payload: {
  businessDate: string
  castId: string
  slotNo: number
  customerName: string
  serviceType: string
  durationMin: number
  email?: string
  note?: string
  captchaToken?: string
}): Promise<SubmitResult> {
  try {
    await ensureSession(payload.captchaToken)
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  const { data, error } = await supabase.rpc('request_reservation', {
    p_business_date: payload.businessDate,
    p_cast_id: payload.castId,
    p_slot_no: payload.slotNo,
    p_customer_name: payload.customerName,
    p_email: payload.email || null,
    p_note: payload.note || '',
    p_service_type: payload.serviceType,
    p_duration_min: payload.durationMin,
  })
  if (error) return { ok: false, error: '送信できませんでした。もう一度お試しください' }

  const r = (data || {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: String(r.error || '送信できませんでした') }

  await notifyStaff(String(r.id), 'new')

  return {
    ok: true,
    code: String(r.code || ''),
    startsAt: String(r.startsAt || ''),
    slotTime: String(r.slotTime || ''),
    // 金額は DB 側で確定させる。画面の計算とずれたときは DB の方が正
    price: Number(r.price) || 0,
    serviceType: String(r.serviceType || ''),
    durationMin: Number(r.durationMin) || 0,
  }
}

// ============================================================
// 自分の申し込みを見る
// ============================================================

export type ReservationStatus = 'pending' | 'confirmed' | 'rejected'

export interface MyReservation {
  id: string
  publicCode: string
  businessDate: string | null
  slotNo: number | null
  startsAt: string
  castName: string
  customerName: string
  note: string
  status: ReservationStatus
  cancelled: boolean
  decisionNote: string
  createdAt: string
  changeFromId: string | null   // 変更申請なら、変更元の予約 id
  serviceType: string           // 店側で入れた予約は空（部屋で決まるため）
  serviceLabel: string
  durationMin: number
  price: number
}

function toMyReservation(r: Record<string, unknown>): MyReservation {
  return {
    id: String(r.id),
    publicCode: String(r.public_code || ''),
    businessDate: (r.business_date as string | null) ?? null,
    slotNo: r.slot_no == null ? null : Number(r.slot_no),
    startsAt: String(r.starts_at),
    castName: String(r.cast_name || ''),
    customerName: String(r.customer_name || ''),
    note: String(r.note || ''),
    status: (r.status as ReservationStatus) || 'pending',
    cancelled: !!r.cancelled,
    decisionNote: String(r.decision_note || ''),
    createdAt: String(r.created_at || ''),
    changeFromId: (r.change_from_id as string | null) ?? null,
    serviceType: String(r.service_type || ''),
    serviceLabel: String(r.service_label || ''),
    durationMin: Number(r.duration_min) || 0,
    price: Number(r.price) || 0,
  }
}

// この端末で申し込んだ分。匿名アカウントがまだ無ければ null（作りには行かない）
export async function fetchMyReservations(): Promise<MyReservation[] | null> {
  const { data: sess } = await supabase.auth.getSession()
  if (!sess.session) return null

  const { data, error } = await supabase.rpc('get_my_reservations')
  if (error) throw error
  return (data || []).map(toMyReservation)
}

// 予約番号での照会。別の端末やブラウザから確認するときに使う
export async function lookupByCode(code: string): Promise<MyReservation | null> {
  const trimmed = code.trim()
  if (!trimmed) return null
  const { data, error } = await supabase.rpc('lookup_reservation', { p_code: trimmed })
  if (error) throw error
  const rows = (data || []) as Record<string, unknown>[]
  if (!rows.length) return null
  return { ...toMyReservation(rows[0]), note: '' }
}

export async function cancelReservation(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data, error } = await supabase.rpc('cancel_my_reservation', { p_reservation_id: id })
  if (error) return { ok: false, error: '取り消せませんでした。もう一度お試しください' }
  const r = (data || {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: String(r.error || '取り消せませんでした') }

  // 確定していた予約が消えたことに店が気づけないと、当日その時間を空けて待つことになる
  await notifyStaff(id, 'cancel')

  return { ok: true }
}

// 自分の予約が変わったら教えてもらう。承認された瞬間に画面が変わるようにする。
// 配信は RLS を通るので、届くのは自分の行だけ
export async function subscribeMyReservations(onChange: () => void): Promise<() => void> {
  const { data: sess } = await supabase.auth.getSession()
  const uid = sess.session?.user?.id
  if (!uid) return () => {}

  const channel = supabase
    .channel(`akari-book-${uid}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'reservations', filter: `customer_user_id=eq.${uid}` },
      () => onChange(),
    )
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}

// 日時やキャストの変更を申し込む。すぐには変わらず、店が承認して初めて入れ替わる
export async function requestChange(payload: {
  reservationId: string
  businessDate: string
  castId: string
  slotNo: number
}): Promise<{ ok: boolean; error?: string; code?: string }> {
  const { data, error } = await supabase.rpc('request_change', {
    p_reservation_id: payload.reservationId,
    p_business_date: payload.businessDate,
    p_cast_id: payload.castId,
    p_slot_no: payload.slotNo,
  })
  if (error) return { ok: false, error: '送信できませんでした。もう一度お試しください' }
  const r = (data || {}) as Record<string, unknown>
  if (!r.ok) return { ok: false, error: String(r.error || '送信できませんでした') }

  await notifyStaff(String(r.id), 'change')

  return { ok: true, code: String(r.code || '') }
}

// 店からの案内文。未設定なら空文字が返る
export async function fetchPublicNotice(): Promise<string> {
  const { data, error } = await supabase.rpc('get_public_notice')
  if (error) return ''
  return typeof data === 'string' ? data : ''
}
