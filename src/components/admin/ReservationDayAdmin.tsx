import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  blockKey,
  DEFAULT_SLOT_TIMES,
  deleteReservationDay,
  getReservationDays,
  listAllCasts,
  saveReservationDay,
  type CastAdminRow,
  type ReservationDay,
} from '../../lib/db'
import { jstToday } from '../../lib/format'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'
import './ReservationDayAdmin.css'

// 一覧に出す範囲（過去は振り返り用に少しだけ、未来は先の予定を組めるだけ）
const PAST_DAYS = 30
const FUTURE_DAYS = 120

// ISO(UTC) → datetime-local 用の "YYYY-MM-DDTHH:mm"（JST）
function toLocalDT(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  return new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16)
}

// "YYYY-MM-DDTHH:mm"（JST） → ISO(UTC)
function fromLocalDT(local: string): string | null {
  if (!local) return null
  const [datePart, timePart] = local.split('T')
  if (!datePart || !timePart) return null
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - 9 * 3600 * 1000).toISOString()
}

// 営業日 + 枠時刻 → 実際の開始時刻。
// 4:00 より前の時刻は翌日扱い（DB の slot_start_at と同じ考え方）
function slotStart(businessDate: string, hhmm: string): Date {
  const [y, m, d] = businessDate.split('-').map(Number)
  const [hh, mi] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(y, m - 1, d + (hh < 4 ? 1 : 0), hh, mi) - 9 * 3600 * 1000)
}

function shiftDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function labelDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const w = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]
  return `${m}/${d}（${w}）`
}

function labelDateTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const jst = new Date(d.getTime() + 9 * 3600 * 1000)
  const mm = jst.getUTCMonth() + 1
  const dd = jst.getUTCDate()
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mi = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${mm}/${dd} ${hh}:${mi}`
}

// カードに出す受付状態。お客様から見て今どう見えているかをそのまま言葉にする
function acceptState(day: ReservationDay, now: number): { label: string; tone: 'off' | 'wait' | 'live' | 'done' } {
  if (!day.isOpen) return { label: '非公開', tone: 'off' }
  if (day.acceptFrom && now < new Date(day.acceptFrom).getTime()) {
    return { label: `${labelDateTime(day.acceptFrom)} から受付開始`, tone: 'wait' }
  }
  const until = day.acceptUntil
    ? new Date(day.acceptUntil).getTime()
    : slotStart(day.businessDate, day.slotTimes[0] || '21:00').getTime()
  if (now >= until) return { label: '受付終了', tone: 'done' }
  return { label: '受付中', tone: 'live' }
}

interface FormState {
  businessDate: string
  isOpen: boolean
  acceptFrom: string      // datetime-local
  acceptUntil: string     // datetime-local
  slotTimes: string[]
  note: string
  offCastIds: string[]    // お休みのキャスト。チェックが付いた人が休み
  blocked: Set<string>    // 止めた枠。blockKey(castId, slotNo) の集合
  isNew: boolean
}

function emptyForm(businessDate: string): FormState {
  return {
    businessDate,
    isOpen: false,
    // 既定は前日の21:00から受付開始。よくある運用をそのまま初期値にする
    acceptFrom: `${shiftDate(businessDate, -1)}T21:00`,
    acceptUntil: '',
    slotTimes: [...DEFAULT_SLOT_TIMES],
    note: '',
    // 新しい日は「全員出勤」から始める。休む人にだけチェックを付けてもらう
    offCastIds: [],
    blocked: new Set(),
    isNew: true,
  }
}

export default function ReservationDayAdmin() {
  const [days, setDays] = useState<ReservationDay[]>([])
  const [casts, setCasts] = useState<CastAdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(() => emptyForm(jstToday()))
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState<ReservationDay | null>(null)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const today = jstToday()
      setDays(await getReservationDays(shiftDate(today, -PAST_DAYS), shiftDate(today, FUTURE_DAYS)))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    listAllCasts()
      .then((all) => setCasts(all.filter((c) => c.active)))
      .catch(() => {})
  }, [load])

  const castNameById = useMemo(
    () => new Map(casts.map((c) => [c.id, c.name])),
    [casts],
  )

  // これからの日を近い順に、過去の日はその後ろに新しい順で
  const ordered = useMemo(() => {
    const today = jstToday()
    const upcoming = days.filter((d) => d.businessDate >= today).sort((a, b) => a.businessDate.localeCompare(b.businessDate))
    const past = days.filter((d) => d.businessDate < today).sort((a, b) => b.businessDate.localeCompare(a.businessDate))
    return { upcoming, past }
  }, [days])

  function openAdd() {
    // まだ設定していない直近の日を初期値にする
    const today = jstToday()
    const used = new Set(days.map((d) => d.businessDate))
    let candidate = today
    for (let i = 0; i < 60 && used.has(candidate); i++) candidate = shiftDate(today, i + 1)
    setForm(emptyForm(candidate))
    setFormOpen(true)
  }

  function openEdit(d: ReservationDay) {
    // 保存されているのは「出る人」。画面は「休む人」で扱うので裏返す
    const offs = casts.filter((c) => !d.castIds.includes(c.id)).map((c) => c.id)
    setForm({
      businessDate: d.businessDate,
      isOpen: d.isOpen,
      acceptFrom: toLocalDT(d.acceptFrom),
      acceptUntil: toLocalDT(d.acceptUntil),
      slotTimes: d.slotTimes.length ? [...d.slotTimes] : [...DEFAULT_SLOT_TIMES],
      note: d.note,
      offCastIds: offs,
      blocked: new Set(d.blocks.map((b) => blockKey(b.castId, b.slotNo))),
      isNew: false,
    })
    setFormOpen(true)
  }

  async function save() {
    setBusy(true)
    try {
      const workingIds = casts.filter((c) => !form.offCastIds.includes(c.id)).map((c) => c.id)
      const blocks = Array.from(form.blocked)
        .map((k) => {
          const [castId, slot] = k.split(':')
          return { castId, slotNo: Number(slot) }
        })
        .filter((b) => workingIds.includes(b.castId))

      await saveReservationDay({
        businessDate: form.businessDate,
        isOpen: form.isOpen,
        acceptFrom: fromLocalDT(form.acceptFrom),
        acceptUntil: fromLocalDT(form.acceptUntil),
        slotTimes: form.slotTimes,
        note: form.note,
        castIds: workingIds,
        blocks,
      })
      toast.show(form.isOpen ? '受付日を保存しました。お客様のページに表示されます' : '受付日を保存しました')
      setFormOpen(false)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // カードの「受付開始 / 閉じる」ボタン。編集画面を開かずに公開だけ切り替える
  async function toggleOpen(d: ReservationDay) {
    setBusy(true)
    try {
      await saveReservationDay({ ...d, isOpen: !d.isOpen })
      toast.show(!d.isOpen ? `${labelDate(d.businessDate)} の受付を開始しました` : `${labelDate(d.businessDate)} の受付を閉じました`)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleting) return
    setBusy(true)
    try {
      await deleteReservationDay(deleting.businessDate)
      toast.show('受付日を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()

  function renderCard(d: ReservationDay) {
    const st = acceptState(d, now)
    const names = d.castIds.map((id) => castNameById.get(id)).filter(Boolean)
    return (
      <div key={d.businessDate} className={`admin-card rday-card${d.isOpen ? '' : ' is-closed'}`}>
        <div className="admin-card-body">
          <div className="admin-card-title">
            <strong>{labelDate(d.businessDate)}</strong>
            <span className={`rday-state rday-state-${st.tone}`}>{st.label}</span>
          </div>
          <div className="rday-lines">
            <div className="rday-line">
              <span className="muted">枠</span>
              <span className="rday-slots">
                {d.slotTimes.map((t) => <span key={t} className="rday-slot">{t}</span>)}
              </span>
            </div>
            <div className="rday-line">
              <span className="muted">出勤</span>
              <span>{names.length ? names.join('・') : <span className="err-inline">全員お休み</span>}</span>
            </div>
            {d.blocks.length > 0 && (
              <div className="rday-line">
                <span className="muted">受付なし</span>
                <span className="rday-blocks">
                  {d.blocks
                    .slice()
                    .sort((a, b) => a.slotNo - b.slotNo)
                    .map((b) => (
                      <span key={blockKey(b.castId, b.slotNo)} className="rday-block">
                        {castNameById.get(b.castId) || '?'} {d.slotTimes[b.slotNo - 1] || `枠${b.slotNo}`}
                      </span>
                    ))}
                </span>
              </div>
            )}
            <div className="rday-line">
              <span className="muted">受付</span>
              <span>
                {labelDateTime(d.acceptFrom)} 〜{' '}
                {d.acceptUntil
                  ? labelDateTime(d.acceptUntil)
                  : `${labelDateTime(slotStart(d.businessDate, d.slotTimes[0] || '21:00').toISOString())}（枠1の開始）`}
              </span>
            </div>
            {d.note && <div className="rday-note">{d.note}</div>}
          </div>
        </div>
        <div className="admin-card-actions">
          <button className={d.isOpen ? 'btn-secondary' : 'btn-primary'} disabled={busy} onClick={() => toggleOpen(d)}>
            {d.isOpen ? '受付を閉じる' : '受付開始'}
          </button>
          <button className="btn-secondary" onClick={() => openEdit(d)}>編集</button>
          <button className="btn-secondary btn-danger-text" onClick={() => setDeleting(d)}>削除</button>
        </div>
      </div>
    )
  }

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>受付日</h3>
        <button className="btn-primary admin-add-btn" onClick={openAdd}>＋ 追加</button>
      </div>
      <p className="muted small">
        「受付開始」を押した日だけ、お客様の予約ページに現れます。
        受付開始日時より前は「◯月◯日 ◯時から受付開始」という予告だけが出て、申込ボタンはまだ押せません。
      </p>

      {err && <p className="err">エラー: {err}</p>}
      {loading && !days.length && <p className="muted">読み込み中...</p>}

      {!loading && !days.length && (
        <div className="card empty-state">まだ受付日がありません。「＋ 追加」から作ってください</div>
      )}

      {ordered.upcoming.length > 0 && (
        <>
          <div className="admin-section-h">これからの日</div>
          {ordered.upcoming.map(renderCard)}
        </>
      )}

      {ordered.past.length > 0 && (
        <>
          <div className="admin-section-h">過ぎた日</div>
          {ordered.past.map(renderCard)}
        </>
      )}

      {formOpen && (
        <Modal onClose={() => !busy && setFormOpen(false)}>
          <h3>{form.isNew ? '受付日を追加' : `${labelDate(form.businessDate)} の受付設定`}</h3>

          {form.isNew && (
            <div className="form-group">
              <label className="form-label">営業日</label>
              <input
                type="date"
                className="form-input"
                value={form.businessDate}
                onChange={(e) => {
                  const v = e.target.value
                  setForm((f) => ({
                    ...f,
                    businessDate: v,
                    // 営業日を変えたら受付開始も前日21:00に付いていく
                    acceptFrom: v ? `${shiftDate(v, -1)}T21:00` : '',
                  }))
                }}
              />
            </div>
          )}

          <div className="form-group">
            <label className="form-label">受付開始日時</label>
            <input
              type="datetime-local"
              className="form-input"
              value={form.acceptFrom}
              onChange={(e) => setForm((f) => ({ ...f, acceptFrom: e.target.value }))}
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              この時刻を過ぎるとお客様が申し込めるようになります。空欄なら公開した瞬間から受け付けます。
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">受付終了日時</label>
            <input
              type="datetime-local"
              className="form-input"
              value={form.acceptUntil}
              onChange={(e) => setForm((f) => ({ ...f, acceptUntil: e.target.value }))}
            />
            <p className="muted small" style={{ marginTop: 4 }}>
              空欄なら、その日の最初の枠が始まる時刻で自動的に締め切ります。
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">枠の開始時刻</label>
            <div className="rday-slot-inputs">
              {form.slotTimes.map((t, i) => (
                <div key={i} className="rday-slot-input">
                  <span className="rday-slot-no">枠{i + 1}</span>
                  <input
                    type="time"
                    className="form-input"
                    value={t}
                    onChange={(e) => setForm((f) => {
                      const next = [...f.slotTimes]
                      next[i] = e.target.value
                      return { ...f, slotTimes: next }
                    })}
                  />
                  {form.slotTimes.length > 1 && (
                    <button
                      type="button"
                      className="btn-secondary rday-slot-del"
                      onClick={() => setForm((f) => ({ ...f, slotTimes: f.slotTimes.filter((_, j) => j !== i) }))}
                    >
                      −
                    </button>
                  )}
                </div>
              ))}
            </div>
            {form.slotTimes.length < 3 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ marginTop: 8 }}
                onClick={() => setForm((f) => ({ ...f, slotTimes: [...f.slotTimes, ''] }))}
              >
                ＋ 枠を足す
              </button>
            )}
            <p className="muted small" style={{ marginTop: 4 }}>
              各枠は60分で、後ろに10分のインターバルが入ります。既定は 21:00 / 22:10 / 23:20 です。
            </p>
          </div>

          <div className="form-group">
            <label className="form-label">この日に出す枠</label>
            <p className="muted small" style={{ marginTop: 0 }}>
              お休みの人は左のチェックを入れてください。出勤する人でも、
              都合の悪い枠はマスを押すと受付を止められます。
            </p>

            {!casts.length ? (
              <p className="muted small">有効なキャストがいません</p>
            ) : (
              <div className="rday-grid">
                <div className="rday-grid-head">
                  <span className="rday-grid-corner">お休み</span>
                  {form.slotTimes.map((t, i) => (
                    <span key={i} className="rday-grid-slot-label">{t || `枠${i + 1}`}</span>
                  ))}
                </div>

                {casts.map((c) => {
                  const off = form.offCastIds.includes(c.id)
                  return (
                    <div key={c.id} className={`rday-grid-row${off ? ' is-off' : ''}`}>
                      <label className="rday-grid-name">
                        <input
                          type="checkbox"
                          checked={off}
                          onChange={(e) => setForm((f) => ({
                            ...f,
                            offCastIds: e.target.checked
                              ? [...f.offCastIds, c.id]
                              : f.offCastIds.filter((id) => id !== c.id),
                          }))}
                        />
                        <span>{c.name}</span>
                      </label>

                      {form.slotTimes.map((_, i) => {
                        const slotNo = i + 1
                        const key = blockKey(c.id, slotNo)
                        const blocked = form.blocked.has(key)
                        return (
                          <button
                            key={i}
                            type="button"
                            className={`rday-cell${blocked ? ' is-blocked' : ''}`}
                            disabled={off}
                            aria-pressed={!blocked && !off}
                            aria-label={`${c.name} ${form.slotTimes[i]} ${off ? 'お休み' : blocked ? '受付しない' : '受付する'}`}
                            onClick={() => setForm((f) => {
                              const next = new Set(f.blocked)
                              if (next.has(key)) next.delete(key)
                              else next.add(key)
                              return { ...f, blocked: next }
                            })}
                          >
                            {off ? '—' : blocked ? '受付なし' : '受付'}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">お客様へのひとこと（任意）</label>
            <input
              type="text"
              className="form-input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
              placeholder="例: この日は22時開店です"
            />
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.isOpen}
              onChange={(e) => setForm((f) => ({ ...f, isOpen: e.target.checked }))}
            />
            受付を開始する（お客様の予約ページに表示されます）
          </label>

          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={save} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>{labelDate(deleting.businessDate)} の受付日を削除</h3>
          <p className="muted">
            この日の受付設定と、受付キャストの割り当てを消します。お客様の申込が入っている日は削除できません。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>キャンセル</button>
            <button className="btn-danger" style={{ width: 'auto' }} onClick={confirmDelete} disabled={busy}>
              {busy ? '削除中...' : '削除する'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
