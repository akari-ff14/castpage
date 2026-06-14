// Supabase データアクセス層
//
// 既存タブの変更を最小化するため、戻り値の形は GAS API のレスポンスに合わせて
// 日本語キーに変換する。内部的には英語キーの正規化スキーマ。
//
// 認証は Supabase 側で自動的にハンドリングされる（auth.uid() が RLS で使われる）

import { supabase } from './supabase'

// ============================================================
// 型定義（旧 AkariApi の戻り値と互換）
// ============================================================

export interface SessionShape {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  顧客数: number
  接客種別: string
  接客種別表示名: string
  基本単価: number
  オプション単価: number
  開始時間: string
  対応終了時間: string
  延長回数: number
  オプション回数: number
  備考: string
  収益金: number
  作成日時: string
  更新日時: string
  完了: boolean
}

export interface PricingEntry {
  key: string
  label: string
  price: number
}

export interface RoomData {
  name: string
  vip: number
}

export interface BlEntry {
  name: string
  reason?: string
  note?: string
}

export interface CustomerRecord {
  session_id: string
  対応キャスト: string
  対応日: string
  顧客名: string
  作成日時: string
}

export interface ReservationShape {
  reservation_id: string
  キャスト名: string
  顧客名: string
  予約種別: '当日' | '事前'
  予約金額: number
  予約時間: number   // 対応時間（分）
  予約日時: string
  ルーム: string
  備考: string
  作成日時: string
  更新日時: string
}

export interface FinishBreakdown {
  total: number
  basePrice: number
  extendPrice: number
  extendCount: number
  optionPrice: number
  optionCount: number
}

export type ActivityType = 'start' | 'end' | 'extend' | 'option'

export interface ActivityLog {
  id: string
  type: ActivityType
  cast_name: string
  customer_name: string | null
  session_id: string | null
  created_at: string
}

export interface CastRevenue {
  cast: string
  guarantee: number
  baseTotal: number
  optTotal: number
  revenue: number
  salary: number
  cashFlow: number
}

export interface RevenueStatus {
  casts: CastRevenue[]
  totals: { revenue: number; salary: number; cashFlow: number }
  businessDay: string
  busStart: string
}

interface SessionRow {
  id: string
  cast_id: string
  room_id: string | null
  service_type: string
  customer_names: string
  customer_count: number
  base_price: number
  option_price: number
  extend_count: number
  option_count: number
  started_at: string
  ended_at: string
  finished: boolean
  note: string
  revenue: number
  created_at: string
  updated_at: string
  cast?: { name: string } | null
  room?: { name: string } | null
}

// ============================================================
// マスタ参照キャッシュ（cast/room の name↔id 変換）
// ============================================================

let _castsCache: Array<{ id: string; name: string }> | null = null
let _roomsCache: Array<{ id: string; name: string; vip: boolean }> | null = null
let _pricingCache: Map<string, PricingEntry> | null = null

async function loadCasts() {
  if (_castsCache) return _castsCache
  // casts_public ビュー経由 (invite_code を除外、RLS バイパスして全 authenticated に id/name を露出)
  const { data, error } = await supabase
    .from('casts_public')
    .select('id, name')
    .eq('active', true)
    .order('name')
  if (error) throw error
  _castsCache = data || []
  return _castsCache
}

async function loadRooms() {
  if (_roomsCache) return _roomsCache
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, vip')
    .eq('active', true)
    .order('name')
  if (error) throw error
  _roomsCache = data || []
  return _roomsCache
}

async function loadPricing() {
  if (_pricingCache) return _pricingCache
  const { data, error } = await supabase
    .from('pricing')
    .select('key, label, price')
    .eq('active', true)
  if (error) throw error
  _pricingCache = new Map((data || []).map((p) => [p.key, { key: p.key, label: p.label, price: Number(p.price) }]))
  return _pricingCache
}

async function castIdByName(name: string): Promise<string> {
  const casts = await loadCasts()
  const c = casts.find((x) => x.name === name)
  if (!c) throw new Error(`Cast not found: ${name}`)
  return c.id
}

async function roomIdByName(name: string): Promise<string | null> {
  if (!name) return null
  const rooms = await loadRooms()
  const r = rooms.find((x) => x.name === name)
  return r?.id ?? null
}

function invalidateCaches() {
  _castsCache = null
  _roomsCache = null
  _pricingCache = null
}

function sessionRowToShape(row: SessionRow, pricing: Map<string, PricingEntry>): SessionShape {
  const pr = pricing.get(row.service_type)
  return {
    session_id: row.id,
    対応者: row.cast?.name || '',
    ルーム: row.room?.name || '',
    顧客名: row.customer_names,
    顧客数: row.customer_count,
    接客種別: row.service_type,
    接客種別表示名: pr?.label || row.service_type,
    基本単価: Number(row.base_price),
    オプション単価: Number(row.option_price),
    開始時間: row.started_at,
    対応終了時間: row.ended_at,
    延長回数: row.extend_count,
    オプション回数: row.option_count,
    備考: row.note,
    収益金: Number(row.revenue),
    作成日時: row.created_at,
    更新日時: row.updated_at,
    完了: row.finished,
  }
}

const SESSION_SELECT = 'id, cast_id, room_id, service_type, customer_names, customer_count, base_price, option_price, extend_count, option_count, started_at, ended_at, finished, note, revenue, created_at, updated_at, cast:casts(name), room:rooms(name)'

// ============================================================
// API: マスタ / 一覧
// ============================================================

