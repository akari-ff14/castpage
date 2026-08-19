import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  db,
  decideReservation,
  getPendingReservations,
  getReservationTimeStep,
  notifyReservationDecision,
  DEFAULT_RESERVATION_TIME_STEP,
  type CustomerSummary,
  type PendingReservation,
} from '../lib/db'
import { fmtCurrency, fmtDate, fmtDateTime, fmtBizTime } from '../lib/format'
import { useRealtimeReservations, useActiveSessions } from '../lib/useRealtimeSessions'
import { Play, Clock, Plus, Minus, Sparkles, AlertTriangle, Check, Close } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import GanttTimeline from './GanttTimeline'
import type { SessionPreset } from './StartSessionForm'
import './ReservationTab.css'

interface Reservation {
  reservation_id: string
  キャスト名: string
  顧客名: string
  予約金額: number
  予約時間: number
  予約日時: string
  ルーム: string
  備考: string
  作成日時: string
  更新日時: string
  converted: boolean   // 接客開始済み
  キャンセル済: boolean // 予約キャンセル（履歴として残す）
  status: 'pending' | 'confirmed' | 'rejected'  // お客様の申込は承認まで pending
  source: 'staff' | 'customer'                  // どちら発の予約か
}

interface PricingEntry {
  key: string
  label: string
  price: number
}

interface BlMatch {
  name: string
  reason?: string
}

// JSTのISO風文字列→ input value (YYYY-MM-DDTHH:mm:ss、秒まで保持)
function toLocalInput(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  // JST に変換
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 19)
}

// 現在時刻（JST）を "YYYY-MM-DDTHH:mm:ss" で返す。
// stepSec = 1（秒単位）なら丸めなしで即時対応の時刻をそのまま、
// それ以外は設定の刻みに丸める（例: 300 = 5分単位、四捨五入）
function nowJstInput(stepSec: number): string {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  if (stepSec > 1) {
    const stepMs = stepSec * 1000
    jst.setTime(Math.round(jst.getTime() / stepMs) * stepMs)
  }
  return jst.toISOString().slice(0, 19)
}

// 時刻欄のラベル（設定された刻みに応じて変える）
function timeLabel(stepSec: number): string {
  if (stepSec < 60) return '時刻（秒まで指定可）'
  if (stepSec === 60) return '時刻（分単位）'
  return `時刻（${Math.round(stepSec / 60)}分刻み）`
}

// input value (JST) → UTC ISO。秒は省略可（"HH:mm" / "HH:mm:ss" 両対応）
function fromLocalInput(local: string): string {
  if (!local) return ''
  // localは「JSTの壁時計時刻」として扱い、UTCに戻す
  const [datePart, timePart] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm, ss] = timePart.split(':').map(Number)
  // JST = UTC + 9h なので UTC = JST - 9h
  const utc = new Date(Date.UTC(y, m - 1, d, hh, mm, ss || 0) - 9 * 60 * 60 * 1000)
  return utc.toISOString()
}

interface FormState {
  reservation_id?: string
  castName: string
  customerNames: string[]  // 複数名（お連れ様）対応。保存時はカンマ区切りで結合
  datetime: string  // datetime-local input format
  room: string
  pricingKey: string
  durationMin: number  // 対応時間（分、30分刻み）
  note: string
  cancelled: boolean   // 予約キャンセル済（キャストが埋まっていた等）
}

const emptyForm = (castName: string): FormState => ({
  castName,
  customerNames: [''],
  datetime: '',
  room: '',
  pricingKey: 'normal',
  durationMin: 60,
  note: '',
  cancelled: false,
})

// タブ切替（アンマウント）で入力途中の内容が消えないよう、下書きを sessionStorage に保持する。
// 保存成功・明示的なキャンセル/閉じる操作で破棄し、画面切替では残す。
const DRAFT_KEY = 'akari_reservation_draft'

function loadDraft(): FormState | null {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const d = JSON.parse(raw) as FormState
    if (!Array.isArray(d.customerNames)) d.customerNames = ['']
    if (typeof d.cancelled !== 'boolean') d.cancelled = false
    return d
  } catch {
    return null
  }
}

