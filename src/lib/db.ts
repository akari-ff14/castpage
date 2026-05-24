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
  const { data, error } = await supabase
    .from('casts')
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
    .select('id, customer_name, reservation_type, reservation_price, reserved_at, note, created_at, updated_at, cast:casts(name), room:rooms(name)')
    .order('reserved_at', { ascending: true })
  if (error) throw error
  return (data || []).map((r) => ({
    reservation_id: r.id,
    キャスト名: (r.cast as { name?: string } | null)?.name || '',
    顧客名: r.customer_name,
    予約種別: r.reservation_type === 'sameday' ? '当日' : '事前',
    予約金額: Number(r.reservation_price),
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
  return sessionRowToShape(inserted as unknown as SessionRow, pricing)
}

export async function extendSession(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, customer_count, extend_count, ended_at, revenue, finished')
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
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

export async function addOption(sessionId: string): Promise<SessionShape> {
  const pricing = await loadPricing()
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, option_price, option_count, revenue, finished')
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
  return sessionRowToShape(data as unknown as SessionRow, pricing)
}

export async function finishSession(payload: {
  sessionId: string
  note?: string
}): Promise<{ breakdown: FinishBreakdown }> {
  const { data: cur, error: e1 } = await supabase
    .from('sessions')
    .select('id, base_price, option_price, extend_count, option_count, customer_count, revenue, finished')
    .eq('id', payload.sessionId)
    .single()
  if (e1) throw e1
  if (cur.finished) throw new Error('既に完了済みです')

  const updates: Record<string, unknown> = { finished: true }
  if (payload.note !== undefined) updates.note = payload.note
  const { error } = await supabase.from('sessions').update(updates).eq('id', payload.sessionId)
  if (error) throw error

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
      reserved_at: new Date(payload.datetime).toISOString(),
      room_id: rId,
      note: payload.note || '',
    })
    .select('id, customer_name, reservation_type, reservation_price, reserved_at, note, created_at, updated_at, cast:casts(name), room:rooms(name)')
    .single()
  if (error) throw error
  return {
    reservation_id: data.id,
    キャスト名: (data.cast as { name?: string } | null)?.name || '',
    顧客名: data.customer_name,
    予約種別: data.reservation_type === 'sameday' ? '当日' : '事前',
    予約金額: Number(data.reservation_price),
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

// 現在ログイン中のユーザーに紐付いているキャスト名を取得（紐付なしなら null）
export async function getMyCast(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase
    .from('casts')
    .select('name')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error) throw error
  return data?.name ?? null
}

// 未紐付のキャストに自分を紐付け（既に他の人が取ってたら失敗）
export async function bindMyCast(castName: string): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('未ログイン')
  // 自分が既に他のキャストを持っていたら一度解除
  await supabase.from('casts').update({ user_id: null }).eq('user_id', user.id)
  // user_id IS NULL の状態でしか奪えない
  const { data, error } = await supabase
    .from('casts')
    .update({ user_id: user.id })
    .eq('name', castName)
    .is('user_id', null)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new Error(`「${castName}」は既に別の方に割り当てられています`)
  }
  invalidateCaches()
}

// 自分のキャスト紐付を解除
export async function unbindMyCast(): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return
  await supabase.from('casts').update({ user_id: null }).eq('user_id', user.id)
  invalidateCaches()
}

// 未紐付のキャストだけ取得（選択画面用）
export async function getUnboundCasts(): Promise<Array<{ name: string }>> {
  const { data, error } = await supabase
    .from('casts')
    .select('name')
    .is('user_id', null)
    .eq('active', true)
    .order('name')
  if (error) throw error
  return data || []
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
  finishSession,
  addReservation,
  updateReservation,
  deleteReservation,
  addToBlacklist,
  removeFromBlacklist,
  saveUserSettings,
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