export async function getActiveSession(castName: string): Promise<SessionShape | null> {
  const cId = await castIdByName(castName)
  const pricing = await loadPricing()
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('cast_id', cId)
    .eq('finished', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data ? sessionRowToShape(data as unknown as SessionRow, pricing) : null
}

export async function getCastsAndRooms() {
  const [casts, rooms] = await Promise.all([loadCasts(), loadRooms()])
  return {
    casts: casts.map((c) => c.name),
    rooms: rooms.map((r) => r.name),
    roomsData: rooms.map((r) => ({ name: r.name, vip: r.vip ? 1 : 0 })),
  }
}

export async function getPricing(): Promise<PricingEntry[]> {
  const m = await loadPricing()
  return [...m.values()]
}

export async function getCustomers(): Promise<CustomerRecord[]> {
  const { data, error } = await supabase
    .from('customer_visits')
    .select('id, session_id, customer_name, visited_at, created_at, cast:casts(name)')
    .order('visited_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({
    session_id: r.session_id || '',
    対応キャスト: (r.cast as { name?: string } | null)?.name || '',
    対応日: r.visited_at,
    顧客名: r.customer_name,
    作成日時: r.created_at,
  }))
}

export async function getBlacklist(): Promise<BlEntry[]> {
  const { data, error } = await supabase
    .from('blacklist')
    .select('name, reason, note')
    .eq('active', true)
    .order('name')
  if (error) throw error
  return (data || []).map((b) => ({ name: b.name, reason: b.reason, note: b.note }))
}

export async function getReservations(): Promise<ReservationShape[]> {
  const { data, error } = await supabase
    .from('reservations')
    .select('id, customer_name, reservation_type, reservation_price, duration_min, reserved_at, note, created_at, updated_at, cast:casts(name), room:rooms(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({
    reservation_id: r.id,
    キャスト名: (r.cast as { name?: string } | null)?.name || '',
    顧客名: r.customer_name,
    予約種別: r.reservation_type === 'sameday' ? '当日' : '事前',
    予約金額: Number(r.reservation_price),
    予約時間: Number(r.duration_min) || 60,
    予約日時: r.reserved_at,
    ルーム: (r.room as { name?: string } | null)?.name || '',
    備考: r.note,
    作成日時: r.created_at,
    更新日時: r.updated_at,
  }))
}

export async function getHistory(params?: { year?: number; month?: number }): Promise<SessionShape[]> {
  const pricing = await loadPricing()
  let q = supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('finished', true)
    .order('created_at', { ascending: false })

  if (params?.year && params?.month) {
    // JST 月初〜翌月初
    const y = params.year
    const m = params.month
    const JST_OFFSET_MS = 9 * 60 * 60 * 1000
    const startUtc = new Date(Date.UTC(y, m - 1, 1) - JST_OFFSET_MS).toISOString()
    const endUtc = new Date(Date.UTC(y, m, 1) - JST_OFFSET_MS).toISOString()
    q = q.gte('created_at', startUtc).lt('created_at', endUtc)
  }
  const { data, error } = await q
  if (error) throw error
  return (data || []).map((r) => sessionRowToShape(r as unknown as SessionRow, pricing))
}

export async function checkRoomAvailability(roomName: string): Promise<{ available: boolean; usedBy?: string }> {
  const rId = await roomIdByName(roomName)
  if (!rId) return { available: true }
  const { data, error } = await supabase
    .from('sessions')
    .select('cast:casts(name)')
    .eq('room_id', rId)
    .eq('finished', false)
    .maybeSingle()
  if (error) throw error
  if (data) return { available: false, usedBy: (data.cast as { name?: string } | null)?.name || '' }
  return { available: true }
}

// 軽量なあいまい一致（部分文字列 + 全角半角無視程度）
function fuzzyMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[ァ-ン]/g, (m) => String.fromCharCode(m.charCodeAt(0) - 0x60))
  const na = norm(a)
  const nb = norm(b)
  return na.includes(nb) || nb.includes(na)
}

export async function checkBlacklist(name: string): Promise<Array<{ name: string; reason?: string }>> {
  if (!name?.trim()) return []
  const { data, error } = await supabase
    .from('blacklist')
    .select('name, reason')
    .eq('active', true)
  if (error) throw error
  return (data || []).filter((b) => fuzzyMatch(name, b.name)).map((b) => ({ name: b.name, reason: b.reason }))
}

// ============================================================
// API: セッション操作
// ============================================================

// ============================================================
// アクティビティログ
// ============================================================

// ログ書き込み (失敗してもセッション操作は成功扱いにするため例外を握り潰す)
async function logActivity(
  type: ActivityType,
  castName: string,
  sessionId: string | null,
  customerName: string | null,
  castId?: string | null,
): Promise<void> {
  try {
    await supabase.from('activity_logs').insert({
      type,
      cast_id: castId ?? null,
      cast_name: castName,
      customer_name: customerName,
      session_id: sessionId,
    })
  } catch (e) {
    console.warn('logActivity failed:', e)
  }
}

export async function getActivityLogs(limit = 20): Promise<ActivityLog[]> {
  const { data, error } = await supabase
    .from('activity_logs')
    .select('id, type, cast_name, customer_name, session_id, created_at')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data || []) as ActivityLog[]
}

