// キャストの勤務時間帯と、勤務時間から決まる待機保証の規定表。
//
// 「22時から24時までの2時間だけ入る」というキャストのために持つ。
// 時刻は 'HH:MM' の文字列で、4時より前は翌日扱い（受付日の枠時刻や DB の
// slot_start_at と同じ区切り）。24:00 は '00:00' と書き、画面では 24:00 と出す。
//
// ここは純粋な計算だけ。DB は読まないので、管理画面・受付ボード・売上のどこからでも使える。

export interface CastShift {
  from: string   // 'HH:MM'
  until: string  // 'HH:MM'。4時より前は翌日
}

// 勤務時間 → 待機保証。「3時間なら50万、2時間なら20万」の1行ぶん
export interface GuaranteeRule {
  hours: number
  amount: number
}

// 店の営業時間。勤務時間帯を決めていないキャストはこれで働くものとして扱う
export const DEFAULT_BUSINESS_HOURS: CastShift = { from: '21:00', until: '00:00' }

// 待機保証の規定表の既定（オーナーの決まり）。管理→店舗設定で変えられる
export const DEFAULT_GUARANTEE_RULES: GuaranteeRule[] = [
  { hours: 3, amount: 500000 },
  { hours: 2, amount: 200000 },
]

// 'HH:MM' → その営業日の何分目か。4時より前は 24:xx と数える（'00:00' = 1440）。
// 形が崩れていれば NaN
export function bizMinutes(hhmm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim())
  if (!m) return NaN
  const h = Number(m[1])
  const mi = Number(m[2])
  if (h > 23 || mi > 59) return NaN
  return (h < 4 ? h + 24 : h) * 60 + mi
}

// 何分目 → 'HH:MM'（4時より前は 00:xx に戻す。DB に入れる形）
export function minutesToHHMM(min: number): string {
  const h = Math.floor(min / 60) % 24
  const mi = min % 60
  return `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`
}

// 画面に出す形。'00:00' → '24:00'、'01:30' → '25:30'
export function fmtShiftTime(hhmm: string): string {
  const min = bizMinutes(hhmm)
  if (!Number.isFinite(min)) return hhmm || '—'
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

export function fmtShift(shift: CastShift | null | undefined): string {
  if (!shift) return '—'
  return `${fmtShiftTime(shift.from)}〜${fmtShiftTime(shift.until)}`
}

// 勤務時間の長さ（時間）。0.5 時間刻みの端数もそのまま返す（2.5 など）
export function shiftHours(shift: CastShift | null | undefined): number {
  if (!shift) return 0
  const a = bizMinutes(shift.from)
  const b = bizMinutes(shift.until)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return (b - a) / 60
}

// 形として成り立っているか（HH:MM で、終わりが始まりより後）
export function isValidShift(shift: CastShift | null | undefined): shift is CastShift {
  return !!shift && shiftHours(shift) > 0
}

// 「2時間」「2.5時間」
export function fmtHours(hours: number): string {
  if (!Number.isFinite(hours) || hours <= 0) return '—'
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}時間`
}

// 規定表から待機保証を引く。時間の長い行から見て、勤務時間がその行以上なら採用
// （3.5 時間なら3時間の行、1.5 時間ならどの行にも届かず 0）
export function guaranteeForHours(rules: GuaranteeRule[], hours: number): number {
  const sorted = [...rules]
    .filter((r) => Number.isFinite(r.hours) && r.hours > 0)
    .sort((a, b) => b.hours - a.hours)
  for (const r of sorted) {
    if (hours >= r.hours) return Math.max(0, Math.round(r.amount) || 0)
  }
  return 0
}

// 枠（'22:10'）がこの勤務時間帯に収まるか。30分は入れられる枠までを勤務内とする。
// DB の shift_covers_slot と同じ判定
export function shiftCoversSlot(slotTime: string, shift: CastShift | null | undefined): boolean {
  if (!shift) return true
  const s = bizMinutes(slotTime)
  const a = bizMinutes(shift.from)
  const b = bizMinutes(shift.until)
  if (!Number.isFinite(s) || !Number.isFinite(a) || !Number.isFinite(b)) return true
  return s >= a && s + 30 <= b
}

// 勤務時間帯の選択肢。18:00 から 27:50 まで10分刻み（枠の 22:10 のような時刻も選べる）。
// 28:00 以降は '04:00' になって「4時より前は翌日」の区切りと衝突するので出さない
export const SHIFT_TIME_OPTIONS: Array<{ value: string; label: string }> = (() => {
  const out: Array<{ value: string; label: string }> = []
  for (let min = 18 * 60; min < 28 * 60; min += 10) {
    out.push({ value: minutesToHHMM(min), label: fmtShiftTime(minutesToHHMM(min)) })
  }
  return out
})()

// DB の行（shift_from / shift_until）→ CastShift | null
export function shiftFromRow(from: unknown, until: unknown): CastShift | null {
  if (typeof from !== 'string' || typeof until !== 'string' || !from || !until) return null
  const s = { from, until }
  return isValidShift(s) ? s : null
}
