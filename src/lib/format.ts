// 共通フォーマッタ
//
// fmtCurrency: 金額を ¥123,456 形式へ
// fmtTime    : ISO日時 → HH:mm（JST）
// fmtDate    : ISO日時 → MM/DD（JST）
// fmtDateTime: ISO日時 → MM/DD HH:mm（JST）

export const fmtCurrency = (n: number | string | null | undefined): string => {
  if (n === null || n === undefined || n === '') return '—'
  const num = typeof n === 'number' ? n : Number(n)
  if (isNaN(num)) return '—'
  return '¥' + num.toLocaleString('ja-JP')
}

const _toDate = (v: string | number | Date | null | undefined): Date | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return isNaN(d.getTime()) ? null : d
}

export const fmtTime = (v: string | number | Date | null | undefined): string => {
  const d = _toDate(v)
  if (!d) return '—'
  return d.toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export const fmtDate = (v: string | number | Date | null | undefined): string => {
  const d = _toDate(v)
  if (!d) return '—'
  return d.toLocaleDateString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    timeZone: 'Asia/Tokyo',
  })
}

export const fmtDateTime = (v: string | number | Date | null | undefined): string => {
  const d = _toDate(v)
  if (!d) return '—'
  return `${fmtDate(d)} ${fmtTime(d)}`
}

// 営業時間表記: 深夜(JST 0:00〜4:59)は 24:00〜 として表示する（例 2:10 → 26:10）。
// 夜営業（21:00〜翌朝）で「何時まで／何時から」を直感的に読めるようにするための表記。
export const fmtBizTime = (v: string | number | Date | null | undefined): string => {
  const d = _toDate(v)
  if (!d) return '—'
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  let h = jst.getUTCHours()
  const m = jst.getUTCMinutes()
  if (h < 5) h += 24 // 0〜4時台は前日営業の延長として 24〜28 表記に
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

// JSTの "今日" を YYYY-MM-DD で
export const jstToday = (): string => {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return `${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`
}