export async function startSession(payload: {
  castName: string
  room: string
  customerNames: string[]
  note?: string
  serviceType: string
  presetSlots?: number
}): Promise<SessionShape> {
  const slots = Math.max(1, Number(payload.presetSlots) || 1)
  const cId = await castIdByName(payload.castName)
  const rId = payload.room ? await roomIdByName(payload.room) : null
  const pricing = await loadPricing()
  const svc = pricing.get(payload.serviceType)
  const opt = pricing.get('option')
  if (!svc) throw new Error('接客種別の料金設定が見つかりません')
  if (!opt) throw new Error('オプション料金設定が見つかりません')

  const names = payload.customerNames.map((s) => String(s || '').trim()).filter(Boolean)
  const numCust = Math.max(1, names.length)
  const joined = names.join(', ')
  const now = new Date()
  const ended = new Date(now.getTime() + 30 * 60 * 1000 * slots)

  const { data: inserted, error: insErr } = await supabase
    .from('sessions')
    .insert({
      cast_id: cId,
      room_id: rId,
      service_type: payload.serviceType,
      customer_names: joined,
      customer_count: numCust,
      base_price: svc.price,
      option_price: opt.price,
      extend_count: slots - 1,
      option_count: 0,
      started_at: now.toISOString(),
      ended_at: ended.toISOString(),
      finished: false,
      note: payload.note || '',
      revenue: svc.price * numCust * slots,
    })
    .select(SESSION_SELECT)
    .single()
  if (insErr) throw insErr

  // 顧客来店記録も追加
  if (names.length) {
    await supabase.from('customer_visits').insert(
      names.map((nm) => ({
        session_id: inserted.id,
        cast_id: cId,
        customer_name: nm,
        visited_at: now.toISOString(),
      })),
    )
  }
  await logActivity('start', payload.castName, inserted.id, joined || null, cId)
  return sessionRowToShape(inserted as unknown as SessionRow, pricing)
}

export async function extendSession(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, customer_count, customer_names, extend_count, ended_at, revenue, finished, cast_id, cast:casts(name)')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')

  const newEnd = new Date(new Date(cur.ended_at).getTime() + 30 * 60 * 1000).toISOString()
  const addRev = Number(cur.base_price) * Number(cur.customer_count)
  const { data, error } = await supabase
    .from('sessions')
    .update({
      extend_count: Number(cur.extend_count) + 1,
      ended_at: newEnd,
      revenue: Number(cur.revenue) + addRev,
    })
    .eq('id', sessionId)
    .select(SESSION_SELECT)
    .single()
  if (error) throw error
  const castName = (cur.cast as { name?: string } | null)?.name || ''
  await logActivity('extend', castName, sessionId, cur.customer_names || null, cur.cast_id)
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

export async function addOption(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, option_price, option_count, revenue, finished, customer_names, cast_id, cast:casts(name)')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')

  const { data, error } = await supabase
    .from('sessions')
    .update({
      option_count: Number(cur.option_count) + 1,
      revenue: Number(cur.revenue) + Number(cur.option_price),
    })
    .eq('id', sessionId)
    .select(SESSION_SELECT)
    .single()
  if (error) throw error
  const castName = (cur.cast as { name?: string } | null)?.name || ''
  await logActivity('option', castName, sessionId, cur.customer_names || null, cur.cast_id)
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

// 延長を1回取り消す（終了予定を30分前倒し、収益再計算）。延長回数0なら何もしない
export async function reduceExtend(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, option_price, customer_count, extend_count, option_count, ended_at, finished, customer_names, cast_id, cast:casts(name)')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')
  if (Number(cur.extend_count) <= 0) throw new Error('延長回数は0です')

  const newExtend = Number(cur.extend_count) - 1
  const newEnd = new Date(new Date(cur.ended_at).getTime() - 30 * 60 * 1000).toISOString()
  // 収益再計算: base × 顧客数 × (1+延長回数) + opt × オプション回数
  const revenue =
    Number(cur.base_price) * Number(cur.customer_count) * (1 + newExtend) +
    Number(cur.option_price) * Number(cur.option_count)
  const { data, error } = await supabase
    .from('sessions')
    .update({ extend_count: newExtend, ended_at: newEnd, revenue })
    .eq('id', sessionId)
    .select(SESSION_SELECT)
    .single()
  if (error) throw error
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

// オプションを1回取り消す（収益再計算）。オプション回数0なら何もしない
export async function reduceOption(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, option_price, customer_count, extend_count, option_count, finished')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')
  if (Number(cur.option_count) <= 0) throw new Error('オプション回数は0です')

  const newOpt = Number(cur.option_count) - 1
  const revenue =
    Number(cur.base_price) * Number(cur.customer_count) * (1 + Number(cur.extend_count)) +
    Number(cur.option_price) * newOpt
  const { data, error } = await supabase
    .from('sessions')
    .update({ option_count: newOpt, revenue })
    .eq('id', sessionId)
    .select(SESSION_SELECT)
    .single()
  if (error) throw error
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

