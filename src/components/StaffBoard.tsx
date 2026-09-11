// スタッフの受付ボード
//
// 電話やチャットで「今から入れますか？」と聞かれたときに、この1画面で答えられるようにする。
// 見たいのは 3 つだけ:
//   ・今日出ているのは誰か（お休みの人は出さない）
//   ・その人は何時から受けられるか（対応中・予約・休憩ぶんを引いたあと）
//   ・その人に今どのお客様の予約が付いているか
//
// 空き時刻の数え方は予約タブ（ReservationTab の castAvailability）と同じで、
// そこに受付日で止めた枠＝休憩を足している。

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  db,
  getDailyNote,
  getGuideMacro,
  getRecruitTemplate,
  getReservationDays,
  listCastRoster,
  renderGuideMacro,
  saveDailyNote,
  saveReservationDay,
  DEFAULT_GUIDE_MACRO,
  DEFAULT_RECRUIT_TEMPLATE,
  DEFAULT_SLOT_TIMES,
  RECRUIT_ATTRS_TOKEN,
  RECRUIT_SHORTEST_TOKEN,
  type CustomerSummary,
  type MacroTarget,
  type DailyNote,
  type ReservationDay,
  type ReservationShape,
  type SessionShape,
} from '../lib/db'
import { useActiveSessions, useRealtimeReservations } from '../lib/useRealtimeSessions'
import { fmtBizTime, fmtDate, fmtGil, jstBusinessDate } from '../lib/format'
import { Clock, Calendar, RefreshCw, AlertTriangle, Check, Play, Search, Home as HomeIcon, Crown, Edit } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import type { RouteId } from './Sidebar'
import './StaffBoard.css'

interface RoomInfo {
  name: string
  vip: boolean
}

interface BlMatch {
  name: string
  reason?: string
}

// 接客と接客のあいだに置く片付けの時間
const INTERVAL_MIN = 10
// 止めた枠は「1組ぶん」埋まる。公開予約ページと同じ 60分＋インターバル で数える
const SLOT_HOLD_MIN = 70

interface BreakSpan {
  slotNo: number
  startMs: number
  endMs: number
}

interface BoardRow {
  castId: string
  cast: string
  attribute: string
  availMs: number
  busyNow: boolean
  blockedBy: string
  active: SessionShape | null
  reservations: ReservationShape[]
  breaks: BreakSpan[]
}

// 受付日の枠時刻（"23:20"）を、その営業日の実時刻に直す。
// 4時より前は翌日にまたぐ、という区切りは DB の slot_start_at と揃えてある
function slotStartMs(businessDate: string, hhmm: string): number {
  const [y, m, d] = businessDate.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  if ([y, m, d, hh, mm].some((n) => !Number.isFinite(n))) return NaN
  return Date.UTC(y, m - 1, d + (hh < 4 ? 1 : 0), hh, mm) - 9 * 60 * 60 * 1000
}

function bizDateLabel(businessDate: string): string {
  const [, m, d] = businessDate.split('-')
  return `${Number(m)}/${Number(d)} 営業日`
}

