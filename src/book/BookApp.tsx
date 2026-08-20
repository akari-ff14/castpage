import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cancelReservation,
  fetchBookingDays,
  fetchMyReservations,
  lookupByCode,
  requestChange,
  submitReservation,
  subscribeMyReservations,
  type BookingDay,
  type MyReservation,
  type PublicSlot,
} from './api'
import { disablePush, enablePush, getPushState, type PushState } from './push'
import { isTurnstileEnabled, renderTurnstile, type TurnstileHandle } from './turnstile'
import './book.css'

// 受付日を探す範囲。店は先の日程まで開けることがあるので広めに取る
const FUTURE_DAYS = 120

// 1枠に入れるお名前の上限。1時間1組なので、店内アプリの10名より控えめにする
const MAX_NAMES = 5

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

  // ご本人とご一緒の方。1行目が必須で、2行目以降は空なら捨てる
  const [names, setNames] = useState<string[]>([''])
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [formErr, setFormErr] = useState('')
  const [sending, setSending] = useState(false)

  // --- いたずら防止 ---
  // 人には見えない入力欄。自動入力するプログラムだけがここを埋める
  const [trap, setTrap] = useState('')
  // フォームを開いた時刻。人が読んで入力する時間を下回る送信は弾く
  const openedAt = useRef(0)
  // Cloudflare の確認結果。サイトキー未設定のときは使わない
  const [captcha, setCaptcha] = useState('')
  const captchaBox = useRef<HTMLDivElement | null>(null)
  const captchaHandle = useRef<TurnstileHandle | null>(null)

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
    setTrap('')
    setCaptcha('')
    openedAt.current = Date.now()
  }

  function closeForm() {
    if (sending) return
    setPicked(null)
    setFormErr('')
  }

  // 確認ウィジェットはフォームを開くたびに描き直す
  useEffect(() => {
    if (!picked || !isTurnstileEnabled()) return
    const box = captchaBox.current
    if (!box) return
    let disposed = false
    renderTurnstile(box, (token) => setCaptcha(token)).then((h) => {
      if (disposed) h?.remove()
      else captchaHandle.current = h
    })
    return () => {
      disposed = true
      captchaHandle.current?.remove()
      captchaHandle.current = null
    }
  }, [picked])

  async function send() {
    if (!picked) return
    // 店内アプリ側は「、」「,」区切りで複数名を展開するので、その形に合わせる
    const cleaned = names.map((n) => n.trim()).filter(Boolean)
    if (!cleaned.length) {
      setFormErr('お名前を入力してください')
      return
    }

    // 人には見えない欄が埋まっている＝自動入力。何が起きたか説明せずに黙って断る
    if (trap) {
      setFormErr('送信できませんでした。時間をおいてもう一度お試しください')
      return
    }
    // 開いてから2秒未満の送信は人の操作ではない
    if (Date.now() - openedAt.current < 2000) {
      setFormErr('もう一度「この枠を申し込む」を押してください')
      openedAt.current = 0
      return
    }
    if (isTurnstileEnabled() && !captcha) {
      setFormErr('確認中です。数秒おいてもう一度お試しください')
      return
    }

    setSending(true)
    setFormErr('')
    const r = await submitReservation({
      businessDate: picked.day.businessDate,
      castId: picked.castId,
      slotNo: picked.slot.slotNo,
      customerName: cleaned.join('、'),
      email: email.trim() || undefined,
      note: note.trim() || undefined,
      captchaToken: captcha || undefined,
    })
    setSending(false)
    // 確認結果は1回きり。失敗しても成功しても取り直す
    captchaHandle.current?.reset()
    setCaptcha('')

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
    setNames([''])
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

            <CastSlots
              day={day}
              onPick={(castId, castName, slot) => openForm(day, castId, castName, slot)}
            />
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

            <div className="bk-field">
              <span className="bk-label">お名前<em className="bk-req">必須</em></span>
              <div className="bk-names">
                {names.map((n, i) => (
                  <div key={i} className="bk-name-row">
                    <input
                      className="bk-input"
                      type="text"
                      value={n}
                      onChange={(e) => setNames((list) => list.map((v, j) => (j === i ? e.target.value : v)))}
                      placeholder={i === 0 ? 'キャラクター名' : `ご一緒の方 ${i}`}
                      autoComplete="off"
                      aria-label={i === 0 ? 'お名前' : `ご一緒の方 ${i} のお名前`}
                      autoFocus={i === 0}
                    />
                    {i === names.length - 1 && names.length < MAX_NAMES ? (
                      <button
                        type="button"
                        className="bk-name-btn"
                        onClick={() => setNames((list) => [...list, ''])}
                        aria-label="ご一緒の方を追加"
                        title="ご一緒の方を追加"
                      >
                        ＋
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="bk-name-btn"
                        onClick={() => setNames((list) => list.filter((_, j) => j !== i))}
                        aria-label="この欄を削除"
                        title="この欄を削除"
                      >
                        −
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <p className="bk-field-hint">
                ご一緒にお越しの方がいれば「＋」で追加してください（{MAX_NAMES}名まで）。
              </p>
            </div>

            <label className="bk-field">
              <span className="bk-label">メールアドレス<em className="bk-opt">任意</em></span>
              <input
                className="bk-input"
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="店からご連絡が必要なときのため"
              />
            </label>

            <p className="bk-field-hint">
              確定のお知らせは、この端末への通知と「予約の状況」でお伝えします。
              メールアドレスは、店からご連絡したいことがあったときにだけ使います。
            </p>

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

            {/* 人には見せない欄。プログラムはラベルを読んで律儀に埋めてくれる */}
            <div className="bk-trap" aria-hidden="true">
              <label htmlFor="bk-website">ホームページ</label>
              <input
                id="bk-website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={trap}
                onChange={(e) => setTrap(e.target.value)}
              />
            </div>

            <div ref={captchaBox} className="bk-captcha" />

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

// キャスト × 枠のマス目。新規の申し込みと、日時の変更申請で同じものを使う
function CastSlots({
  day,
  onPick,
}: {
  day: BookingDay
  onPick: (castId: string, castName: string, slot: PublicSlot) => void
}) {
  return (
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
                  onClick={() => onPick(cast.castId, cast.castName, slot)}
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
  // 日時の変更申請
  const [changing, setChanging] = useState<MyReservation | null>(null)
  const [changeDays, setChangeDays] = useState<BookingDay[] | null>(null)
  const [changeErr, setChangeErr] = useState('')
  const [changeDone, setChangeDone] = useState(false)

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

  // 変更したい予約が決まったら、空いている枠を読み込んで選んでもらう
  function openChange(r: MyReservation) {
    setChanging(r)
    setChangeErr('')
    setChangeDone(false)
    setChangeDays(null)
    const today = jstToday()
    fetchBookingDays(today, addDays(today, FUTURE_DAYS))
      .then(setChangeDays)
      .catch(() => {
        setChangeDays([])
        setChangeErr('空き状況を読み込めませんでした')
      })
  }

  async function pickNewSlot(castId: string, slot: PublicSlot) {
    if (!changing) return
    setBusy(true)
    setChangeErr('')
    const r = await requestChange({
      reservationId: changing.id,
      businessDate: slot.businessDate,
      castId,
      slotNo: slot.slotNo,
    })
    setBusy(false)
    if (!r.ok) {
      setChangeErr(r.error || '申し込めませんでした')
      // 枠が埋まっていた場合に備えて最新に描き直す
      const today = jstToday()
      fetchBookingDays(today, addDays(today, FUTURE_DAYS)).then(setChangeDays).catch(() => {})
      return
    }
    setChangeDone(true)
    load()
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
              <MyCard
                key={r.id}
                r={r}
                isChange={!!r.changeFromId}
                // この予約について変更を申請中なら、二重に申請させない
                changeRequested={active.some((x) => x.changeFromId === r.id && x.status === 'pending')}
                onCancel={() => setCancelling(r)}
                onChange={() => openChange(r)}
              />
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

      {changing && (
        <div className="bk-overlay" onClick={() => !busy && setChanging(null)}>
          <div className="bk-sheet bk-sheet-wide" onClick={(e) => e.stopPropagation()}>
            {changeDone ? (
              <>
                <h2 className="bk-sheet-title">変更を申し込みました</h2>
                <p className="bk-done-lead">
                  店が確認して、あらためてお返事します。
                  <strong>お返事があるまで、今のご予約はそのままです。</strong>
                  変更後の枠も押さえてありますので、そのままお待ちください。
                </p>
                <div className="bk-sheet-actions">
                  <button className="bk-btn bk-btn-primary" onClick={() => setChanging(null)}>
                    閉じる
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="bk-sheet-title">日時を変更する</h2>
                <p className="bk-sheet-sub">
                  今のご予約　{changing.businessDate && labelDay(changing.businessDate)}
                  {rangeFromStart(changing.startsAt)}　{changing.castName}
                </p>
                <p className="bk-field-hint">
                  変更したい枠を選んでください。すぐには変わらず、店が承認してから入れ替わります。
                </p>

                {changeErr && <p className="bk-form-err">{changeErr}</p>}
                {changeDays === null && <p className="bk-loading">空き状況を読み込んでいます…</p>}
                {changeDays?.length === 0 && !changeErr && (
                  <p className="bk-lookup-miss">いま受付している日がありません。</p>
                )}

                {changeDays?.map((day) => (
                  <div key={day.businessDate} className="bk-change-day">
                    <div className="bk-day-head">
                      <h3 className="bk-day-title">{labelDay(day.businessDate)}</h3>
                    </div>
                    <CastSlots
                      day={day}
                      onPick={(castId, _castName, slot) => !busy && pickNewSlot(castId, slot)}
                    />
                  </div>
                ))}

                <div className="bk-sheet-actions">
                  <button className="bk-btn bk-btn-ghost" onClick={() => setChanging(null)} disabled={busy}>
                    やめる
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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

function MyCard({
  r,
  isChange = false,
  changeRequested = false,
  onCancel,
  onChange,
}: {
  r: MyReservation
  isChange?: boolean
  changeRequested?: boolean
  onCancel?: () => void
  onChange?: () => void
}) {
  const state = shownState(r)
  return (
    <article className={`bk-mycard bk-mycard-${state}`}>
      <div className="bk-mycard-head">
        <span className={`bk-status bk-status-${state}`}>
          {isChange && state === 'pending' ? '変更を確認中' : SHOWN_LABEL[state]}
        </span>
        <span className="bk-mycard-code">{r.publicCode}</span>
      </div>

      <div className="bk-mycard-when">
        {r.businessDate && labelDay(r.businessDate)}　{rangeFromStart(r.startsAt)}
      </div>
      <div className="bk-mycard-cast">{r.castName || 'フリー'}　<span className="bk-mycard-name">{r.customerName} 様</span></div>

      {state === 'pending' && !isChange && (
        <p className="bk-mycard-msg">店からのお返事をお待ちください。確定するとここの表示が変わります。</p>
      )}
      {state === 'pending' && isChange && (
        <p className="bk-mycard-msg">
          こちらの枠への変更を申し込んでいます。承認されるとこの枠に切り替わり、
          もとのご予約は取り消されます。
        </p>
      )}
      {state === 'confirmed' && (
        <p className="bk-mycard-msg">お待ちしております。当日はお気をつけてお越しください。</p>
      )}
      {state === 'rejected' && (
        <p className="bk-mycard-msg">
          {isChange
            ? r.decisionNote || '変更はお受けできませんでした。もとのご予約はそのままです。'
            : r.decisionNote || '申し訳ありません。今回はお受けできませんでした。'}
        </p>
      )}
      {changeRequested && (
        <p className="bk-mycard-msg">別の枠への変更を申し込み中です。お返事をお待ちください。</p>
      )}

      {(onCancel || onChange) && (state === 'pending' || state === 'confirmed') && (
        <div className="bk-mycard-actions">
          {/* 変更申請そのものは「変更」できない。取り下げて出し直してもらう */}
          {onChange && !isChange && !changeRequested && (
            <button className="bk-btn bk-btn-ghost bk-btn-small" onClick={onChange}>
              日時を変更する
            </button>
          )}
          {onCancel && (
            <button className="bk-btn bk-btn-ghost bk-btn-small" onClick={onCancel}>
              取り消す
            </button>
          )}
        </div>
      )}
    </article>
  )
}