export async function finishSession(payload: {
  sessionId: string
  note?: string
}): Promise<{ breakdown: FinishBreakdown }> {
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, option_price, extend_count, option_count, customer_count, revenue, finished, customer_names, cast_id, cast:casts(name)')
    .eq('id', payload.sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')

  const updates: Record<string, unknown> = { finished: true }
  if (payload.note !== undefined) updates.note = payload.note
  const { error } = await supabase.from('sessions').update(updates).eq('id', payload.sessionId)
  if (error) throw error

  const castName = (cur.cast as { name?: string } | null)?.name || ''
  await logActivity('end', castName, payload.sessionId, cur.customer_names || null, cur.cast_id)

  const basePrice = Number(cur.base_price)
  const optPrice = Number(cur.option_price)
  const extCount = Number(cur.extend_count)
  const optCount = Number(cur.option_count)
  return {
    breakdown: {
      total: Number(cur.revenue),
      basePrice,
      extendPrice: basePrice * extCount,
      extendCount: extCount,
      optionPrice: optPrice * optCount,
      optionCount: optCount,
    },
  }
}

// ============================================================
// API: 予約 CRUD
// ============================================================

export async function addReservation(payload: {
  castName: string
  customerName?: string
  datetime: string
  room?: string
  note?: string
  reservationType: '事前' | '当日'
  reservationPrice?: number
  durationMin?: number
}): Promise<ReservationShape> {
  const cId = await castIdByName(payload.castName)
  const rId = payload.room ? await roomIdByName(payload.room) : null
  const { data, error } = await supabase
    .from('reservations')
    .insert({
      cast_id: cId,
      customer_name: payload.customerName || '',
      reservation_type: payload.reservationType === '当日' ? 'sameday' : 'advance',
      reservation_price: Number(payload.reservationPrice) || 0,
      duration_min: Math.max(30, Number(payload.durationMin) || 60),
      reserved_at: new Date(payload.datetime).toISOString(),
      room_id: rId,
      note: payload.note || '',
    })
    .select('id, customer_name, reservation_type, reservation_price, duration_min, reserved_at, note, created_at, updated_at, cast:casts(name), room:rooms(name)')
    .single()
  if (error) throw error
  return {
    reservation_id: data.id,
    キャスト名: (data.cast as { name?: string } | null)?.name || '',
    顧客名: data.customer_name,
    予約種別: data.reservation_type === 'sameday' ? '当日' : '事前',
    予約金額: Number(data.reservation_price),
    予約時間: Number(data.duration_min) || 60,
    予約日時: data.reserved_at,
    ルーム: (data.room as { name?: string } | null)?.name || '',
    備考: data.note,
    作成日時: data.created_at,
    更新日時: data.updated_at,
  }
}

export async function updateReservation(payload: {
  reservationId: string
  castName?: string
  customerName?: string
  datetime?: string
  room?: string
  note?: string
  reservationType?: '事前' | '当日'
  reservationPrice?: number
  durationMin?: number
}): Promise<void> {
  const updates: Record<string, unknown> = {}
  if (payload.castName !== undefined) updates.cast_id = await castIdByName(payload.castName)
  if (payload.customerName !== undefined) updates.customer_name = payload.customerName
  if (payload.datetime !== undefined) updates.reserved_at = new Date(payload.datetime).toISOString()
  if (payload.room !== undefined) updates.room_id = payload.room ? await roomIdByName(payload.room) : null
  if (payload.note !== undefined) updates.note = payload.note
  if (payload.reservationType !== undefined) {
    updates.reservation_type = payload.reservationType === '当日' ? 'sameday' : 'advance'
  }
  if (payload.reservationPrice !== undefined) updates.reservation_price = Number(payload.reservationPrice) || 0
  if (payload.durationMin !== undefined) updates.duration_min = Math.max(30, Number(payload.durationMin) || 60)
  const { error } = await supabase.from('reservations').update(updates).eq('id', payload.reservationId)
  if (error) throw error
}

export async function deleteReservation(reservationId: string): Promise<void> {
  const { error } = await supabase.from('reservations').delete().eq('id', reservationId)
  if (error) throw error
}

// ============================================================
// API: ブラックリスト
// ============================================================

export async function addToBlacklist(payload: {
  name: string
  reason?: string
  note?: string
}): Promise<void> {
  const { error } = await supabase
    .from('blacklist')
    .upsert({
      name: payload.name,
      reason: payload.reason || '',
      note: payload.note || '',
      active: true,
    }, { onConflict: 'name' })
  if (error) throw error
}

export async function removeFromBlacklist(name: string): Promise<void> {
  const { error } = await supabase.from('blacklist').delete().eq('name', name)
  if (error) throw error
}

// ============================================================
// API: 売上集計
// ============================================================

// 営業日 (JST 4:00 開始) を計算
function getBusinessDayStart(): Date {
  const JST_OFFSET = 9 * 60 * 60 * 1000
  const now = Date.now()
  const jst = new Date(now + JST_OFFSET)
  const day = jst.getUTCDate()
  const month = jst.getUTCMonth()
  const year = jst.getUTCFullYear()
  const hours = jst.getUTCHours()
  // JST 4:00 以前なら前日扱い
  const targetDay = hours < 4 ? day - 1 : day
  return new Date(Date.UTC(year, month, targetDay, 4) - JST_OFFSET)
}

function getBusinessDayLabel(busStart: Date): string {
  const JST_OFFSET = 9 * 60 * 60 * 1000
  const jst = new Date(busStart.getTime() + JST_OFFSET)
  return `${jst.getUTCFullYear()}/${String(jst.getUTCMonth() + 1).padStart(2, '0')}/${String(jst.getUTCDate()).padStart(2, '0')} 営業日`
}

export async function getRevenueStatus(): Promise<RevenueStatus> {
  const GUARANTEE = 500000
  const busStart = getBusinessDayStart()
  const { data, error } = await supabase
    .from('sessions')
    .select('base_price, option_price, extend_count, option_count, customer_count, cast:casts(name)')
    .eq('finished', true)
    .gte('created_at', busStart.toISOString())
  if (error) throw error

  const castMap = new Map<string, { baseTotal: number; optTotal: number }>()
  for (const r of data || []) {
    const cast = (r.cast as { name?: string } | null)?.name
    if (!cast) continue
    if (!castMap.has(cast)) castMap.set(cast, { baseTotal: 0, optTotal: 0 })
    const m = castMap.get(cast)!
    const base = Number(r.base_price) || 0
    const optPr = Number(r.option_price) || 0
    const ext = Number(r.extend_count) || 0
    const optCnt = Number(r.option_count) || 0
    const nCust = Math.max(1, Number(r.customer_count) || 1)
    m.baseTotal += base * nCust * (1 + ext)
    m.optTotal += optPr * optCnt
  }

  const casts: CastRevenue[] = [...castMap.entries()].map(([name, d]) => {
    const revenue = d.baseTotal + d.optTotal
    const salary = GUARANTEE + d.baseTotal * 0.5 + d.optTotal
    return {
      cast: name,
      guarantee: GUARANTEE,
      baseTotal: d.baseTotal,
      optTotal: d.optTotal,
      revenue,
      salary,
      cashFlow: revenue - salary,
    }
  }).sort((a, b) => a.cast.localeCompare(b.cast, 'ja'))

  const totals = casts.reduce(
    (acc, c) => {
      acc.revenue += c.revenue
      acc.salary += c.salary
      acc.cashFlow += c.cashFlow
      return acc
    },
    { revenue: 0, salary: 0, cashFlow: 0 },
  )

  return {
    casts,
    totals,
    businessDay: getBusinessDayLabel(busStart),
    busStart: busStart.toISOString(),
  }
}

// ============================================================
// API: キャスト⇔ユーザー紐付け
// ============================================================

// 現在ログイン中のユーザーに紐付いているキャスト情報を取得（紐付なしなら null）
export interface MyCastInfo {
  name: string
  is_admin: boolean
}

export async function getMyCast(): Promise<MyCastInfo | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('casts')
    .select('name, is_admin')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return { name: data.name, is_admin: !!data.is_admin }
}