export default function StaffBoard({ onNavigate }: { onNavigate: (id: RouteId) => void }) {
  const [reservations, setReservations] = useState<ReservationShape[]>([])
  const [day, setDay] = useState<ReservationDay | null>(null)
  const [roster, setRoster] = useState<Array<{ id: string; name: string; role: string; attribute: string }>>([])
  const [template, setTemplate] = useState(DEFAULT_RECRUIT_TEMPLATE)
  const [rooms, setRooms] = useState<RoomInfo[]>([])
  const [macro, setMacro] = useState(DEFAULT_GUIDE_MACRO)
  const [prices, setPrices] = useState({ normal: 0, vip: 0, option: 0 })
  const [note, setNote] = useState<DailyNote>({ body: '', updatedByName: '', updatedAt: null })
  const [startFor, setStartFor] = useState<BoardRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  const { sessions: activeSessions } = useActiveSessions()
  const toast = useToast()

  // 営業日は 4:00 区切り。深夜1時に開いても「昨日の営業日」を見せる。
  // tick は 4:00 をまたいだときに日付を繰り上げるためだけに見ている
  const businessDate = useMemo(() => {
    void tick
    return jstBusinessDate()
  }, [tick])

  const load = useCallback(async () => {
    setErr('')
    const bd = jstBusinessDate()
    const [resList, days, castList, tpl, roomRes, dayNote, macroTpl, priceRes] = await Promise.all([
      db.call<ReservationShape[]>('getReservations'),
      getReservationDays(bd, bd).catch(() => [] as ReservationDay[]),
      listCastRoster().catch(() => []),
      getRecruitTemplate().catch(() => DEFAULT_RECRUIT_TEMPLATE),
      db.call<{ roomsData: Array<{ name: string; vip: number }> }>('getCastsAndRooms'),
      getDailyNote(bd).catch(() => ({ body: '', updatedByName: '', updatedAt: null })),
      getGuideMacro().catch(() => DEFAULT_GUIDE_MACRO),
      db.call<Array<{ key: string; price: number }>>('getPricing'),
    ])
    if (resList.ok) setReservations(resList.data || [])
    else setErr(resList.error)
    setDay(days[0] ?? null)
    setRoster(castList)
    setTemplate(tpl)
    if (roomRes.ok) {
      setRooms((roomRes.data.roomsData || []).map((r) => ({ name: r.name, vip: r.vip === 1 })))
    }
    setNote(dayNote)
    setMacro(macroTpl)
    if (priceRes.ok) {
      const byKey = new Map((priceRes.data || []).map((p) => [p.key, Number(p.price) || 0]))
      setPrices({
        normal: byKey.get('normal') ?? 0,
        vip: byKey.get('vip') ?? 0,
        option: byKey.get('option') ?? 0,
      })
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useRealtimeReservations(load)

  // 「何時から受けられるか」は時間が経つだけで変わるので、1分ごとに引き直す
  useEffect(() => {
    const t = setInterval(() => setTick((x) => x + 1), 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // 今日の予約だけ。キャンセルと却下は受付の判断に要らないので落とす
  const todayReservations = useMemo(
    () =>
      reservations.filter(
        (r) =>
          !r.キャンセル済 &&
          r.status !== 'rejected' &&
          jstBusinessDate(r.予約日時) === businessDate,
      ),
    [reservations, businessDate],
  )

  const castsOnDuty = useMemo(() => {
    const casts = roster.filter((c) => c.role === 'cast')
    if (!day) return casts                                  // 受付日が未登録の日は全員を出す
    const working = new Set(day.castIds)
    return casts.filter((c) => working.has(c.id))
  }, [roster, day])

  const castsOff = useMemo(() => {
    if (!day) return []
    const working = new Set(day.castIds)
    return roster.filter((c) => c.role === 'cast' && !working.has(c.id))
  }, [roster, day])

  const rows: BoardRow[] = useMemo(() => {
    void tick
    const now = Date.now()
    const INTERVAL_MS = INTERVAL_MIN * 60 * 1000

    return castsOnDuty
      .map((c) => {
        const blocks: Array<{ start: number; end: number; label: string }> = []

        // 対応中は、終わる予定＋片付けまで塞がっている
        const active = activeSessions.find((s) => s.対応者 === c.name) ?? null
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

        const mine = todayReservations
          .filter((r) => r.キャスト名 === c.name)
          .sort((a, b) => new Date(a.予約日時).getTime() - new Date(b.予約日時).getTime())

        for (const r of mine) {
          if (r.converted) continue                          // すでに接客に変わったぶんは対応中が拾う
          const start = new Date(r.予約日時).getTime()
          if (isNaN(start)) continue
          const end = start + (r.予約時間 || 60) * 60 * 1000 + INTERVAL_MS
          if (end <= now) continue                           // 終わった予約は空きの判断に関係ない
          blocks.push({
            start,
            end,
            label: `予約${r.顧客名 ? `（${r.顧客名}様）` : ''}`,
          })
        }

        // 受付日で止めた枠 = その時間は受けない（休憩・私用など）
        const breaks: BreakSpan[] = []
        for (const b of day?.blocks ?? []) {
          if (b.castId !== c.id) continue
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
          castId: c.id,
          cast: c.name,
          attribute: c.attribute,
          availMs,
          busyNow: availMs > now,
          blockedBy,
          active,
          reservations: mine,
          breaks,
        }
      })
      .sort((a, b) => a.availMs - b.availMs || a.cast.localeCompare(b.cast, 'ja'))
  }, [castsOnDuty, activeSessions, todayReservations, day, businessDate, tick])

  const freeNow = rows.filter((r) => !r.busyNow).length
  const pendingCount = todayReservations.filter((r) => r.status === 'pending').length

  // PT募集に貼る文面。誰か空いていれば「即ご案内可能」、
  // 全員埋まっていれば一番早く空く時刻を入れる
  const recruit = useMemo(() => {
    if (!rows.length) return null
    const soonest = rows[0]
    const shortest = soonest.busyNow ? `${fmtBizTime(soonest.availMs)}～` : '即ご案内可能'
    // 属性は在店している人ぶんを名前順で。同じ属性はひとつにまとめる
    const attrs = [
      ...new Set(
        [...rows]
          .sort((a, b) => a.cast.localeCompare(b.cast, 'ja'))
          .map((r) => r.attribute.trim())
          .filter(Boolean),
      ),
    ]
    return {
      shortest,
      attrs,
      text: template
        .split(RECRUIT_SHORTEST_TOKEN)
        .join(shortest)
        .split(RECRUIT_ATTRS_TOKEN)
        .join(attrs.join('・')),
    }
  }, [rows, template])

  // ルームの空き。お客様をどこへ通すかは受付がその場で決めるので、
  // 使用中なら誰がいつまで使っているかまで出す
  const roomRows = useMemo(() => {
    void tick
    return rooms.map((r) => {
      const using = activeSessions.find((s) => s.ルーム === r.name) ?? null
      return { ...r, using }
    })
  }, [rooms, activeSessions, tick])

  const freeRooms = roomRows.filter((r) => !r.using).length

  // 受付日を作る＝その日の出勤表を作る。Web受付は開かない（is_open は false）
  async function createToday() {
    setBusy(true)
    try {
      await saveReservationDay({
        businessDate,
        isOpen: false,
        acceptFrom: null,
        acceptUntil: null,
        slotTimes: [...DEFAULT_SLOT_TIMES],
        note: '',
        castIds: roster.filter((c) => c.role === 'cast').map((c) => c.id),
        blocks: [],
      })
      toast.show('今日の出勤表を作りました。お休みの人は各カードから外せます')
      await load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // 出勤 ⇔ お休み。受付日の出勤キャストを入れ替える
  async function toggleDuty(castId: string, working: boolean) {
    if (!day) return
    const next = working
      ? [...new Set([...day.castIds, castId])]
      : day.castIds.filter((id) => id !== castId)
    setBusy(true)
    try {
      await saveReservationDay({ ...day, castIds: next })
      await load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function saveNote(body: string) {
    setBusy(true)
    try {
      await saveDailyNote(businessDate, body)
      setNote(await getDailyNote(businessDate))
      toast.show('申し送りを保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="board">
      <div className="board-head">
        <div className="board-head-main">
          <span className="board-date">
            <Calendar size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
            {bizDateLabel(businessDate)}
          </span>
          {!loading && (
            <span className="board-summary muted">
              出勤 {rows.length}人 ／ 今すぐ受けられる {freeNow}人
            </span>
          )}
        </div>
        <button type="button" className="btn-secondary board-reload" onClick={load}>
          <RefreshCw size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          更新
        </button>
      </div>

      {err && <p className="err">{err}</p>}

      {pendingCount > 0 && (
        <button type="button" className="board-pending" onClick={() => onNavigate('reservation')}>
          <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          承認待ちの申込が {pendingCount}件あります。予約タブで承認してください。
        </button>
      )}

      {!day && !loading && (
        <div className="board-note">
          <p className="muted" style={{ margin: 0 }}>
            今日の出勤表がまだ無いので、全キャストを出しています。
            作るとお休みの人を外せるようになります（Web受付は開きません）。
          </p>
          <button type="button" className="btn-secondary board-note-btn" onClick={createToday} disabled={busy}>
            {busy ? '作成中...' : '今日の出勤表を作る'}
          </button>
        </div>
      )}

      {recruit && <RecruitCard shortest={recruit.shortest} attrs={recruit.attrs} text={recruit.text} />}

      <MacroCard template={macro} prices={prices} />

      <div className="board-pair">
        <RoomStrip rooms={roomRows} freeCount={freeRooms} />
        <CustomerCheck />
      </div>

      {loading && <p className="muted">読み込み中...</p>}

      {!loading && rows.length === 0 && (
        <p className="muted">今日の出勤に登録されているキャストがいません。</p>
      )}

      <div className="board-grid">
        {rows.map((r) => (
          <CastCard
            key={r.castId}
            row={r}
            canRest={!!day}
            busy={busy}
            onStart={() => setStartFor(r)}
            onRest={() => toggleDuty(r.castId, false)}
          />
        ))}
      </div>

      {castsOff.length > 0 && (
        <div className="board-off muted">
          本日お休み:{' '}
          {castsOff.map((c) => (
            <span key={c.id} className="board-off-item">
              {c.name}
              {day && (
                <button
                  type="button"
                  className="board-off-back"
                  onClick={() => toggleDuty(c.id, true)}
                  disabled={busy}
                >
                  出勤に戻す
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      <HandoverNote note={note} busy={busy} onSave={saveNote} />

      {startFor && (
        <StartForCastModal
          row={startFor}
          rooms={roomRows}
          onClose={() => setStartFor(null)}
          onStarted={() => {
            setStartFor(null)
            load()
          }}
        />
      )}

      {toast.element}
    </div>
  )
}

// お客様への説明マクロ。FF14 のマクロ欄にそのまま貼れる形で写す。
// パーティ向けと tell 向けは宛先だけの違いなので、同じひな形から両方作る
const MACRO_TARGETS: Array<{ id: MacroTarget; label: string }> = [
  { id: '/p', label: 'パーティ' },
  { id: '/tell <t>', label: 'tell' },
]

function MacroCard({
  template,
  prices,
}: {
  template: string
  prices: { normal: number; vip: number; option: number }
}) {
  const [target, setTarget] = useState<MacroTarget>('/p')
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  const text = useMemo(
    () => renderGuideMacro(template, target, prices),
    [template, target, prices],
  )
  const lines = text.split('\n').length

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show('コピーできませんでした。文面を選んでコピーしてください', 'err')
    }
  }

  return (
    <div className="board-recruit">
      <div className="board-recruit-head">
        <span className="board-recruit-title">案内マクロ</span>
        <span className="board-macro-seg">
          {MACRO_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`board-macro-tab ${target === t.id ? 'active' : ''}`}
              onClick={() => setTarget(t.id)}
            >
              {t.label}
            </button>
          ))}
        </span>
        <span className="board-recruit-meta muted">
          通常 {fmtGil(prices.normal)} ／ VIP {fmtGil(prices.vip)} ／ オプション {fmtGil(prices.option)}
          {/* FF14 のマクロは15行まで。料金の書き足しで溢れないよう行数も出す */}
          {` ／ ${lines}行`}
        </span>
        <button type="button" className="btn-secondary board-recruit-copy" onClick={copy}>
          {copied ? <Check size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} /> : null}
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <button type="button" className="board-macro-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '文面を隠す' : '文面を見る'}
      </button>
      {open && <pre className="board-macro-text">{text}</pre>}
      {toast.element}
    </div>
  )
}

// ルームの空き。受付は「誰が空いてるか」の次に「どの部屋か」を聞かれる
function RoomStrip({
  rooms,
  freeCount,
}: {
  rooms: Array<RoomInfo & { using: SessionShape | null }>
  freeCount: number
}) {
  return (
    <div className="board-panel">
      <div className="board-panel-head">
        <HomeIcon size={14} />
        <span className="board-panel-title">ルーム</span>
        <span className="muted board-panel-meta">空き {freeCount} / {rooms.length}</span>
      </div>
      {rooms.length === 0 ? (
        <p className="muted small" style={{ margin: 0 }}>ルームが登録されていません。</p>
      ) : (
        <div className="board-rooms">
          {rooms.map((r) => (
            <div key={r.name} className={`board-room ${r.using ? 'used' : 'free'}`}>
              <span className="board-room-name">
                {r.vip && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
                {r.name}
              </span>
              {r.using ? (
                <span className="board-room-state">
                  {r.using.対応者} 〜{fmtBizTime(r.using.対応終了時間)}
                </span>
              ) : (
                <span className="board-room-state free">空き</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// 飛び込みのお客様を通す前の確認。出禁かどうかと、常連かどうかを1か所で見る。
// 予約を入れるときにしか走っていなかったチェックを、受付の手元に置く
function CustomerCheck() {
  const [name, setName] = useState('')
  const [bl, setBl] = useState<BlMatch[]>([])
  const [summary, setSummary] = useState<CustomerSummary | null>(null)
  const [checking, setChecking] = useState(false)

  useEffect(() => {
    const q = name.trim()
    if (!q) {
      setBl([])
      setSummary(null)
      setChecking(false)
      return
    }
    setChecking(true)
    const t = setTimeout(async () => {
      const [b, s] = await Promise.all([
        db.call<BlMatch[]>('checkBlacklist', q),
        db.call<CustomerSummary>('getCustomerSummary', q),
      ])
      setBl(b.ok ? b.data || [] : [])
      setSummary(s.ok ? s.data : null)
      setChecking(false)
    }, 400)
    return () => clearTimeout(t)
  }, [name])

  const q = name.trim()

  return (
    <div className="board-panel">
      <div className="board-panel-head">
        <Search size={14} />
        <span className="board-panel-title">お客様チェック</span>
      </div>
      <input
        type="text"
        className="form-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="お名前を入れると出禁・来店歴が出ます"
        autoComplete="off"
      />
      {q && checking && <p className="muted small board-check-line">確認中...</p>}
      {q && !checking && (
        <>
          {bl.length > 0 ? (
            <div className="board-check-bl">
              <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              出禁に一致します（{bl.map((b) => b.name).join('、')}）
              {bl.some((b) => b.reason) && (
                <div className="board-check-reason">
                  {bl.map((b) => b.reason).filter(Boolean).join(' / ')}
                </div>
              )}
            </div>
          ) : (
            <p className="c-green small board-check-line">出禁には当たりません。</p>
          )}
          {summary && (
            <p className="muted small board-check-line">
              {summary.visitCount > 0
                ? `来店 ${summary.visitCount}回 ／ 最終 ${fmtDate(summary.lastVisitAt)}${
                    summary.lastCast ? `（${summary.lastCast}）` : ''
                  }`
                : '来店歴はありません（初めてのお客様）'}
              {summary.cancelledResCount > 0 && ` ／ 予約キャンセル ${summary.cancelledResCount}回`}
            </p>
          )}
        </>
      )}
    </div>
  )
}

// その営業日の連絡帳。書いた人と時刻を残す
function HandoverNote({
  note,
  busy,
  onSave,
}: {
  note: DailyNote
  busy: boolean
  onSave: (body: string) => void
}) {
  const [body, setBody] = useState(note.body)
  const [editing, setEditing] = useState(false)

  // 他の端末で書き換えられたら追随する（編集中は邪魔しない）
  useEffect(() => {
    if (!editing) setBody(note.body)
  }, [note.body, editing])

  return (
    <div className="board-panel">
      <div className="board-panel-head">
        <Edit size={14} />
        <span className="board-panel-title">申し送り</span>
        {note.updatedByName && (
          <span className="muted board-panel-meta">
            最終更新 {note.updatedByName}
          </span>
        )}
      </div>
      <textarea
        className="form-input board-note-area"
        rows={3}
        value={body}
        onFocus={() => setEditing(true)}
        onChange={(e) => setBody(e.target.value)}
        placeholder="例）22時ごろ ○○様 来店予定 ／ VIP-2 の調子が悪い"
      />
      {body !== note.body && (
        <div className="board-note-actions">
          <button
            className="btn-primary"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              onSave(body)
            }}
          >
            {busy ? '保存中...' : '保存'}
          </button>
          <button
            className="btn-secondary"
            disabled={busy}
            onClick={() => {
              setEditing(false)
              setBody(note.body)
            }}
          >
            元に戻す
          </button>
        </div>
      )}
    </div>
  )
}

// 受付がお客様を部屋へ通したときに、そのキャストの接客をここから始める。
// startSession はキャスト名を引数に取るので、本人でなくても開始できる
function StartForCastModal({
  row,
  rooms,
  onClose,
  onStarted,
}: {
  row: BoardRow
  rooms: Array<RoomInfo & { using: SessionShape | null }>
  onClose: () => void
  onStarted: () => void
}) {
  // その人に付いている、まだ接客に変わっていない予約。あればそこから始める
  const presetRes = row.reservations.find((r) => !r.converted) ?? null

  const [room, setRoom] = useState(rooms.find((r) => !r.using)?.name || '')
  const [customer, setCustomer] = useState(presetRes?.顧客名 || '')
  const [slots, setSlots] = useState(
    presetRes ? Math.max(1, Math.round((presetRes.予約時間 || 60) / 30)) : 2,  // 30分 = 1コマ
  )
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [bl, setBl] = useState<BlMatch[]>([])
  const toast = useToast()

  const roomInfo = rooms.find((r) => r.name === room)
  const serviceType = roomInfo?.vip ? 'vip' : 'normal'
  const names = customer.split(/[,、]/).map((s) => s.trim()).filter(Boolean)

  // 予約から始めたときは、その予約を接客に変えてタイムラインから消す。
  // お名前を書き換えたなら別のお客様なので紐付けない
  const linkedReservationId =
    presetRes && customer.trim() === presetRes.顧客名.trim() ? presetRes.reservation_id : undefined

  async function submit(skipBlCheck = false) {
    if (!room) {
      toast.show('ルームを選んでください', 'err')
      return
    }
    if (!names.length) {
      toast.show('お客様のお名前を入れてください', 'err')
      return
    }
    setBusy(true)
    try {
      const avail = await db.call<{ available: boolean; usedBy?: string }>('checkRoomAvailability', room)
      if (avail.ok && !avail.data.available) {
        toast.show(`「${room}」は ${avail.data.usedBy || '他のキャスト'} が使用中です`, 'err')
        return
      }
      if (!skipBlCheck) {
        const hits = await Promise.all(names.map((n) => db.call<BlMatch[]>('checkBlacklist', n)))
        const found = hits.flatMap((h) => (h.ok ? h.data || [] : []))
        if (found.length) {
          setBl(found)
          return
        }
      }
      const r = await db.call('startSession', {
        castName: row.cast,
        room,
        customerNames: names,
        note: note.trim(),
        serviceType,
        presetSlots: slots,
        reservationId: linkedReservationId,
      })
      if (r.ok) {
        toast.show(`${row.cast} の応対を開始しました`)
        onStarted()
      } else {
        toast.show((r as { error: string }).error || '開始に失敗しました', 'err')
      }
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={() => !busy && onClose()}>
      <h3>{row.cast} の応対を開始</h3>
      <div className="form-group">
        <label className="form-label">ルーム</label>
        <div className="select-wrap">
          <select className="form-select" value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">選んでください</option>
            {/* VIP かどうかは下の「今の選択」に出るので、選択肢には付け足さない
                （ルーム名にすでに VIP と入っている店だと二重になる） */}
            {rooms.map((r) => (
              <option key={r.name} value={r.name} disabled={!!r.using}>
                {r.name}{r.using ? ` — ${r.using.対応者} 使用中` : ''}
              </option>
            ))}
          </select>
        </div>
        <p className="muted" style={{ fontSize: '0.85em', margin: '6px 2px 0' }}>
          料金の種別はルームで決まります（今の選択: {serviceType === 'vip' ? 'VIP' : '通常'}）。
        </p>
      </div>
      <div className="form-group">
        <label className="form-label">お客様のお名前</label>
        <input
          type="text"
          className="form-input"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
          placeholder="複数名は 、 か , で区切ります"
          autoComplete="off"
        />
        {presetRes && (
          <p className="muted" style={{ fontSize: '0.85em', margin: '6px 2px 0' }}>
            {linkedReservationId
              ? `${fmtBizTime(presetRes.予約日時)} の予約から開始します（開始すると予約は接客に変わります）`
              : 'お名前を変えたので、予約とは紐付けずに開始します'}
          </p>
        )}
      </div>
      <div className="form-group">
        <label className="form-label">予定時間</label>
        <div className="board-slot-btns">
          {[1, 2, 3, 4].map((s) => (
            <button
              key={s}
              type="button"
              className={`btn-secondary ${slots === s ? 'active' : ''}`}
              onClick={() => setSlots(s)}
            >
              {s * 30}分
            </button>
          ))}
        </div>
      </div>
      <div className="form-group">
        <label className="form-label">備考</label>
        <input
          type="text"
          className="form-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      {bl.length > 0 && (
        <div className="board-check-bl">
          <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 6 }} />
          出禁に一致します（{bl.map((b) => b.name).join('、')}）。それでも開始しますか？
        </div>
      )}

      <div className="modal-actions">
        <button className="btn-secondary" onClick={onClose} disabled={busy}>キャンセル</button>
        <button
          className="btn-primary"
          style={{ width: 'auto' }}
          onClick={() => submit(bl.length > 0)}
          disabled={busy}
        >
          {busy ? '開始中...' : bl.length > 0 ? 'それでも開始する' : '開始する'}
        </button>
      </div>
      {toast.element}
    </Modal>
  )
}

// そのまま PT募集に貼れる文面。中身は時間とともに変わるので、貼る直前に押してもらう
function RecruitCard({
  shortest,
  attrs,
  text,
}: {
  shortest: string
  attrs: string[]
  text: string
}) {
  const [copied, setCopied] = useState(false)
  const toast = useToast()

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.show('コピーできませんでした。文面を選んでコピーしてください', 'err')
    }
  }

  return (
    <div className="board-recruit">
      <div className="board-recruit-head">
        <span className="board-recruit-title">募集文</span>
        <span className="board-recruit-meta muted">
          最短{shortest}
          {attrs.length > 0 && ` ／ ${attrs.join('・')}`}
        </span>
        <button type="button" className="btn-secondary board-recruit-copy" onClick={copy}>
          {copied ? <Check size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} /> : null}
          {copied ? 'コピーしました' : 'コピー'}
        </button>
      </div>
      <p className="board-recruit-text">{text}</p>
      {attrs.length === 0 && (
        <p className="muted small board-recruit-warn">
          在店キャストの属性が未設定です。管理 → キャストで「属性」を入れると文末に並びます。
        </p>
      )}
      {toast.element}
    </div>
  )
}

function CastCard({
  row,
  canRest,
  busy,
  onStart,
  onRest,
}: {
  row: BoardRow
  canRest: boolean
  busy: boolean
  onStart: () => void
  onRest: () => void
}) {
  return (
    <div className={`board-card ${row.busyNow ? 'busy' : 'free'}`}>
      <div className="board-card-head">
        <strong className="board-cast">
          {row.cast}
          {row.attribute && <span className="board-attr muted">{row.attribute}</span>}
        </strong>
        {row.busyNow ? (
          <span className="board-state board-state-busy">
            <Clock size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            {fmtBizTime(row.availMs)} 〜 受付可能
          </span>
        ) : (
          <span className="board-state board-state-free">今すぐ受付OK</span>
        )}
      </div>

      {row.busyNow && row.blockedBy && (
        <div className="board-reason muted small">{row.blockedBy} のため</div>
      )}

      {row.active && (
        <div className="board-active">
          対応中 {row.active.顧客名 ? `${row.active.顧客名}様` : ''}
          <span className="muted"> 〜 {fmtBizTime(row.active.対応終了時間)}</span>
          {row.active.ルーム && <span className="muted"> ／ {row.active.ルーム}</span>}
        </div>
      )}

      <div className="board-section-label">今日の予約</div>
      {row.reservations.length === 0 ? (
        <p className="muted small board-empty">予約は入っていません。</p>
      ) : (
        <ul className="board-res">
          {row.reservations.map((r) => (
            <li key={r.reservation_id} className={r.converted ? 'done' : ''}>
              <span className="board-res-time">{fmtBizTime(r.予約日時)}</span>
              <span className="board-res-name">{r.顧客名 || '（お名前なし）'}</span>
              <span className="board-res-badges">
                {r.converted && <span className="board-badge done">対応済</span>}
                {!r.converted && r.status === 'pending' && (
                  <span className="board-badge pending">承認待ち</span>
                )}
                {r.予約時間 !== 60 && <span className="board-badge plain">{r.予約時間}分</span>}
                {r.希望席表示名 && <span className="board-badge plain">{r.希望席表示名}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {row.breaks.length > 0 && (
        <div className="board-breaks muted small">
          休憩（受付停止）:{' '}
          {row.breaks
            .map((b) => `${fmtBizTime(b.startMs)}〜${fmtBizTime(b.endMs)}`)
            .join('、')}
        </div>
      )}

      <div className="board-card-actions">
        <button
          type="button"
          className="btn-secondary board-start"
          onClick={onStart}
          disabled={busy || !!row.active}
          title={row.active ? '対応中です' : `${row.cast} の応対を開始する`}
        >
          <Play size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
          応対を開始
        </button>
        {canRest && (
          <button type="button" className="board-rest" onClick={onRest} disabled={busy}>
            お休みにする
          </button>
        )}
      </div>
    </div>
  )
}
