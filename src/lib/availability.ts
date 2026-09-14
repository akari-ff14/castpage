// 「このキャストは次に何時から受けられるか」の数え方。
//
// 受付ボードと予約タブの両方で同じ答えを出したいので、計算はここに1つだけ置く。
// 塞がっている時間として見るのは:
//   ・勤務時間帯（出勤前は受けない。勤務の終わりを過ぎたら「本日終了」）
//   ・対応中の接客（終了予定 ＋ 片付けのインターバル）
//   ・まだ接客に変わっていない予約（開始〜終了 ＋ インターバル）
//   ・受付日で止めた枠（休憩。1組ぶん = 60分 ＋ インターバル）
// 今から順にたどって、最初に空く時刻を答える。

import type { CastShift } from './shift'

// 接客と接客のあいだに置く片付けの時間
export const INTERVAL_MIN = 10
// 止めた枠は「1組ぶん」埋まる。公開予約ページと同じ 60分＋インターバル で数える
export const SLOT_HOLD_MIN = 70

// 塞がっている区間。label は「なぜ受けられないか」の説明
export interface AvailBlock {
  start: number
  end: number
  label: string
}

// 受付日で止めた枠を実時刻に直したもの
export interface BreakSpan {
  slotNo: number
  startMs: number
  endMs: number
}

// 計算に要るぶんだけの形。受付ボードの SessionShape / ReservationShape も、
// 予約タブの Reservation もこの形を満たす
interface ActiveLike {
  対応者: string
  顧客名: string
  対応終了時間: string
}

interface ReservationLike {
  キャスト名: string
  顧客名: string
  予約日時: string
  予約時間: number
  converted: boolean
}

interface DayLike {
  slotTimes: string[]
  blocks: Array<{ castId: string; slotNo: number }>
}

export interface CastAvailability {
  shift: CastShift | null    // 今日の勤務時間帯。null なら制限なし
  shiftEndMs: number         // 勤務の終わり。制限なしなら NaN
  availMs: number            // 次に受けられる時刻
  busyNow: boolean           // 今は受けられない
  ended: boolean             // 勤務が終わっていて、今日はもう受けられない
  blockedBy: string          // 今受けられない理由
  breaks: BreakSpan[]        // 受付日で止めた枠（表示用）
}

// 受付日の枠時刻（"23:20"）を、その営業日の実時刻に直す。
// 4時より前は翌日にまたぐ、という区切りは DB の slot_start_at と揃えてある
export function slotStartMs(businessDate: string, hhmm: string): number {
  const [y, m, d] = businessDate.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return NaN
  return Date.UTC(y, m - 1, d + (hh < 4 ? 1 : 0), hh, mm) - 9 * 60 * 60 * 1000
}

export function castAvailabilityAt(params: {
  now: number
  businessDate: string
  castId: string
  castName: string
  shift: CastShift | null
  activeSessions: ActiveLike[]
  reservations: ReservationLike[]   // その日の予約。キャンセル・却下は呼ぶ側で落としておく
  day: DayLike | null
}): CastAvailability {
  const { now, businessDate, castId, castName, shift, activeSessions, reservations, day } = params
  const INTERVAL_MS = INTERVAL_MIN * 60 * 1000
  const blocks: AvailBlock[] = []

  // 勤務時間帯。出勤前は受けられない（勤務の終わりは最後に見る）
  const shiftStartMs = shift ? slotStartMs(businessDate, shift.from) : NaN
  const shiftEndMs = shift ? slotStartMs(businessDate, shift.until) : NaN
  if (!isNaN(shiftStartMs) && shiftStartMs > now) {
    blocks.push({ start: 0, end: shiftStartMs, label: '出勤前' })
  }

  // 対応中は、終わる予定＋片付けまで塞がっている
  const active = activeSessions.find((s) => s.対応者 === castName)
  if (active) {
    const end = new Date(active.対応終了時間).getTime()
    if (!isNaN(end)) {
      blocks.push({
        start: 0,
        end: end + INTERVAL_MS,
        label: `対応中${active.顧客名 ? `（${active.顧客名}様）` : ''}`,
      })
    }
  }

  for (const r of reservations) {
    if (r.キャスト名 !== castName) continue
    if (r.converted) continue                          // すでに接客に変わったぶんは対応中が拾う
    const start = new Date(r.予約日時).getTime()
    if (isNaN(start)) continue
    const end = start + (r.予約時間 || 60) * 60 * 1000 + INTERVAL_MS
    if (end <= now) continue                           // 終わった予約は空きの判断に関係ない
    blocks.push({ start, end, label: `予約${r.顧客名 ? `（${r.顧客名}様）` : ''}` })
  }

  // 受付日で止めた枠 = その時間は受けない（休憩・私用など）
  const breaks: BreakSpan[] = []
  for (const b of day?.blocks ?? []) {
    if (b.castId !== castId) continue
    const hhmm = day?.slotTimes[b.slotNo - 1]
    if (!hhmm) continue
    const startMs = slotStartMs(businessDate, hhmm)
    if (isNaN(startMs)) continue
    const endMs = startMs + SLOT_HOLD_MIN * 60 * 1000
    breaks.push({ slotNo: b.slotNo, startMs, endMs })
    if (endMs > now) blocks.push({ start: startMs, end: endMs, label: '休憩（受付停止）' })
  }
  breaks.sort((a, b) => a.startMs - b.startMs)

  // 今から順に、塞がっている区間をたどって最初の空きを探す
  blocks.sort((a, b) => a.start - b.start)
  let availMs = now
  let blockedBy = ''
  for (const b of blocks) {
    if (b.start <= availMs && availMs < b.end) {
      availMs = b.end
      blockedBy = b.label
    }
  }

  return {
    shift,
    shiftEndMs,
    availMs,
    busyNow: availMs > now,
    // 次に受けられる時刻が勤務の終わりを過ぎていたら、今日はもう受けられない
    ended: !isNaN(shiftEndMs) && availMs >= shiftEndMs,
    blockedBy,
    breaks,
  }
}

// 並び順: 受けられる人が先、その中で早く空く順、同じなら名前順。勤務の終わった人は最後
export function compareAvailability(
  a: { ended: boolean; availMs: number; cast: string },
  b: { ended: boolean; availMs: number; cast: string },
): number {
  return Number(a.ended) - Number(b.ended) || a.availMs - b.availMs || a.cast.localeCompare(b.cast, 'ja')
}