// キャスト名 + 招待コードで自分のキャストを確定 (one-time use)
// 戻り値: 紐付け成功時の MyCastInfo。失敗時は Error throw (UI で単一エラー文言を表示)
export async function bindMyCast(castName: string, inviteCode: string): Promise<MyCastInfo> {
  const { data, error } = await supabase.rpc('bind_my_cast', {
    p_name: castName,
    p_code: inviteCode,
  })
  if (error) throw error
  const r = data as { ok: boolean; name?: string; is_admin?: boolean; error?: string }
  if (!r?.ok) {
    throw new Error(r?.error || 'キャスト名または招待コードが正しくありません')
  }
  invalidateCaches()
  return { name: r.name!, is_admin: !!r.is_admin }
}

// admin: 未紐付キャストの招待コード再発行
export async function regenerateInviteCode(castId: string): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code', { p_cast_id: castId })
  if (error) throw error
  invalidateCaches()
  return data as string
}

// admin: キャストの紐付け解除 + 新コード発行 (1tx)
export async function adminUnbindCast(castId: string): Promise<string> {
  const { data, error } = await supabase.rpc('admin_unbind_cast', { p_cast_id: castId })
  if (error) throw error
  invalidateCaches()
  return data as string
}

// ============================================================
// API: ユーザー設定
// ============================================================

export async function getUserSettings(): Promise<{ theme?: string }> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return {}
  const { data, error } = await supabase
    .from('user_settings')
    .select('theme')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data || {}
}

export async function saveUserSettings(settings: { theme?: string }): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  const { error } = await supabase
    .from('user_settings')
    .upsert({ user_id: user.id, theme: settings.theme || 'dark' }, { onConflict: 'user_id' })
  if (error) throw error
}

// ============================================================
// 共通: キャッシュ無効化
// ============================================================

export function clearCache() {
  invalidateCaches()
}

// ============================================================
// カンパニーチェスト (カンチェ)
// ============================================================

export interface ChestLog {
  log_id: string
  キャスト名: string
  金額: number
  メモ: string
  作成日時: string
}

export interface ChestSummary {
  total: number
  logs: ChestLog[]
}

export async function getCompanyChest(): Promise<ChestSummary> {
  const { data, error } = await supabase
    .from('company_chest')
    .select('id, amount, memo, created_at, cast:casts(name)')
    .order('created_at', { ascending: false })
  if (error) throw error
  const list = (data || []).map((r) => ({
    log_id: r.id,
    キャスト名: (r.cast as { name?: string } | null)?.name || '',
    金額: Number(r.amount),
    メモ: r.memo || '',
    作成日時: r.created_at,
  }))
  const total = list.reduce((sum, l) => sum + l.金額, 0)
  return { total, logs: list.slice(0, 50) }
}

export async function addChestEntry(payload: { amount: number; memo?: string }): Promise<void> {
  if (!payload.amount || payload.amount === 0) throw new Error('金額を入力してください')
  const me = await getMyCast()
  if (!me) throw new Error('紐付けされたキャストが見つかりません')
  const cId = await castIdByName(me.name)
  const { error } = await supabase.from('company_chest').insert({
    cast_id: cId,
    amount: payload.amount,
    memo: payload.memo || '',
  })
  if (error) throw error
}

export async function updateChestEntry(logId: string, fields: Partial<{ amount: number; memo: string }>): Promise<void> {
  const { error } = await supabase.from('company_chest').update(fields).eq('id', logId)
  if (error) throw error
}

export async function deleteChestEntry(logId: string): Promise<void> {
  const { error } = await supabase.from('company_chest').delete().eq('id', logId)
  if (error) throw error
}

// ============================================================
// 経費 (予算)
// ============================================================

export interface ExpenseRow {
  expense_id: string
  日付: string
  金額: number
  カテゴリ: string
  メモ: string
  作成日時: string
}

export async function getExpenses(): Promise<ExpenseRow[]> {
  const { data, error } = await supabase
    .from('expenses')
    .select('id, date, amount, category, memo, created_at')
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => ({
    expense_id: r.id,
    日付: r.date,
    金額: Number(r.amount),
    カテゴリ: r.category || 'その他',
    メモ: r.memo || '',
    作成日時: r.created_at,
  }))
}

export async function addExpense(payload: { date: string; amount: number; category?: string; memo?: string }): Promise<void> {
  if (!payload.date) throw new Error('日付が必要です')
  if (!payload.amount || payload.amount === 0) throw new Error('金額を入力してください')
  const { error } = await supabase.from('expenses').insert({
    date: payload.date,
    amount: payload.amount,
    category: payload.category || 'その他',
    memo: payload.memo || '',
  })
  if (error) throw error
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId)
  if (error) throw error
}

// ============================================================
// インサイト（管理画面用、クライアント側で集計）
// ============================================================

export interface WeeklyInsight {
  weekKey: string         // 例: "2026/05/19" (月曜)
  weekLabel: string       // 例: "5/19週"
  revenue: number
  salary: number
  cashFlow: number
  sessionCount: number
  hasUncollected: boolean
}

export interface HourDistribution {
  hour: number            // 0-23
  count: number
}

export interface ServiceBreakdown {
  key: string             // 'normal' or 'vip'
  label: string
  count: number
  revenue: number
  percent: number         // 全体に対する %
}

