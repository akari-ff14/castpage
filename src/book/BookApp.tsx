import { useCallback, useEffect, useState } from 'react'
import {
  cancelReservation,
  fetchBookingDays,
  fetchMyReservations,
  lookupByCode,
  submitReservation,
  subscribeMyReservations,
  type BookingDay,
  type MyReservation,
  type PublicSlot,
} from './api'
import { disablePush, enablePush, getPushState, type PushState } from './push'
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
  return `${slotTime} 〜 ${String(hh + 1).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

// 予約の開始時刻から「21:00 〜 22:00」を作る（自分の予約一覧で使う）
function rangeFromStart(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const jst = new Date(d.getTime() + 9 * 3600 * 1000)
  const h = jst.getUTCHours()
  const m = String(jst.getUTCMinutes()).padStart(2, '0')
  // 深夜は 24:20 のように続けて書く。日付が変わったように見せない
  const show = (n: number) => String(n < 4 ? n + 24 : n).padStart(2, '0')
  return `${show(h)}:${m} 〜 ${show(h + 1)}:${m}`
}

const STATE_LABEL: Record<PublicSlot['state'], string> = {
  open: '空き',
  pending: '申込中',
  confirmed: '満席',
  closed: '—',
}

// ============================================================
// ルーティング（GitHub Pages なので # 形式）
// ============================================================

function useHashRoute(): string {
  const [route, setRoute] = useState(() => location.hash.replace(/^#/, '') || '/')
  useEffect(() => {
    const onChange = () => setRoute(location.hash.replace(/^#/, '') || '/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}

export default function BookApp() {
  const route = useHashRoute()
  const onMyPage = route.startsWith('/my')

  return (
    <div className="bk">
      <header className="bk-header">
        <div className="bk-lamp" aria-hidden="true">灯</div>
        <div>
          <div className="bk-shop">対話店［灯］</div>
          <h1 className="bk-h1">{onMyPage ? 'ご予約の状況' : 'ご予約のお申し込み'}</h1>
        </div>
      </header>

      <nav className="bk-nav">
        <a className={`bk-nav-tab ${onMyPage ? '' : 'is-current'}`} href="#/">空き状況</a>
        <a className={`bk-nav-tab ${onMyPage ? 'is-current' : ''}`} href="#/my">予約の状況</a>
      </nav>

      {onMyPage ? <MyReservations /> : <SlotPicker />}

      <footer className="bk-footer">
        <p>お申し込みは1時間の枠でお受けしています。</p>
        <p>同じ日にお申し込みいただけるのは1件までです。</p>
      </footer>
    </div>
  )
}

// ============================================================
// 空き状況と申し込み
// ============================================================

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

function SlotPicker() {
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

  if (done) {
    return (
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
            結果は「予約の状況」でいつでも確認できます。
            別の端末から見るときにこの番号を使うので、控えておいてください。
          </p>

          <div className="bk-done-actions">
            <a className="bk-btn bk-btn-primary bk-btn-link" href="#/my">予約の状況を見る</a>
            <button className="bk-btn bk-btn-ghost" onClick={() => setDone(null)}>
              続けて別の枠を申し込む
            </button>
          </div>
        </section>

        {/* 通知の許可はユーザーの操作を起点にしないと求められない。
            申し込み直後がいちばん自然に押してもらえる場所 */}
        <PushSetting />
      </main>
    )
  }

  return (
    <>
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
    </>
  )
}

// ============================================================
// 自分の予約の状況
// ============================================================

type ShownState = 'pending' | 'confirmed' | 'rejected' | 'cancelled' | 'past'

function shownState(r: MyReservation): ShownState {
  if (r.cancelled) return 'cancelled'
  if (r.status === 'rejected') return 'rejected'
  if (new Date(r.startsAt).getTime() < Date.now()) return 'past'
  return r.status === 'confirmed' ? 'confirmed' : 'pending'
}

const SHOWN_LABEL: Record<ShownState, string> = {
  pending: '確認中',
  confirmed: 'ご予約確定',
  rejected: 'お受けできませんでした',
  cancelled: '取り消し済み',
  past: '終了',
}

function MyReservations() {
  const [list, setList] = useState<MyReservation[] | null>(null)
  const [noSession, setNoSession] = useState(false)
  const [err, setErr] = useState('')
  const [code, setCode] = useState('')
  const [looked, setLooked] = useState<MyReservation | null | 'notfound'>(null)
  const [looking, setLooking] = useState(false)
  const [cancelling, setCancelling] = useState<MyReservation | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr('')
    try {
      const rows = await fetchMyReservations()
      if (rows === null) {
        setNoSession(true)
        setList([])
      } else {
        setNoSession(false)
        setList(rows)
      }
    } catch {
      setErr('読み込めませんでした。もう一度お試しください。')
      setList([])
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 承認された瞬間に表示が変わるようにしておく
  useEffect(() => {
    let dispose: (() => void) | undefined
    let alive = true
    subscribeMyReservations(() => load()).then((fn) => {
      if (alive) dispose = fn
      else fn()
    })
    return () => {
      alive = false
      dispose?.()
    }
  }, [load])

  async function doLookup() {
    setLooking(true)
    try {
      const r = await lookupByCode(code)
      setLooked(r ?? 'notfound')
    } catch {
      setLooked('notfound')
    } finally {
      setLooking(false)
    }
  }

  async function doCancel() {
    if (!cancelling) return
    setBusy(true)
    const r = await cancelReservation(cancelling.id)
    setBusy(false)
    if (!r.ok) {
      setErr(r.error || '取り消せませんでした')
      return
    }
    setCancelling(null)
    // 番号で引いた結果が残っていると、取り消したのに「確定」のままになる
    setLooked(null)
    load()
  }

  const active = (list || []).filter((r) => !r.cancelled && shownState(r) !== 'past')
  const finished = (list || []).filter((r) => r.cancelled || shownState(r) === 'past')

  return (
    <>
      <main className="bk-main">
        {err && <p className="bk-error">{err}</p>}
        {list === null && <p className="bk-loading">読み込んでいます…</p>}

        {list !== null && noSession && (
          <section className="bk-empty">
            <h2>このブラウザからのお申し込みはありません</h2>
            <p>
              別の端末やブラウザでお申し込みになった場合は、
              下の予約番号での照会をお使いください。
            </p>
          </section>
        )}

        {list !== null && !noSession && active.length === 0 && finished.length === 0 && (
          <section className="bk-empty">
            <h2>お申し込みはまだありません</h2>
            <p>「空き状況」から枠を選んでお申し込みください。</p>
          </section>
        )}

        {active.length > 0 && (
          <section className="bk-mylist">
            {active.map((r) => (
              <MyCard key={r.id} r={r} onCancel={() => setCancelling(r)} />
            ))}
          </section>
        )}

        {finished.length > 0 && (
          <section className="bk-mylist">
            <h2 className="bk-sub-h">過去のお申し込み</h2>
            {finished.map((r) => (
              <MyCard key={r.id} r={r} />
            ))}
          </section>
        )}

        {!noSession && <PushSetting />}

        <section className="bk-lookup">
          <h2 className="bk-sub-h">予約番号で調べる</h2>
          <p className="bk-lookup-lead">
            別の端末でお申し込みになった予約は、番号を入れると確認できます。
          </p>
          <div className="bk-lookup-row">
            <input
              className="bk-input"
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AK-XXXXXX"
              aria-label="予約番号"
            />
            <button className="bk-btn bk-btn-ghost" onClick={doLookup} disabled={looking || !code.trim()}>
              {looking ? '…' : '調べる'}
            </button>
          </div>

          {looked === 'notfound' && (
            <p className="bk-lookup-miss">その番号のご予約は見つかりませんでした。</p>
          )}
          {looked && looked !== 'notfound' && (
            <>
              <MyCard r={looked} />
              <p className="bk-lookup-miss">
                取り消しは、お申し込みになった端末からお願いします。
                その端末が使えないときは店にご連絡ください。
              </p>
            </>
          )}
        </section>
      </main>

      {cancelling && (
        <div className="bk-overlay" onClick={() => !busy && setCancelling(null)}>
          <div className="bk-sheet" onClick={(e) => e.stopPropagation()}>
            <h2 className="bk-sheet-title">お申し込みを取り消す</h2>
            <p className="bk-sheet-sub">
              {cancelling.businessDate && labelDay(cancelling.businessDate)}
              {rangeFromStart(cancelling.startsAt)}　{cancelling.castName}
            </p>
            <p className="bk-done-lead">
              取り消すと、この枠は他の方がお申し込みできる状態に戻ります。元には戻せません。
            </p>
            <div className="bk-sheet-actions">
              <button className="bk-btn bk-btn-ghost" onClick={() => setCancelling(null)} disabled={busy}>
                やめる
              </button>
              <button className="bk-btn bk-btn-danger" onClick={doCancel} disabled={busy}>
                {busy ? '取り消し中…' : '取り消す'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ============================================================
// お知らせの受け取り（Chrome 通知）
// ============================================================

function PushSetting() {
  const [state, setState] = useState<PushState | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    getPushState().then(setState)
  }, [])

  async function turnOn() {
    setBusy(true)
    setErr('')
    const r = await enablePush()
    setState(r.state)
    if (!r.ok && r.error) setErr(r.error)
    setBusy(false)
  }

  async function turnOff() {
    setBusy(true)
    setState(await disablePush())
    setBusy(false)
  }

  if (state === null || state === 'unsupported') return null

  return (
    <section className="bk-push">
      <h2 className="bk-sub-h">お知らせの受け取り</h2>

      {state === 'on' && (
        <>
          <p className="bk-push-lead">
            この端末でお知らせを受け取ります。ご予約が確定したときにお伝えします。
          </p>
          <button className="bk-btn bk-btn-ghost bk-btn-small" onClick={turnOff} disabled={busy}>
            {busy ? '…' : 'お知らせを止める'}
          </button>
        </>
      )}

      {state === 'off' && (
        <>
          <p className="bk-push-lead">
            ご予約が確定したときに、この端末にお知らせを出せます。
            このページを開いていなくても届きます。
          </p>
          <button className="bk-btn bk-btn-primary bk-btn-small" onClick={turnOn} disabled={busy}>
            {busy ? '…' : 'お知らせを受け取る'}
          </button>
        </>
      )}

      {state === 'denied' && (
        <p className="bk-push-lead">
          このサイトからのお知らせがブラウザ側で止められています。
          受け取るには、アドレスバーの左にある鍵のマークから通知を「許可」に変えてください。
        </p>
      )}

      {state === 'ios-needs-pwa' && (
        <div className="bk-push-ios">
          <p>
            <strong>iPhone・iPad をお使いの方へ</strong>
          </p>
          <p>
            お知らせを受け取るには、画面下の共有ボタン
            <span className="bk-push-share" aria-hidden="true">⬆</span>
            から「ホーム画面に追加」をしてください。追加したアイコンから開くと、
            この欄にお知らせを受け取るボタンが出ます。
          </p>
          <p className="bk-push-ios-note">
            追加しなくても、このページを開けばご予約の状況はいつでも確認できます。
          </p>
        </div>
      )}

      {err && <p className="bk-lookup-miss">{err}</p>}
    </section>
  )
}

function MyCard({ r, onCancel }: { r: MyReservation; onCancel?: () => void }) {
  const state = shownState(r)
  return (
    <article className={`bk-mycard bk-mycard-${state}`}>
      <div className="bk-mycard-head">
        <span className={`bk-status bk-status-${state}`}>{SHOWN_LABEL[state]}</span>
        <span className="bk-mycard-code">{r.publicCode}</span>
      </div>

      <div className="bk-mycard-when">
        {r.businessDate && labelDay(r.businessDate)}　{rangeFromStart(r.startsAt)}
      </div>
      <div className="bk-mycard-cast">{r.castName || 'フリー'}　<span className="bk-mycard-name">{r.customerName} 様</span></div>

      {state === 'pending' && (
        <p className="bk-mycard-msg">店からのお返事をお待ちください。確定するとここの表示が変わります。</p>
      )}
      {state === 'confirmed' && (
        <p className="bk-mycard-msg">お待ちしております。当日はお気をつけてお越しください。</p>
      )}
      {state === 'rejected' && (
        <p className="bk-mycard-msg">
          {r.decisionNote || '申し訳ありません。今回はお受けできませんでした。'}
        </p>
      )}

      {onCancel && (state === 'pending' || state === 'confirmed') && (
        <div className="bk-mycard-actions">
          <button className="bk-btn bk-btn-ghost bk-btn-small" onClick={onCancel}>
            取り消す
          </button>
        </div>
      )}
    </article>
  )
}
