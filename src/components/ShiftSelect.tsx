// 勤務時間帯（何時から何時まで）の入力。
// 24:00 のような深夜の表記で選べるよう、time 入力ではなく10分刻みの選択肢にしてある
// （DB には '00:00' の形で入る。変換は shift.ts）。
// 管理→キャスト / 受付日 / 店舗設定 の3か所で同じものを使う

import { SHIFT_TIME_OPTIONS, type CastShift } from '../lib/shift'
import './ShiftSelect.css'

export default function ShiftSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  value: CastShift
  onChange: (next: CastShift) => void
  disabled?: boolean
  ariaLabel?: string
}) {
  return (
    <span className="shift-select">
      <span className="select-wrap">
        <select
          className="form-select"
          value={value.from}
          disabled={disabled}
          aria-label={`${ariaLabel ? `${ariaLabel} ` : ''}開始`}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        >
          {SHIFT_TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </span>
      <span className="shift-select-sep">〜</span>
      <span className="select-wrap">
        <select
          className="form-select"
          value={value.until}
          disabled={disabled}
          aria-label={`${ariaLabel ? `${ariaLabel} ` : ''}終了`}
          onChange={(e) => onChange({ ...value, until: e.target.value })}
        >
          {SHIFT_TIME_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </span>
    </span>
  )
}