export interface RoomBreakdown {
  name: string
  count: number
  revenue: number
}

export interface RetentionStats {
  totalCustomers: number  // ユニーク顧客数
  newCustomers: number    // 1回のみの顧客数
  repeatCustomers: number // 2回以上の顧客数
  newRatio: number        // 0-1
  repeatRatio: number
  avgVisits: number       // 顧客あたり平均来店回数
}

export interface InsightsData {
  weekly: WeeklyInsight[]
  hourly: HourDistribution[]
  serviceBreakdown: ServiceBreakdown[]
  topRooms: RoomBreakdown[]
  retention: RetentionStats
}

// 週キー（月曜0時 JST）
function getWeekKeyFromIso(iso: string): { key: string; label: string } | null {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  const JST = 9 * 3600000
  const jst = new Date(d.getTime() + JST)
  const dow = jst.getUTCDay()
  const diff = dow === 0 ? -6 : 1 - dow
  const mon = new Date(jst)
  mon.setUTCDate(jst.getUTCDate() + diff)
  const mo = mon.getUTCMonth() + 1
  const day = mon.getUTCDate()
  return {
    key: `${mon.getUTCFullYear()}/${String(mo).padStart(2, '0')}/${String(day).padStart(2, '0')}`,
    label: `${mo}/${day}週`,
  }
}

export async function getInsights(): Promise<InsightsData> {
  const pricing = await loadPricing()

  // 完了済セッションを取得
  const { data, error } = await supabase
    .from('sessions')
    .select('service_type, base_price, option_price, extend_count, option_count, customer_count, revenue, started_at, created_at, room:rooms(name), customer_names')
    .eq('finished', true)
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw error

  const rows = data || []

  // ====== 週次集計 ======
  const GUARANTEE = 500000
  const weekMap = new Map<string, WeeklyInsight>()
  for (const r of rows) {
    const wk = getWeekKeyFromIso(r.created_at)
    if (!wk) continue
    let w = weekMap.get(wk.key)
    if (!w) {
      w = {
        weekKey: wk.key,
        weekLabel: wk.label,
        revenue: 0,
        salary: 0,
        cashFlow: 0,
        sessionCount: 0,
        hasUncollected: false,
      }
      weekMap.set(wk.key, w)
    }
    const revenue = Number(r.revenue) || 0
    const base = Number(r.base_price) || 0
    const ext = Number(r.extend_count) || 0
    const optPrice = Number(r.option_price) || 0
    const optCnt = Number(r.option_count) || 0
    const numCust = Math.max(1, Number(r.customer_count) || 1)
    const baseTotal = base * numCust * (1 + ext)
    const optTotal = optPrice * optCnt
    const salary = GUARANTEE + baseTotal * 0.5 + optTotal
    w.revenue += revenue
    w.salary += salary
    w.cashFlow += revenue - salary
    w.sessionCount += 1
  }
  const weekly = [...weekMap.values()].sort((a, b) => (a.weekKey < b.weekKey ? -1 : 1)).slice(-12)

  // ====== 時間帯分布 ======
  const hourMap = new Map<number, number>()
  for (let h = 0; h < 24; h++) hourMap.set(h, 0)
  for (const r of rows) {
    const d = new Date(r.started_at)
    if (isNaN(d.getTime())) continue
    const JST = 9 * 3600000
    const jst = new Date(d.getTime() + JST)
    const h = jst.getUTCHours()
    hourMap.set(h, (hourMap.get(h) || 0) + 1)
  }
  const hourly: HourDistribution[] = [...hourMap.entries()].map(([hour, count]) => ({ hour, count }))

  // ====== 接客種別の比率 ======
  const serviceMap = new Map<string, { count: number; revenue: number }>()
  for (const r of rows) {
    const key = r.service_type
    let s = serviceMap.get(key)
    if (!s) {
      s = { count: 0, revenue: 0 }
      serviceMap.set(key, s)
    }
    s.count += 1
    s.revenue += Number(r.revenue) || 0
  }
  const totalRevenue = [...serviceMap.values()].reduce((sum, s) => sum + s.revenue, 0)
  const serviceBreakdown: ServiceBreakdown[] = [...serviceMap.entries()].map(([key, s]) => {
    const pr = pricing.get(key)
    return {
      key,
      label: pr?.label || key,
      count: s.count,
      revenue: s.revenue,
      percent: totalRevenue > 0 ? s.revenue / totalRevenue : 0,
    }
  }).sort((a, b) => b.revenue - a.revenue)

  // ====== 人気ルーム ======
  const roomMap = new Map<string, { count: number; revenue: number }>()
  for (const r of rows) {
    const name = (r.room as { name?: string } | null)?.name || '(ルーム未指定)'
    let rb = roomMap.get(name)
    if (!rb) {
      rb = { count: 0, revenue: 0 }
      roomMap.set(name, rb)
    }
    rb.count += 1
    rb.revenue += Number(r.revenue) || 0
  }
  const topRooms: RoomBreakdown[] = [...roomMap.entries()]
    .map(([name, v]) => ({ name, count: v.count, revenue: v.revenue }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)

  // ====== リピート率 ======
  // customer_visits からユニーク顧客数と来店回数を取得
  const { data: visits, error: vErr } = await supabase
    .from('customer_visits')
    .select('customer_name')
  if (vErr) throw vErr

  const visitMap = new Map<string, number>()
  for (const v of visits || []) {
    const name = (v.customer_name || '').trim()
    if (!name) continue
    visitMap.set(name, (visitMap.get(name) || 0) + 1)
  }
  const totalCustomers = visitMap.size
  let newCustomers = 0
  let repeatCustomers = 0
  let visitsSum = 0
  for (const cnt of visitMap.values()) {
    if (cnt === 1) newCustomers += 1
    else repeatCustomers += 1
    visitsSum += cnt
  }
  const retention: RetentionStats = {
    totalCustomers,
    newCustomers,
    repeatCustomers,
    newRatio: totalCustomers > 0 ? newCustomers / totalCustomers : 0,
    repeatRatio: totalCustomers > 0 ? repeatCustomers / totalCustomers : 0,
    avgVisits: totalCustomers > 0 ? visitsSum / totalCustomers : 0,
  }

  return { weekly, hourly, serviceBreakdown, topRooms, retention }
}

// ============================================================
// 管理画面用 CRUD
// ============================================================

export interface CastAdminRow {
  id: string
  name: string
  user_id: string | null
  user_email: string | null  // join で取得（auth.users から）
  is_admin: boolean
  active: boolean
  note: string
  invite_code: string | null  // 未紐付キャストのみ値あり、紐付け済は NULL
}

export async function listAllCasts(): Promise<CastAdminRow[]> {
  const { data, error } = await supabase
    .from('casts')
    .select('id, name, user_id, is_admin, active, note, invite_code')
    .order('active', { ascending: false })
    .order('name')
  if (error) throw error
  // auth.usersのemailは権限上ここでは取れない（admin APIが必要）。user_idがあるかどうかだけ表示
  return (data || []).map((c) => ({
    id: c.id,
    name: c.name,
    user_id: c.user_id,
    user_email: null,
    is_admin: !!c.is_admin,
    active: !!c.active,
    note: c.note || '',
    invite_code: c.invite_code ?? null,
  }))
}

export async function addCast(payload: { name: string; is_admin?: boolean; active?: boolean; note?: string }): Promise<void> {
  const { error } = await supabase.from('casts').insert({
    name: payload.name,
    is_admin: !!payload.is_admin,
    active: payload.active !== false,
    note: payload.note || '',
  })
  if (error) throw error
  invalidateCaches()
}

export async function updateCast(id: string, fields: Partial<{ name: string; is_admin: boolean; active: boolean; note: string; user_id: string | null }>): Promise<void> {
  const { error } = await supabase.from('casts').update(fields).eq('id', id)
  if (error) throw error
  invalidateCaches()
}

export interface RoomAdminRow {
  id: string
  name: string
  vip: boolean
  active: boolean
  note: string
}

export async function listAllRooms(): Promise<RoomAdminRow[]> {
  const { data, error } = await supabase
    .from('rooms')
    .select('id, name, vip, active, note')
    .order('active', { ascending: false })
    .order('name')
  if (error) throw error
  return (data || []).map((r) => ({
    id: r.id,
    name: r.name,
    vip: !!r.vip,
    active: !!r.active,
    note: r.note || '',
  }))
}

export async function addRoom(payload: { name: string; vip?: boolean; active?: boolean; note?: string }): Promise<void> {
  const { error } = await supabase.from('rooms').insert({
    name: payload.name,
    vip: !!payload.vip,
    active: payload.active !== false,
    note: payload.note || '',
  })
  if (error) throw error
  invalidateCaches()
}

export async function updateRoom(id: string, fields: Partial<{ name: string; vip: boolean; active: boolean; note: string }>): Promise<void> {
  const { error } = await supabase.from('rooms').update(fields).eq('id', id)
  if (error) throw error
  invalidateCaches()
}

export async function updatePricing(key: string, fields: Partial<{ label: string; price: number; active: boolean; note: string }>): Promise<void> {
  const { error } = await supabase.from('pricing').update(fields).eq('key', key)
  if (error) throw error
  invalidateCaches()
}

// 進行中の全セッション一覧（管理者用）
export async function listAllActiveSessions(): Promise<SessionShape[]> {
  const pricing = await loadPricing()
  const { data, error } = await supabase
    .from('sessions')
    .select(SESSION_SELECT)
    .eq('finished', false)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data || []).map((r) => sessionRowToShape(r as unknown as SessionRow, pricing))
}