function clearDraft() {
  try { sessionStorage.removeItem(DRAFT_KEY) } catch { /* noop */ }
}

// 顧客名文字列（カンマ/読点区切り）→ 入力欄配列
function splitCustomerNames(joined: string): string[] {
  const names = String(joined || '').split(/[,、]/).map((s) => s.trim()).filter(Boolean)
  return names.length ? names : ['']
}

// 対応時間の候補（30分刻み、30分〜5時間）
const DURATION_OPTIONS: number[] = Array.from({ length: 10 }, (_, i) => (i + 1) * 30)

function durationLabel(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h && m) return `${h}時間${m}分`
  if (h) return `${h}時間`
  return `${m}分`
}

export default function ReservationTab({
  castName,
  isAdmin = false,
  onStartSession,
}: {
  castName: string
  isAdmin?: boolean
  onStartSession?: (preset: SessionPreset) => void
}) {
  const [list, setList] = useState<Reservation[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [castFilter, setCastFilter] = useState<'mine' | 'all'>('all')

  // フォーム関連
  const [casts, setCasts] = useState<string[]>([])
  const [rooms, setRooms] = useState<string[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])
  // 下書きが残っていれば復元してフォームを開き直す（タブ切替による入力消失対策）
  const [formOpen, setFormOpen] = useState(() => loadDraft() !== null)
  const [form, setForm] = useState<FormState>(() => loadDraft() ?? emptyForm(castName))
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<Reservation | null>(null)
  // 顧客名 → 来店サマリー（リピート判定）。一度引いた名前はキャッシュ
  const [custSummaries, setCustSummaries] = useState<Map<string, CustomerSummary>>(new Map())
  // 顧客名 → ブラックリスト該当（出禁チェック）。一度引いた名前はキャッシュ
  const [blMatches, setBlMatches] = useState<Map<string, BlMatch[]>>(new Map())
  // 保存時に BL 該当があった場合の確認モーダル
  const [blConfirm, setBlConfirm] = useState<BlMatch[] | null>(null)
  // 既存顧客名（入力サジェスト用。ローマ字/かな入力の手間軽減）
  const [knownNames, setKnownNames] = useState<string[]>([])
  // 時刻入力の刻み（秒）。管理タブ → 店舗設定で変更できる
  const [timeStep, setTimeStep] = useState(DEFAULT_RESERVATION_TIME_STEP)
  // お客様からの申込（管理者だけに見せる）
  const [pending, setPending] = useState<PendingReservation[]>([])
  const [pendingBusy, setPendingBusy] = useState('')          // 処理中の申込 id
  const [rejecting, setRejecting] = useState<PendingReservation | null>(null)
  const [rejectNote, setRejectNote] = useState('')
  const toast = useToast()

  // フォームを開いている間、入力内容を下書きとして保持
  useEffect(() => {
    if (!formOpen) return
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(form)) } catch { /* noop */ }
  }, [form, formOpen])

  // 顧客名の入力が止まったら来店サマリー + BL照合を取得（400ms デバウンス）
  useEffect(() => {
    if (!formOpen) return
    const names = form.customerNames
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((n) => !custSummaries.has(n) || !blMatches.has(n))
    if (!names.length) return
    const t = setTimeout(async () => {
      const [sumResults, blResults] = await Promise.all([
        Promise.all(names.map((n) => db.call<CustomerSummary>('getCustomerSummary', n))),
        Promise.all(names.map((n) => db.call<BlMatch[]>('checkBlacklist', n))),
      ])
      setCustSummaries((prev) => {
        const next = new Map(prev)
        sumResults.forEach((r, i) => { if (r.ok) next.set(names[i], r.data) })
        return next
      })
      setBlMatches((prev) => {
        const next = new Map(prev)
        blResults.forEach((r, i) => { if (r.ok) next.set(names[i], r.data || []) })
        return next
      })
    }, 400)
    return () => clearTimeout(t)
  }, [form.customerNames, formOpen, custSummaries, blMatches])

  // 明示的に閉じる（キャンセル/×）ときは下書きも破棄する
  function closeForm() {
    setFormOpen(false)
    clearDraft()
  }

  // 各キャストの稼働状況（誰が何時から何時まで対応か）をリアルタイム取得
  const { sessions: activeSessions } = useActiveSessions()

  // 全キャストの「次に入れる時刻」を計算する。
  // 進行中の接客（終了予定 + インターバル）と、未来の予約（開始〜終了 + インターバル）を
  // 塞がっている時間帯として扱い、今から見て最初に空く時刻を求める。
  const INTERVAL_MIN = 10
  const castAvailability = useMemo(() => {
    const now = Date.now()
    const INTERVAL_MS = INTERVAL_MIN * 60 * 1000
    const busy = new Map<string, Array<{ start: number; end: number; label: string }>>()
    const push = (cast: string, start: number, end: number, label: string) => {
      if (!cast) return
      if (!busy.has(cast)) busy.set(cast, [])
      busy.get(cast)!.push({ start, end: end + INTERVAL_MS, label })
    }
    for (const s of activeSessions) {
      const end = new Date(s.対応終了時間).getTime()
      if (isNaN(end)) continue
      push(s.対応者, 0, end, `対応中${s.顧客名 ? `（${s.顧客名}）` : ''}`)
    }
    for (const r of list) {
      if (r.キャンセル済 || r.converted) continue
      const start = new Date(r.予約日時).getTime()
      if (isNaN(start)) continue
      const end = start + (r.予約時間 || 60) * 60 * 1000
      if (end + INTERVAL_MS <= now) continue  // 終わった予約は無視
      push(r.キャスト名, start, end, `予約${r.顧客名 ? `（${r.顧客名}）` : ''}`)
    }
    const allCasts = casts.length
      ? casts
      : [...new Set([...activeSessions.map((s) => s.対応者), ...list.map((r) => r.キャスト名)])].filter(Boolean)
    return allCasts
      .map((cast) => {
        const blocks = (busy.get(cast) || []).sort((a, b) => a.start - b.start)
        let availMs = now
        let blockedBy = ''
        // 連続して塞がっている区間をたどって最初の空きを探す
        for (const b of blocks) {
          if (b.start <= availMs && availMs < b.end) {
            availMs = b.end
            blockedBy = b.label
          }
        }
        return { cast, availMs, busyNow: availMs > now, blockedBy }
      })
      .sort((a, b) => a.availMs - b.availMs || a.cast.localeCompare(b.cast, 'ja'))
  }, [activeSessions, list, casts])

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<Reservation[]>('getReservations')
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [])

  // お客様からの申込。管理者だけが読み込む
  const loadPending = useCallback(async () => {
    if (!isAdmin) {
      setPending([])
      return
    }
    try {
      const rows = await getPendingReservations()
      setPending(rows)
      // 承認する前に出禁の人だと気づけるようにしておく
      const names = Array.from(new Set(rows.map((r) => r.customerName).filter(Boolean)))
      if (names.length) {
        const results = await Promise.all(names.map((n) => db.call<BlMatch[]>('checkBlacklist', n)))
        setBlMatches((prev) => {
          const next = new Map(prev)
          names.forEach((n, i) => {
            const r = results[i]
            next.set(n, r.ok ? r.data || [] : [])
          })
          return next
        })
      }
    } catch {
      // 申込一覧が読めなくても予約タブ本体は使えるままにする
      setPending([])
    }
  }, [isAdmin])

  const reloadAll = useCallback(() => {
    load()
    loadPending()
  }, [load, loadPending])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadPending()
  }, [loadPending])

  useRealtimeReservations(reloadAll)

  async function approvePending(p: PendingReservation) {
    setPendingBusy(p.id)
    try {
      await decideReservation(p.id, true)
      // 通知は届かなくても確定は済んでいる。だから await はするが結果は問わない
      await notifyReservationDecision(p.id)
      toast.show(`${p.customerName}様の予約を確定しました`)
      reloadAll()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setPendingBusy('')
    }
  }

  async function rejectPending() {
    if (!rejecting) return
    setPendingBusy(rejecting.id)
    try {
      await decideReservation(rejecting.id, false, rejectNote.trim())
      await notifyReservationDecision(rejecting.id)
      toast.show(`${rejecting.customerName}様の申込をお断りしました`)
      setRejecting(null)
      setRejectNote('')
      reloadAll()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setPendingBusy('')
    }
  }

  useEffect(() => {
    (async () => {
      const [rCast, rPrice, rNames] = await Promise.all([
        db.call<{ casts: string[]; rooms: string[] }>('getCastsAndRooms'),
        db.call<PricingEntry[]>('getPricing'),
        db.call<string[]>('getKnownCustomerNames'),
      ])
      if (rCast.ok) { setCasts(rCast.data.casts); setRooms(rCast.data.rooms) }
      if (rPrice.ok) setPricing(rPrice.data)
      if (rNames.ok) setKnownNames(rNames.data || [])
    })()
    // 時刻刻みの設定（失敗時は既定値のまま）
    getReservationTimeStep().then(setTimeStep).catch(() => {})
  }, [])

  const filtered = list.filter((r) => {
    if (castFilter === 'mine' && r.キャスト名 !== castName) return false
    return true
  })

  function openAdd() {
    setForm(emptyForm(castName))
    setFormOpen(true)
  }

  function openEdit(r: Reservation) {
    // 既存の予約金額・時間から料金種別を逆算（枠単価 = 金額 ÷ 枠数）
    const durationMin = r.予約時間 || 60
    const slots = Math.max(1, Math.round(durationMin / 30))
    const unitPrice = r.予約金額 / slots
    const pricing0 = pricing.find((p) => p.price === unitPrice)
    setForm({
      reservation_id: r.reservation_id,
      castName: r.キャスト名,
      customerNames: splitCustomerNames(r.顧客名),
      datetime: toLocalInput(r.予約日時),
      room: r.ルーム || '',
      pricingKey: pricing0?.key || 'normal',
      durationMin,
      note: r.備考 || '',
      cancelled: r.キャンセル済,
    })
    setFormOpen(true)
  }

  function updateCustName(i: number, value: string) {
    setForm((f) => {
      const next = [...f.customerNames]
      next[i] = value
      return { ...f, customerNames: next }
    })
  }

  function addCustName() {
    setForm((f) =>
      f.customerNames.length >= 10 ? f : { ...f, customerNames: [...f.customerNames, ''] },
    )
  }

  function removeCustName(i: number) {
    setForm((f) => {
      if (f.customerNames.length === 1) return { ...f, customerNames: [''] }
      return { ...f, customerNames: f.customerNames.filter((_, idx) => idx !== i) }
    })
  }

  const pricingEntry = pricing.find((p) => p.key === form.pricingKey)
  // 料金 = 種別の枠単価 × 枠数（30分=1枠）
  const calcPrice = pricingEntry ? pricingEntry.price * (form.durationMin / 30) : 0

  // form.datetime ("YYYY-MM-DDTHH:mm:ss") を 日付 / 時刻 に分解して扱う
  const [dateVal, timeVal] = (() => {
    const [d = '', t = ''] = form.datetime.split('T')
    return [d, t]
  })()
  // 表示・保存に使う時刻。分単位以上の設定では編集前データに残っている秒を切り落とし、
  // 画面表示 (HH:mm) と保存値が食い違わないようにする
  const timeShown = timeStep >= 60 ? timeVal.slice(0, 5) : timeVal
  // 日付・時刻はどちらか片方だけ選んだ状態でも保持できるよう、
  // "YYYY-MM-DDTHH:mm" 形式で空の側を許容する（両方空のときだけ ''）
  const setDateTime = (date: string, time: string) =>
    setForm((f) => ({ ...f, datetime: date || time ? `${date}T${time}` : '' }))

  // 保存前チェック（出禁照合）。該当があれば確認モーダルを出して止める
  // ※キャストは空 = フリー（指名なし）を許容する（キャンセル記録などキャスト未定の予約用）
  async function save() {
    const [dPart, tPart] = form.datetime.split('T')
    if (!dPart) { toast.show('予約日が必要です', 'err'); return }
    if (!tPart) { toast.show('予約時刻が必要です', 'err'); return }

    // 出禁（ブラックリスト）チェック。キャンセル記録として残す場合はスキップ
    if (!form.cancelled) {
      setBusy(true)
      try {
        const names = form.customerNames.map((s) => s.trim()).filter(Boolean)
        const blResults = await Promise.all(names.map((n) => db.call<BlMatch[]>('checkBlacklist', n)))
        const matches: BlMatch[] = []
        const seen = new Set<string>()
        for (const r of blResults) {
          if (r.ok && Array.isArray(r.data)) {
            for (const m of r.data) {
              if (!seen.has(m.name)) { seen.add(m.name); matches.push(m) }
            }
          }
        }
        if (matches.length) {
          setBusy(false)
          setBlConfirm(matches)
          return
        }
      } catch { /* 照合失敗時は保存に進む */ }
      setBusy(false)
    }
    await doSave()
  }

  async function doSave() {
    setBlConfirm(null)
    setBusy(true)
    const payload = {
      ...(form.reservation_id ? { reservationId: form.reservation_id } : {}),
      castName: form.castName,
      customerName: form.customerNames.map((s) => s.trim()).filter(Boolean).join(', '),
      datetime: fromLocalInput(`${dateVal}T${timeShown}`),
      room: form.room,
      reservationPrice: calcPrice,
      durationMin: form.durationMin,
      note: form.note.trim(),
      cancelled: form.cancelled,
    }
    const r = form.reservation_id
      ? await db.call('updateReservation', payload)
      : await db.call('addReservation', payload)
    setBusy(false)
    if (r.ok) {
      toast.show(form.reservation_id ? '予約を更新しました' : '予約を追加しました')
      closeForm()
      load()
    } else {
      toast.show((r as { error: string }).error || '保存に失敗しました', 'err')
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    const r = await db.call('deleteReservation', deleting.reservation_id)
    setBusy(false)
    setDeleting(null)
    if (r.ok) {
      toast.show('予約を削除しました')
      load()
    } else {
      toast.show((r as { error: string }).error || '削除に失敗しました', 'err')
    }
  }

  return (
    <div className="reservation-tab">
      {/* 既存顧客名のサジェスト（入力中に候補から選べる。ローマ字/かな入力の手間軽減） */}
      <datalist id="res-known-customers">
        {knownNames.map((n) => <option key={n} value={n} />)}
      </datalist>

      {/* お客様が予約ページから送ってきた申込。承認するまで枠は押さえたままになる */}
      {isAdmin && pending.length > 0 && (
        <div className="card pending-card">
          <div className="pending-head">
            <span className="pending-title">お客様からの申込</span>
            <span className="pending-count">{pending.length}件</span>
          </div>
          <div className="pending-list">
            {pending.map((p) => {
              const bl = blMatches.get(p.customerName) || []
              const busy = pendingBusy === p.id
              return (
                <div key={p.id} className="pending-item">
                  <div className="pending-item-main">
                    <div className="pending-when">
                      {fmtDateTime(p.startsAt)}
                      {p.slotNo && <span className="pending-slot">枠{p.slotNo}</span>}
                    </div>
                    <div className="pending-who">
                      <strong>{p.customerName || '（名前なし）'}</strong>
                      <span className="muted"> → {p.castName || 'フリー'}</span>
                    </div>
                    <div className="pending-meta muted small">
                      申込 {fmtDateTime(p.createdAt)} ／ 予約番号 {p.publicCode}
                      {p.contactEmail && <> ／ {p.contactEmail}</>}
                    </div>
                    {p.note && <div className="pending-note">{p.note}</div>}
                    {bl.length > 0 && (
                      <div className="pending-bl">
                        <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                        出禁リストに載っています{bl[0].reason ? `（${bl[0].reason}）` : ''}
                      </div>
                    )}
                  </div>
                  <div className="pending-actions">
                    <button
                      className="btn-primary pending-approve"
                      disabled={busy}
                      onClick={() => approvePending(p)}
                    >
                      <Check size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                      {busy ? '...' : '承認'}
                    </button>
                    <button
                      className="btn-secondary pending-reject"
                      disabled={busy}
                      onClick={() => { setRejecting(p); setRejectNote('') }}
                    >
                      <Close size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                      却下
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="card filter-card">
        <div className="filter-actions">
          <button
            className={`btn-pill ${castFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCastFilter('all')}
          >
            すべて
          </button>
          <button
            className={`btn-pill ${castFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setCastFilter('mine')}
          >
            自分のみ
          </button>
          <button className="btn-secondary" onClick={reloadAll} disabled={loading}>
            {loading ? '...' : '更新'}
          </button>
        </div>
      </div>

      <div className="card avail-card">
        <div className="avail-head">
          <Clock size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          各キャストの次に入れる時刻（進行中の接客・予約 ＋{INTERVAL_MIN}分インターバルを考慮）
        </div>
        {castAvailability.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>キャスト情報を読み込み中...</p>
        ) : (
          <div className="avail-list">
            {castAvailability.map((a) => (
              <div key={a.cast} className="avail-row">
                <span className="avail-cast">{a.cast}</span>
                {a.busyNow ? (
                  <>
                    <span className="avail-time">{fmtBizTime(a.availMs)}〜</span>
                    <span className="avail-meta muted">{a.blockedBy}</span>
                  </>
                ) : (
                  <span className="avail-time avail-free">今すぐOK</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <GanttTimeline
        sessions={activeSessions}
        reservations={list}
        highlightCast={castName}
      />

      <button className="btn-add-top" onClick={openAdd}>＋ 予約を追加</button>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !filtered.length && <div className="card empty-state">該当する予約はありません</div>}

      {filtered.map((r) => (
        <div key={r.reservation_id} className={`res-card${r.キャンセル済 ? ' is-cancelled' : ''}`}>
          <div className="res-header">
            {r.status === 'pending' && <span className="badge badge-pending">申込中</span>}
            {r.status === 'rejected' && <span className="badge badge-rejected">お断り</span>}
            {r.source === 'customer' && r.status === 'confirmed' && (
              <span className="badge badge-from-customer">お客様申込</span>
            )}
            {r.converted && <span className="badge badge-converted">接客開始済み</span>}
            {r.キャンセル済 && <span className="badge badge-cancelled">キャンセル済</span>}
            <span className="res-datetime">{fmtDateTime(r.予約日時)}</span>
          </div>
          <div className="res-body">
            <div className="res-row">
              <span className="muted">キャスト</span>
              <span>{r.キャスト名 || 'フリー（指名なし）'}</span>
            </div>
            <div className="res-row">
              <span className="muted">顧客</span>
              <span>{r.顧客名 || '—'}</span>
            </div>
            <div className="res-row">
              <span className="muted">対応時間</span>
              <span>{durationLabel(r.予約時間 || 60)}</span>
            </div>
            {(() => {
              const startMs = new Date(r.予約日時).getTime()
              if (isNaN(startMs)) return null
              const endMs = startMs + (r.予約時間 || 60) * 60 * 1000
              const availMs = endMs + 10 * 60 * 1000
              return (
                <div className="res-row">
                  <span className="muted">時間</span>
                  <span>
                    {fmtBizTime(startMs)} 〜 {fmtBizTime(endMs)}
                    <span className="res-avail">（次対応可能：{fmtBizTime(availMs)}〜）</span>
                  </span>
                </div>
              )
            })()}
            {r.ルーム && (
              <div className="res-row">
                <span className="muted">ルーム</span>
                <span>{r.ルーム}</span>
              </div>
            )}
            {r.予約金額 > 0 && (
              <div className="res-row">
                <span className="muted">金額</span>
                <span className="c-gold">{fmtCurrency(r.予約金額)}</span>
              </div>
            )}
            {r.備考 && (
              <div className="res-row">
                <span className="muted">備考</span>
                <span>{r.備考}</span>
              </div>
            )}
          </div>
          <div className="res-actions">
            {onStartSession && !r.converted && !r.キャンセル済 && (
              <button
                className="btn-res-start"
                onClick={() => onStartSession({ customerName: r.顧客名, room: r.ルーム, reservationId: r.reservation_id })}
              >
                <Play size={12} />
                接客開始
              </button>
            )}
            <button className="btn-secondary" onClick={() => openEdit(r)}>編集</button>
            <button className="btn-danger" onClick={() => setDeleting(r)}>削除</button>
          </div>
        </div>
      ))}

      {formOpen && (
        <Modal onClose={() => !busy && closeForm()}>
          <h3>{form.reservation_id ? '予約を編集' : '予約を追加'}</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">キャスト</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.castName}
                  onChange={(e) => setForm((f) => ({ ...f, castName: e.target.value }))}
                >
                  <option value="">フリー（指名なし）</option>
                  {casts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">ルーム（任意）</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.room}
                  onChange={(e) => setForm((f) => ({ ...f, room: e.target.value }))}
                >
                  <option value="">—</option>
                  {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* 全キャストの次の予約可能時間（モーダル内でも見えるように） */}
          <div className="res-modal-avail">
            <div className="res-modal-avail-head">
              <Clock size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
              各キャストの次の予約可能時間（タップでキャスト選択）
            </div>
            <div className="res-modal-avail-grid">
              {castAvailability.map((a) => (
                <button
                  type="button"
                  key={a.cast}
                  className={`res-modal-avail-chip${form.castName === a.cast ? ' active' : ''}`}
                  onClick={() => setForm((f) => ({ ...f, castName: a.cast }))}
                  title={a.busyNow ? a.blockedBy : '今すぐ対応可能'}
                >
                  <span className="chip-cast">{a.cast}</span>
                  <span className={`chip-time${a.busyNow ? '' : ' free'}`}>
                    {a.busyNow ? `${fmtBizTime(a.availMs)}〜` : '今すぐOK'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">顧客名（複数名可）</label>
            <div className="customer-names">
              {form.customerNames.map((n, i) => {
                const nm = n.trim()
                const summary = nm ? custSummaries.get(nm) : undefined
                return (
                  <div key={i}>
                    <div className="customer-name-row">
                      <input
                        type="text"
                        className="form-input"
                        placeholder={i === 0 ? '顧客名' : `お連れ様 ${i + 1}`}
                        value={n}
                        onChange={(e) => updateCustName(i, e.target.value)}
                        autoComplete="off"
                        list="res-known-customers"
                      />
                      {i === form.customerNames.length - 1 && form.customerNames.length < 10 ? (
                        <button
                          type="button"
                          className="btn-cust-add"
                          onClick={addCustName}
                          title="お連れ様を追加"
                          aria-label="お連れ様を追加"
                        >
                          <Plus size={18} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn-cust-rm"
                          onClick={() => removeCustName(i)}
                          title="この欄を削除"
                          aria-label="この欄を削除"
                        >
                          <Minus size={18} />
                        </button>
                      )}
                    </div>
                    {summary && (
                      <p className={`res-cust-hint ${summary.visitCount > 0 ? 'is-repeat' : 'is-new'}`}>
                        {summary.visitCount > 0 ? (
                          <>
                            来店 <strong>{summary.visitCount}回</strong>
                            {summary.lastVisitAt && <>（最終: {fmtDate(summary.lastVisitAt)}）</>}
                            {summary.lastCast && <> ｜ 最終対応: {summary.lastCast}</>}
                          </>
                        ) : (
                          <>
                            <Sparkles size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />
                            来店記録なし（新規のお客様）
                          </>
                        )}
                        {summary.cancelledResCount > 0 && (
                          <> ｜ 予約キャンセル歴 {summary.cancelledResCount}回</>
                        )}
                      </p>
                    )}
                    {summary && summary.visits.length > 0 && (
                      <div className="res-visit-list">
                        {summary.visits.map((v, vi) => (
                          <span key={vi} className="res-visit-chip">
                            {fmtDate(v.visitedAt)} {v.cast || '担当不明'}
                          </span>
                        ))}
                        {summary.visitCount > summary.visits.length && (
                          <span className="res-visit-more">ほか{summary.visitCount - summary.visits.length}回</span>
                        )}
                      </div>
                    )}
                    {nm && (blMatches.get(nm)?.length ?? 0) > 0 && (
                      <p className="res-bl-hint">
                        <AlertTriangle size={12} style={{ verticalAlign: '-2px', marginRight: 4 }} />
                        出禁（ブラックリスト）該当:
                        {blMatches.get(nm)!.map((m) => ` ${m.name}${m.reason ? `（${m.reason}）` : ''}`).join('、')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">予約日</label>
              <input
                type="date"
                className="form-input"
                value={dateVal}
                onChange={(e) => setDateTime(e.target.value, timeShown)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">{timeLabel(timeStep)}</label>
              <input
                type="time"
                step={timeStep}
                className="form-input"
                value={timeShown}
                onChange={(e) => setDateTime(dateVal, e.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="btn-now"
            onClick={() => {
              const [d = '', t = ''] = nowJstInput(timeStep).split('T')
              setDateTime(d, t)
            }}
          >
            <Clock size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
            現在時刻を入力
          </button>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">料金種別</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.pricingKey}
                  onChange={(e) => setForm((f) => ({ ...f, pricingKey: e.target.value }))}
                >
                  {pricing.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({fmtCurrency(p.price)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">対応時間</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={form.durationMin}
                  onChange={(e) => setForm((f) => ({ ...f, durationMin: Number(e.target.value) }))}
                >
                  {DURATION_OPTIONS.map((m) => (
                    <option key={m} value={m}>{durationLabel(m)}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
          <div className="res-price-preview">
            予約金額: <strong>{calcPrice > 0 ? fmtCurrency(calcPrice) : '—'}</strong>
            <span className="muted"> ／ 対応時間 {durationLabel(form.durationMin)}</span>
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="備考（任意）"
            />
          </div>
          <div className="form-group">
            <label className="res-cancel-check">
              <input
                type="checkbox"
                checked={form.cancelled}
                onChange={(e) => setForm((f) => ({ ...f, cancelled: e.target.checked }))}
              />
              予約キャンセル済（キャストが埋まっていた等。履歴として残ります）
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={closeForm} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={save} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 出禁（ブラックリスト）該当時の確認 */}
      {blConfirm && (
        <Modal onClose={() => !busy && setBlConfirm(null)}>
          <h3>
            <AlertTriangle size={18} style={{ verticalAlign: '-3px', marginRight: 6, color: 'var(--red)' }} />
            出禁のお客様が含まれています
          </h3>
          <p className="muted">以下の顧客がブラックリストに登録されています:</p>
          <ul className="bl-list">
            {blConfirm.map((m) => (
              <li key={m.name}>
                <strong>{m.name}</strong>
                {m.reason && <span className="muted">（{m.reason}）</span>}
              </li>
            ))}
          </ul>
          <p className="muted">この予約は保存しないことをおすすめします。それでも保存しますか？</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setBlConfirm(null)} disabled={busy}>
              保存しない
            </button>
            <button className="btn-danger" onClick={doSave} disabled={busy}>
              {busy ? '保存中...' : 'それでも保存する'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>予約を削除しますか？</h3>
          <p className="muted">{deleting.キャスト名 || 'フリー（指名なし）'} / {deleting.顧客名 || '（顧客名なし）'} / {fmtDateTime(deleting.予約日時)}</p>
          <p className="muted">この操作は取り消せません。</p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>
              キャンセル
            </button>
            <button className="btn-danger" onClick={confirmDelete} disabled={busy}>
              {busy ? '削除中...' : '削除する'}
            </button>
          </div>
        </Modal>
      )}

      {rejecting && (
        <Modal onClose={() => !pendingBusy && setRejecting(null)}>
          <h3>申込をお断りする</h3>
          <p className="muted">
            {rejecting.customerName}様 / {rejecting.castName || 'フリー'} / {fmtDateTime(rejecting.startsAt)}
          </p>
          <div className="form-group">
            <label className="form-label">お客様に伝える理由（任意）</label>
            <input
              type="text"
              className="form-input"
              value={rejectNote}
              onChange={(e) => setRejectNote(e.target.value)}
              placeholder="例: 満席のため / 当日は営業をお休みします"
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              空欄でも構いません。書いた内容はお客様の予約状況ページに表示されます。
            </p>
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setRejecting(null)} disabled={!!pendingBusy}>
              やめる
            </button>
            <button className="btn-danger" onClick={rejectPending} disabled={!!pendingBusy}>
              {pendingBusy ? '処理中...' : 'お断りする'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
