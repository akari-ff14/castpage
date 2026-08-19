import { useCallback, useEffect, useState } from 'react'
import { fetchBookingDays, submitReservation, type BookingDay, type PublicSlot } from './api'
import './book.css'

// 受付日を探す範囲。店は先の日程まで開けることがあるので広めに取る
const FUTURE_DAYS = 120

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function jstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

function labelDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}月${d}日（${w}）`
}

function labelDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const jst = new Date(d.getTime() + 9 * 3600 * 1000)
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`
}

// 枠の終わりの時刻。開始 + 60分（24時をまたぐ日は 25:20 のように続けて書く）
function slotRange(slotTime: string): string {
  const [hh, mm] = slotTime.split(':').map(Number)
  const endH = hh + 1
  return `${slotTime} 〜 ${String(endH).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

const STATE_LABEL: Record<PublicSlot['state'], string> = {
  open: '空き',
  pending: '申込中',
  confirmed: '満席',
  closed: '—',
}

interface Picked {
  day: BookingDay
  castId: string
  castName: string
  slot: PublicSlot
}

interface Done {
  code: string
  castName: string
  businessDate: string
  slotTime: string
}

export default function BookApp() {
  const [days, setDays] = useState<BookingDay[] | null>(null)
  const [err, setErr] = useState('')
  const [picked, setPicked] = useState<Picked | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [formErr, setFormErr] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const today = jstToday()
      setDays(await fetchBookingDays(today, addDays(today, FUTURE_DAYS)))
    } catch {
      setErr('空き状況を読み込めませんでした。通信環境をご確認のうえ、もう一度お試しください。')
      setDays([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openForm(day: BookingDay, castId: string, castName: string, slot: PublicSlot) {
    setPicked({ day, castId, castName, slot })
    setFormErr('')
  }

  function closeForm() {
    if (sending) return
    setPicked(null)
    setFormErr('')
  }

  async function send() {
    if (!picked) return
    const trimmed = name.trim()
    if (!trimmed) {
      setFormErr('お名前を入力してください')
      return
    }
    setSending(true)
    setFormErr('')
    const r = await submitReservation({
      businessDate: picked.day.businessDate,
      castId: picked.castId,
      slotNo: picked.slot.slotNo,
      customerName: trimmed,
      email: email.trim() || undefined,
      note: note.trim() || undefined,
    })
    setSending(false)

    if (!r.ok) {
      setFormErr(r.error || '送信できませんでした')
      // 枠が埋まっていた場合は最新の空き状況に描き直す
      load()
      return
    }

    setDone({
      code: r.code || '',
      castName: picked.castName,
      businessDate: picked.day.businessDate,
      slotTime: picked.slot.slotTime,
    })
    setPicked(null)
    setName('')
    setEmail('')
    setNote('')
    load()
  }

  // ---- 申し込み完了 ----
  if (done) {
    return (
      <div className="bk">
        <Header />
        <main className="bk-main">
          <section className="bk-done">
            <p className="bk-done-eyebrow">お申し込みを受け付けました</p>
            <h2 className="bk-done-title">まだ確定ではありません</h2>
            <p className="bk-done-lead">
              店が内容を確認して、あらためてお返事します。
              確定するまでこの枠は他の方に渡りませんので、そのままお待ちください。
            </p>

            <dl className="bk-done-detail">
              <div>
                <dt>日にち</dt>
                <dd>{labelDay(done.businessDate)}</dd>
              </div>
              <div>
                <dt>時間</dt>
                <dd>{slotRange(done.slotTime)}</dd>
              </div>
              <div>
                <dt>キャスト</dt>
                <dd>{done.castName}</dd>
              </div>
            </dl>

            <div className="bk-code">
              <span className="bk-code-label">予約番号</span>
              <strong className="bk-code-value">{done.code}</strong>
            </div>
            <p className="bk-done-note">
              この番号はお問い合わせのときに使います。スクリーンショットを撮るか、控えておいてください。
            </p>

            <button className="bk-btn bk-btn-ghost" onClick={() => setDone(null)}>
              続けて別の枠を申し込む
            </button>
          </section>
        </main>
        <Footer />
      </div>
    )
  }

  // ---- 空き状況 ----
  return (
    <div className="bk">
      <Header />

      <main className="bk-main">
        {err && <p className="bk-error">{err}</p>}

        {days === null && <p className="bk-loading">空き状況を読み込んでいます…</p>}

        {days !== null && days.length === 0 && !err && (
          <section className="bk-empty">
            <h2>ただいま受付している日はありません</h2>
            <p>
              受付が始まると、この画面に日にちと空き時間が並びます。
              このページをブックマークして、またのぞいてみてください。
            </p>
          </section>
        )}

        {days?.map((day) => (
          <section key={day.businessDate} className="bk-day">
            <div className="bk-day-head">
              <h2 className="bk-day-title">{labelDay(day.businessDate)}</h2>
              {!day.isAccepting && day.acceptFrom && (
                <span className="bk-day-badge">{labelDateTime(day.acceptFrom)} から受付開始</span>
              )}
              {day.isAccepting && day.acceptUntil && (
                <span className="bk-day-badge bk-day-badge-quiet">
                  {labelDateTime(day.acceptUntil)} まで受付
                </span>
              )}
            </div>

            {day.dayNote && <p className="bk-day-note">{day.dayNote}</p>}

            {!day.isAccepting && day.acceptFrom && (
              <p className="bk-day-wait">
                まだ受付前です。上の時刻になると、この下のボタンからお申し込みいただけます。
              </p>
            )}

            <div className="bk-casts">
              {day.casts.map((cast) => (
                <div key={cast.castId} className="bk-cast">
                  <div className="bk-cast-name">{cast.castName}</div>
                  <div className="bk-slots">
                    {cast.slots.map((slot) => {
                      const canBook = day.isAccepting && slot.state === 'open'
                      // 受付開始前は空き状況を伏せる。金色で「空き」と出すと押せそうに見えて、
                      // 押せないボタンを前にした人が困る。時刻だけ並べて予告にとどめる
                      const shown = day.isAccepting ? slot.state : 'closed'
                      return (
                        <button
                          key={slot.slotNo}
                          type="button"
                          className={`bk-slot bk-slot-${shown}`}
                          disabled={!canBook}
                          // ボタンの中は時刻と状態しか書いていないので、読み上げでは
                          // どのキャストの枠か分からなくなる。ここで補う
                          aria-label={
                            day.isAccepting
                              ? `${cast.castName} ${slotRange(slot.slotTime)} ${STATE_LABEL[slot.state]}`
                              : `${cast.castName} ${slotRange(slot.slotTime)} 受付開始前`
                          }
                          onClick={() => openForm(day, cast.castId, cast.castName, slot)}
                        >
                          <span className="bk-slot-time">{slot.slotTime}</span>
                          {day.isAccepting && (
                            <span className="bk-slot-state">{STATE_LABEL[slot.state]}</span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}

        {days !== null && days.length > 0 && (
          <p className="bk-legend">
            <span className="bk-legend-item"><i className="bk-dot bk-dot-open" />空き — お申し込みいただけます</span>
            <span className="bk-legend-item"><i className="bk-dot bk-dot-pending" />申込中 — 先にお申し込みの方がいます</span>
            <span className="bk-legend-item"><i className="bk-dot bk-dot-confirmed" />満席</span>
          </p>
        )}
      </main>

      {picked && (
        <div className="bk-overlay" onClick={closeForm}>
          <div className="bk-sheet" onClick={(e) => e.stopPropagation()}>
            <h2 className="bk-sheet-title">お申し込み</h2>
            <p className="bk-sheet-sub">
              {labelDay(picked.day.businessDate)}　{slotRange(picked.slot.slotTime)}　{picked.castName}
            </p>

            <label className="bk-field">
              <span className="bk-label">お名前<em className="bk-req">必須</em></span>
              <input
                className="bk-input"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="キャラクター名"
                autoFocus
              />
            </label>

            <label className="bk-field">
              <span className="bk-label">メールアドレス<em className="bk-opt">任意</em></span>
              <input
                className="bk-input"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="確定のお知らせを受け取る場合"
              />
            </label>

            <label className="bk-field">
              <span className="bk-label">ご要望など<em className="bk-opt">任意</em></span>
              <textarea
                className="bk-input bk-textarea"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="はじめての方はその旨など"
              />
            </label>

            {formErr && <p className="bk-form-err">{formErr}</p>}

            <div className="bk-sheet-actions">
              <button className="bk-btn bk-btn-ghost" onClick={closeForm} disabled={sending}>
                やめる
              </button>
              <button className="bk-btn bk-btn-primary" onClick={send} disabled={sending}>
                {sending ? '送信中…' : 'この枠を申し込む'}
              </button>
            </div>
          </div>
        </div>
      )}

      <Footer />
    </div>
  )
}

function Header() {
  return (
    <header className="bk-header">
      <div className="bk-lamp" aria-hidden="true">灯</div>
      <div>
        <div className="bk-shop">対話店［灯］</div>
        <h1 className="bk-h1">ご予約のお申し込み</h1>
      </div>
    </header>
  )
}

function Footer() {
  return (
    <footer className="bk-footer">
      <p>お申し込みは1時間の枠でお受けしています。</p>
      <p>同じ日にお申し込みいただけるのは1件までです。</p>
    </footer>
  )
}