// 強制終了（破棄ではなく完了マーク）
export async function forceEndSession(sessionId: string): Promise<void> {
  const { error } = await supabase
    .from('sessions')
    .update({ finished: true })
    .eq('id', sessionId)
  if (error) throw error
}

// 完了セッションの編集 — 全項目対応で収益自動再計算
//
// 注意:
//   - service_type を変更すると base_price と option_price も
//     新しい単価のスナップショットに置き換わる（履歴の整合性のため）
//   - customer_names を変更すると customer_count も自動更新
//   - revenue は base_price × customer_count × (1+extend_count) + option_price × option_count で再計算
export async function updateHistorySession(
  sessionId: string,
  fields: Partial<{
    cast_name: string
    room_name: string | null  // null/'' でルーム解除
    service_type: string
    customer_names: string
    extend_count: number
    option_count: number
    note: string
  }>,
): Promise<SessionShape> {
  const pricing = await loadPricing()
  // 現在の値を取得
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('cast_id, room_id, service_type, base_price, option_price, customer_count, customer_names, extend_count, option_count')
    .eq('id', sessionId)
    .single()
  if (e1) throw e1

  const updates: Record<string, unknown> = {}

  // キャスト変更
  if (fields.cast_name !== undefined) {
    updates.cast_id = await castIdByName(fields.cast_name)
  }
  // ルーム変更（null/空文字で解除）
  if (fields.room_name !== undefined) {
    updates.room_id = fields.room_name ? await roomIdByName(fields.room_name) : null
  }
  // 接客種別変更 → 単価スナップショットも更新
  let newBasePrice = Number(cur.base_price)
  let newOptPrice = Number(cur.option_price)
  if (fields.service_type !== undefined && fields.service_type !== cur.service_type) {
    const svc = pricing.get(fields.service_type)
    if (!svc) throw new Error(`接客種別が無効です: ${fields.service_type}`)
    const opt = pricing.get('option')
    if (!opt) throw new Error('オプション料金が見つかりません')
    updates.service_type = fields.service_type
    updates.base_price = svc.price
    updates.option_price = opt.price
    newBasePrice = svc.price
    newOptPrice = opt.price
  }
  // 顧客名 → 顧客数も再計算
  let newCustCount = Number(cur.customer_count) || 1
  if (fields.customer_names !== undefined) {
    updates.customer_names = fields.customer_names
    const names = fields.customer_names.split(/[,、]/).map((s) => s.trim()).filter(Boolean)
    newCustCount = Math.max(1, names.length)
    updates.customer_count = newCustCount
  }
  // 延長/オプション回数
  const newExt = fields.extend_count !== undefined ? Math.max(0, fields.extend_count) : Number(cur.extend_count) || 0
  const newOptCnt = fields.option_count !== undefined ? Math.max(0, fields.option_count) : Number(cur.option_count) || 0
  if (fields.extend_count !== undefined) updates.extend_count = newExt
  if (fields.option_count !== undefined) updates.option_count = newOptCnt
  // 備考
  if (fields.note !== undefined) updates.note = fields.note

  // 収益再計算: base × 顧客数 × (1+延長回数) + opt × オプション回数
  updates.revenue = newBasePrice * newCustCount * (1 + newExt) + newOptPrice * newOptCnt

  const { data, error } = await supabase
    .from('sessions')
    .update(updates)
    .eq('id', sessionId)
    .select(SESSION_SELECT)
    .single()
  if (error) throw error
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const { error } = await supabase.from('sessions').delete().eq('id', sessionId)
  if (error) throw error
}

// ============================================================
// 顧客メモ (customer_notes テーブル)
// ============================================================

export async function getAllCustomerNotes(): Promise<Map<string, string>> {
  const { data, error } = await supabase
    .from('customer_notes')
    .select('customer_name, memo')
  if (error) throw error
  return new Map((data || []).map((r) => [r.customer_name, r.memo]))
}

export async function saveCustomerNote(customerName: string, memo: string): Promise<void> {
  if (!customerName) throw new Error('顧客名が必要です')
  const { error } = await supabase
    .from('customer_notes')
    .upsert(
      { customer_name: customerName, memo, updated_at: new Date().toISOString() },
      { onConflict: 'customer_name' },
    )
  if (error) throw error
}

// 顧客リストから該当顧客の全来店記録 + メモを削除。
// sessions は残るので売上集計や履歴には影響しない（あくまで顧客一覧の見た目をクリーンアップする操作）。
export async function deleteCustomerVisits(customerName: string): Promise<void> {
  if (!customerName) throw new Error('顧客名が必要です')
  const { error: visitsErr } = await supabase
    .from('customer_visits')
    .delete()
    .eq('customer_name', customerName)
  if (visitsErr) throw visitsErr
  const { error: notesErr } = await supabase
    .from('customer_notes')
    .delete()
    .eq('customer_name', customerName)
  if (notesErr) throw notesErr
}

// ============================================================
// AkariApi 互換のディスパッチャ — 既存タブの最小変更で移行
// ============================================================

export type DbResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const _dispatch: Record<string, (...args: any[]) => Promise<unknown>> = {
  getActiveSession,
  getCastsAndRooms,
  getPricing,
  getCustomers,
  getBlacklist,
  getReservations,
  getHistory,
  getRevenueStatus,
  getUserSettings,
  checkRoomAvailability,
  checkBlacklist,
  startSession,
  extendSession,
  addOption,
  reduceExtend,
  reduceOption,
  finishSession,
  addReservation,
  updateReservation,
  deleteReservation,
  addToBlacklist,
  removeFromBlacklist,
  saveUserSettings,
  // カンチェ / 経費 / インサイト
  getCompanyChest,
  addChestEntry,
  updateChestEntry,
  deleteChestEntry,
  getExpenses,
  addExpense,
  deleteExpense,
  getInsights,
  // 顧客メモ
  getAllCustomerNotes,
  saveCustomerNote,
  deleteCustomerVisits,
  // アクティビティログ
  getActivityLogs,
}

async function dbCall<T = unknown>(fn: string, ...args: unknown[]): Promise<DbResult<T>> {
  const f = _dispatch[fn]
  if (!f) return { ok: false, error: `function not allowed: ${fn}` }
  try {
    const data = await f(...args)
    return { ok: true, data: data as T }
  } catch (e) {
    const err = e as Error
    return { ok: false, error: err.message || String(e) }
  }
}

// 既存タブ互換: api.call() と同じ形のシングルトン
export const db = {
  call: dbCall,
}

// ============================================================
// API: 管理ホーム用の軽量集計
// ============================================================

export interface AdminHomeStats {
  activeCount: number    // 進行中セッション数
  todayCount: number     // 今日完了したセッション数
  monthCount: number     // 今月完了したセッション数
  monthRevenue: number   // 今月完了セッションの売上合計
}

// 1ヶ月分の sessions (finished=true) だけを取得して今日 / 今月で派生集計。
// + 進行中 (finished=false) は count のみ取得 (head)。
export async function fetchAdminHomeStats(): Promise<AdminHomeStats> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const [activeRes, monthRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .eq('finished', false),
    supabase
      .from('sessions')
      .select('created_at, revenue')
      .eq('finished', true)
      .gte('created_at', monthStart),
  ])

  if (activeRes.error) throw activeRes.error
  if (monthRes.error) throw monthRes.error

  const rows = monthRes.data || []
  let todayCount = 0
  let monthRevenue = 0
  for (const r of rows) {
    monthRevenue += Number(r.revenue || 0)
    if (r.created_at >= todayStart) todayCount += 1
  }

  return {
    activeCount: activeRes.count || 0,
    todayCount,
    monthCount: rows.length,
    monthRevenue,
  }
}

