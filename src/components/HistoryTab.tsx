import { useCallback, useEffect, useState } from 'react'
import { db, deleteSession, getCastsAndRooms, getPricing, updateHistorySession, type CustomerSummary } from '../lib/db'
import { fmtCurrency, fmtDate, fmtDateTime, fmtTime } from '../lib/format'
import { Crown, AlertTriangle, Clock, Plus, Minus, Sparkles, Search } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import './HistoryTab.css'

// ホーム画面の「本日の接客・売上を入力」から遷移した時に追加モーダルを自動で開くフラグ
export const OPEN_ADD_HISTORY_KEY = 'akari_open_add_history'

interface HistorySession {
  session_id: string
  対応者: string
  ルーム: string
  顧客名: string
  接客種別: string
  接客種別表示名: string
  基本単価: number
  延長回数: number
  オプション回数: number
  開始時間: string
  対応終了時間: string
  作成日時: string
  収益金: number
  備考: string
  キャンセル: boolean
}

interface EditState {
  session_id: string
  cast_name: string
  room_name: string
  service_type: string
  customerNames: string[]   // 複数名対応。保存時はカンマ区切りで結合
  extend_count: number
  option_count: number
  note: string
  cancelled: boolean
}

interface AddState {
  kind: 'normal' | 'cancel'
  cast_name: string
  room_name: string
  service_type: string
  customerNames: string[]   // 複数名対応
  datetime: string   // "YYYY-MM-DDTHH:mm"（JST）
  extend_count: number
  option_count: number
  note: string
}

// 顧客名文字列（カンマ/読点区切り）→ 入力欄配列
function splitCustomerNames(joined: string): string[] {
  const names = String(joined || '').split(/[,、]/).map((s) => s.trim()).filter(Boolean)
  return names.length ? names : ['']
}

interface PricingEntry {
  key: string
  label: string
  price: number
}

function nowJstYearMonth(): { year: number; month: number } {
  const jst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  return {
    year: jst.getUTCFullYear(),
    month: jst.getUTCMonth() + 1,
  }
}

// 現在時刻（JST）を datetime-local 形式 "YYYY-MM-DDTHH:mm" で返す
function nowJstInput(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
}

// datetime-local input value (JST の壁時計時刻) → UTC ISO
function fromLocalInput(local: string): string {
  if (!local) return ''
  const [datePart, timePart] = local.split('T')
  const [y, m, d] = datePart.split('-').map(Number)
  const [hh, mm] = timePart.split(':').map(Number)
  const utc = new Date(Date.UTC(y, m - 1, d, hh, mm) - 9 * 60 * 60 * 1000)
  return utc.toISOString()
}

// 複数の顧客名入力欄（＋来店回数/最終対応ヒント）。追加・編集モーダルで共用
function CustomerNamesInput({
  names,
  onChange,
  summaries,
}: {
  names: string[]
  onChange: (next: string[]) => void
  summaries: Map<string, CustomerSummary>
}) {
  const update = (i: number, v: string) => {
    const next = [...names]
    next[i] = v
    onChange(next)
  }
  const add = () => {
    if (names.length < 10) onChange([...names, ''])
  }
  const remove = (i: number) =>
    onChange(names.length === 1 ? [''] : names.filter((_, idx) => idx !== i))

  return (
    <div className="customer-names">
      {names.map((n, i) => {
        const nm = n.trim()
        const summary = nm ? summaries.get(nm) : undefined
        return (
          <div key={i}>
            <div className="customer-name-row">
              <input
                type="text"
                className="form-input"
                placeholder={i === 0 ? '顧客名' : `お連れ様 ${i + 1}`}
                value={n}
                onChange={(e) => update(i, e.target.value)}
                list="history-known-customers"
                autoComplete="off"
              />
              {i === names.length - 1 && names.length < 10 ? (
                <button
                  type="button"
                  className="btn-cust-add"
                  onClick={add}
                  title="お連れ様を追加"
                  aria-label="お連れ様を追加"
                >
                  <Plus size={18} />
                </button>
              ) : (
                <button
                  type="button"
                  className="btn-cust-rm"
                  onClick={() => remove(i)}
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
              </p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function HistoryTab({
  castName,
  isAdmin,
}: {
  castName: string
  isAdmin: boolean
}) {
  const initial = nowJstYearMonth()
  const [year, setYear] = useState(initial.year)
  const [month, setMonth] = useState(initial.month)
  const [castFilter, setCastFilter] = useState<'mine' | 'all'>('mine')
  const [query, setQuery] = useState('')
  const [list, setList] = useState<HistorySession[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  // 編集モーダル用の参照データ
  const [casts, setCasts] = useState<string[]>([])
  const [rooms, setRooms] = useState<string[]>([])
  const [pricing, setPricing] = useState<PricingEntry[]>([])

  const [editing, setEditing] = useState<EditState | null>(null)
  const [adding, setAdding] = useState<AddState | null>(null)
  const [deleting, setDeleting] = useState<HistorySession | null>(null)
  const [busy, setBusy] = useState(false)
  // 顧客名 → 来店サマリー（来店回数・最終対応の表示用）。一度引いた名前はキャッシュ
  const [custSummaries, setCustSummaries] = useState<Map<string, CustomerSummary>>(new Map())
  // 既存顧客名（入力サジェスト用）
  const [knownNames, setKnownNames] = useState<string[]>([])
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const r = await db.call<HistorySession[]>('getHistory', { year, month })
    setLoading(false)
    if (r.ok) setList(r.data || [])
    else setErr(r.error)
  }, [year, month])

  useEffect(() => {
    load()
  }, [load])

  // 編集モーダル用の選択肢を一度だけ取得
  useEffect(() => {
    (async () => {
      try {
        const [cr, pr] = await Promise.all([getCastsAndRooms(), getPricing()])
        setCasts(cr.casts)
        setRooms(cr.rooms)
        setPricing(pr.filter((p) => p.key !== 'option'))
      } catch {
        // 編集時に必要なデータなので無視（モーダル開いた時にエラー出る）
      }
    })()
  }, [])

  // 既存顧客名のサジェスト候補を取得
  useEffect(() => {
    (async () => {
      const r = await db.call<string[]>('getKnownCustomerNames')
      if (r.ok) setKnownNames(r.data || [])
    })()
  }, [])

  // ホームの「本日の接客・売上を入力」から来た場合、追加モーダルを自動で開く
  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_ADD_HISTORY_KEY)) {
        sessionStorage.removeItem(OPEN_ADD_HISTORY_KEY)
        openAdd()
      }
    } catch { /* noop */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // モーダルで入力中の顧客名の来店サマリーを取得（400ms デバウンス）
  const namesInForm = adding?.customerNames ?? editing?.customerNames ?? []
  useEffect(() => {
    const names = namesInForm
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((n) => !custSummaries.has(n))
    if (!names.length) return
    const t = setTimeout(async () => {
      const results = await Promise.all(
        names.map((n) => db.call<CustomerSummary>('getCustomerSummary', n)),
      )
      setCustSummaries((prev) => {
        const next = new Map(prev)
        results.forEach((r, i) => { if (r.ok) next.set(names[i], r.data) })
        return next
      })
    }, 400)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(namesInForm)])

  // キャストフィルタ + フリーワード検索（顧客名/対応者/ルーム/備考/接客種別）
  const q = query.trim().toLowerCase()
  const filtered = list.filter((s) => {
    if (castFilter === 'mine' && s.対応者 !== castName) return false
    if (q) {
      const hay = `${s.顧客名} ${s.対応者} ${s.ルーム} ${s.備考} ${s.接客種別表示名}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  function canEdit(s: HistorySession): boolean {
    return isAdmin || s.対応者 === castName
  }

  function openEdit(s: HistorySession) {
    setEditing({
      session_id: s.session_id,
      cast_name: s.対応者,
      room_name: s.ルーム || '',
      service_type: s.接客種別,
      customerNames: splitCustomerNames(s.顧客名),
      extend_count: s.延長回数,
      option_count: s.オプション回数,
      note: s.備考,
      cancelled: !!s.キャンセル,
    })
  }

  function openAdd() {
    setAdding({
      kind: 'normal',
      cast_name: castName,
      room_name: '',
      service_type: pricing[0]?.key || 'normal',
      customerNames: [''],
      datetime: nowJstInput(),
      extend_count: 0,
      option_count: 0,
      note: '',
    })
  }

  async function saveAdd() {
    if (!adding) return
    if (!adding.datetime) { toast.show('日時を入力してください', 'err'); return }
    setBusy(true)
    const r = await db.call('addHistorySession', {
      castName: adding.cast_name,
      room: adding.room_name || undefined,
      serviceType: adding.service_type,
      customerNames: adding.customerNames.map((s) => s.trim()).filter(Boolean),
      startedAt: fromLocalInput(adding.datetime),
      extendCount: adding.extend_count,
      optionCount: adding.option_count,
      note: adding.note,
      cancelled: adding.kind === 'cancel',
    })
    setBusy(false)
    if (r.ok) {
      toast.show(adding.kind === 'cancel' ? 'キャンセルを記録しました' : '履歴を追加しました')
      setAdding(null)
      load()
    } else {
      toast.show((r as { error: string }).error || '追加に失敗しました', 'err')
    }
  }

  async function saveEdit() {
    if (!editing) return
    setBusy(true)
    try {
      await updateHistorySession(editing.session_id, {
        cast_name: editing.cast_name,
        room_name: editing.room_name || null,
        service_type: editing.service_type,
        customer_names: editing.customerNames.map((s) => s.trim()).filter(Boolean).join(', '),
        extend_count: editing.extend_count,
        option_count: editing.option_count,
        note: editing.note,
      })
      toast.show('履歴を更新しました')
      setEditing(null)
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
      await deleteSession(deleting.session_id)
      toast.show('履歴を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // 編集中の収益プレビュー
  const editPreview = (() => {
    if (!editing) return 0
    const svc = pricing.find((p) => p.key === editing.service_type)
    const optEntry = pricing.find((p) => p.key === 'option')
    const basePrice = svc?.price ?? 0
    const optPrice = optEntry?.price ?? 500000  // フォールバック
    const custs = editing.customerNames.map((s) => s.trim()).filter(Boolean)
    const nCust = Math.max(1, custs.length)
    const ext = Math.max(0, editing.extend_count)
    const opt = Math.max(0, editing.option_count)
    return basePrice * nCust * (1 + ext) + optPrice * opt
  })()

  // 追加中の収益プレビュー（キャンセルは常に0）
  const addPreview = (() => {
    if (!adding || adding.kind === 'cancel') return 0
    const svc = pricing.find((p) => p.key === adding.service_type)
    const optEntry = pricing.find((p) => p.key === 'option')
    const basePrice = svc?.price ?? 0
    const optPrice = optEntry?.price ?? 500000  // フォールバック（実際の額はサーバ側で算出）
    const custs = adding.customerNames.map((s) => s.trim()).filter(Boolean)
    const nCust = Math.max(1, custs.length)
    const ext = Math.max(0, adding.extend_count)
    const opt = Math.max(0, adding.option_count)
    return basePrice * nCust * (1 + ext) + optPrice * opt
  })()

  return (
    <div className="history-tab">
      {/* 既存顧客名のサジェスト（入力中に候補から選べる。ローマ字/かな入力の手間軽減） */}
      <datalist id="history-known-customers">
        {knownNames.map((n) => <option key={n} value={n} />)}
      </datalist>
      <div className="card filter-card">
        <div className="form-row">
          <div className="form-group">
            <label className="form-label">年</label>
            <input
              type="number"
              className="form-input"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min="2020"
              max="2099"
            />
          </div>
          <div className="form-group">
            <label className="form-label">月</label>
            <div className="select-wrap">
              <select
                className="form-select"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
              >
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {m}月
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
        <div className="filter-actions">
          <button
            className={`btn-pill ${castFilter === 'mine' ? 'active' : ''}`}
            onClick={() => setCastFilter('mine')}
          >
            自分のみ
          </button>
          <button
            className={`btn-pill ${castFilter === 'all' ? 'active' : ''}`}
            onClick={() => setCastFilter('all')}
          >
            全員
          </button>
          <button className="btn-secondary" onClick={load} disabled={loading}>
            {loading ? '...' : '更新'}
          </button>
        </div>
        <div className="history-search">
          <Search size={14} className="history-search-icon" />
          <input
            type="text"
            className="form-input"
            placeholder="検索（顧客名・対応者・ルーム・備考）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            list="history-known-customers"
            autoComplete="off"
          />
          {query && (
            <button
              type="button"
              className="history-search-clear"
              onClick={() => setQuery('')}
              aria-label="検索をクリア"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <button className="btn-add-top" onClick={openAdd}>＋ 履歴を追加（過去分・キャンセル）</button>

      {err && <div className="card"><p className="err">エラー: {err}</p></div>}
      {loading && !list.length && <div className="card"><p className="muted">読み込み中...</p></div>}
      {!loading && !filtered.length && (
        <div className="card empty-state">
          {q ? '検索条件に一致する履歴はありません' : 'この期間の履歴はありません'}
        </div>
      )}

      {filtered.map((s) => (
        <div key={s.session_id} className="history-card">
          <div className="history-header">
            {s.キャンセル ? (
              <span className="badge badge-cancel">キャンセル</span>
            ) : (
              <span className={`badge ${s.接客種別 === 'vip' ? 'badge-vip' : 'badge-normal'}`}>
                {s.接客種別 === 'vip' && <Crown size={11} style={{ verticalAlign: '-1px', marginRight: 3 }} />}
                {s.接客種別表示名 || s.接客種別}
              </span>
            )}
            <span className="history-revenue">{s.キャンセル ? '—' : fmtCurrency(s.収益金)}</span>
          </div>
          <div className="history-row">
            {/* ソート・月フィルタと同じ started_at 基準の日時。created_at だと
                過去分を後から手入力したとき入力日が出て、一覧の並びと食い違って見える */}
            <span className="muted">日時</span>
            <span>{fmtDateTime(s.開始時間)}</span>
          </div>
          <div className="history-row">
            <span className="muted">時間</span>
            <span>{fmtTime(s.開始時間)} 〜 {fmtTime(s.対応終了時間)}</span>
          </div>
          <div className="history-row">
            <span className="muted">対応者 / ルーム</span>
            <span>{s.対応者} / {s.ルーム || '—'}</span>
          </div>
          <div className="history-row">
            <span className="muted">顧客</span>
            <span>{s.顧客名 || '—'}</span>
          </div>
          {(s.延長回数 > 0 || s.オプション回数 > 0) && (
            <div className="history-row">
              <span className="muted">延長 / オプ</span>
              <span>{s.延長回数}回 / {s.オプション回数}回</span>
            </div>
          )}
          {s.備考 && (
            <div className="history-row">
              <span className="muted">備考</span>
              <span>{s.備考}</span>
            </div>
          )}
          {canEdit(s) && (
            <div className="history-actions">
              <button className="btn-secondary" onClick={() => openEdit(s)}>編集</button>
              <button className="btn-danger" onClick={() => setDeleting(s)}>削除</button>
            </div>
          )}
        </div>
      ))}

      {/* 追加モーダル */}
      {adding && (
        <Modal onClose={() => !busy && setAdding(null)}>
          <h3>履歴を追加</h3>
          <div className="form-group">
            <label className="form-label">種別</label>
            <div className="filter-actions" style={{ marginTop: 0 }}>
              <button
                className={`btn-pill ${adding.kind === 'normal' ? 'active' : ''}`}
                onClick={() => setAdding((p) => (p ? { ...p, kind: 'normal' } : null))}
              >
                通常の接客
              </button>
              <button
                className={`btn-pill ${adding.kind === 'cancel' ? 'active' : ''}`}
                onClick={() => setAdding((p) => (p ? { ...p, kind: 'cancel' } : null))}
              >
                キャンセル
              </button>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">対応者</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={adding.cast_name}
                  onChange={(e) => setAdding((p) => (p ? { ...p, cast_name: e.target.value } : null))}
                  disabled={!isAdmin}
                  title={!isAdmin ? '管理者のみ変更可能' : ''}
                >
                  {(casts.length ? casts : [castName]).map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            {adding.kind === 'normal' && (
              <div className="form-group">
                <label className="form-label">ルーム</label>
                <div className="select-wrap">
                  <select
                    className="form-select"
                    value={adding.room_name}
                    onChange={(e) => setAdding((p) => (p ? { ...p, room_name: e.target.value } : null))}
                  >
                    <option value="">—</option>
                    {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
            )}
          </div>
          {adding.kind === 'normal' && (
            <div className="form-group">
              <label className="form-label">接客種別</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={adding.service_type}
                  onChange={(e) => setAdding((p) => (p ? { ...p, service_type: e.target.value } : null))}
                >
                  {pricing.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({fmtCurrency(p.price)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">顧客名（複数名可）</label>
            <CustomerNamesInput
              names={adding.customerNames}
              onChange={(next) => setAdding((p) => (p ? { ...p, customerNames: next } : null))}
              summaries={custSummaries}
            />
          </div>
          <div className="form-group">
            <label className="form-label">日時</label>
            <input
              type="datetime-local"
              className="form-input"
              value={adding.datetime}
              onChange={(e) => setAdding((p) => (p ? { ...p, datetime: e.target.value } : null))}
            />
            <button
              type="button"
              className="btn-pill"
              style={{ marginTop: 8 }}
              onClick={() => setAdding((p) => (p ? { ...p, datetime: nowJstInput() } : null))}
            >
              <Clock size={13} style={{ verticalAlign: '-2px', marginRight: 5 }} />
              現在時刻を入力
            </button>
          </div>
          {adding.kind === 'normal' && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">延長回数</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={adding.extend_count}
                  onChange={(e) =>
                    setAdding((p) => (p ? { ...p, extend_count: Math.max(0, Number(e.target.value) || 0) } : null))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">オプション回数</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={adding.option_count}
                  onChange={(e) =>
                    setAdding((p) => (p ? { ...p, option_count: Math.max(0, Number(e.target.value) || 0) } : null))
                  }
                />
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={adding.note}
              onChange={(e) => setAdding((p) => (p ? { ...p, note: e.target.value } : null))}
              placeholder="備考（任意）"
            />
          </div>
          <div className="edit-revenue-preview">
            {adding.kind === 'cancel'
              ? <>キャンセル記録のため収益は <strong>0円</strong>（件数のみ）</>
              : <>収益金: <strong>{fmtCurrency(addPreview)}</strong></>}
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setAdding(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={saveAdd} disabled={busy}>
              {busy ? '保存中...' : '追加'}
            </button>
          </div>
        </Modal>
      )}

      {/* 編集モーダル */}
      {editing && (
        <Modal onClose={() => !busy && setEditing(null)}>
          <h3>履歴を編集</h3>
          <p className="muted small">数量や種別を変えると、収益金は自動再計算されます。</p>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">対応者</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.cast_name}
                  onChange={(e) => setEditing((p) => (p ? { ...p, cast_name: e.target.value } : null))}
                  disabled={!isAdmin}
                  title={!isAdmin ? '管理者のみ変更可能' : ''}
                >
                  {casts.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div className="form-group">
              <label className="form-label">ルーム</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.room_name}
                  onChange={(e) => setEditing((p) => (p ? { ...p, room_name: e.target.value } : null))}
                >
                  <option value="">—</option>
                  {rooms.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
            </div>
          </div>
          {!editing.cancelled && (
            <div className="form-group">
              <label className="form-label">接客種別</label>
              <div className="select-wrap">
                <select
                  className="form-select"
                  value={editing.service_type}
                  onChange={(e) => setEditing((p) => (p ? { ...p, service_type: e.target.value } : null))}
                >
                  {pricing.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label} ({fmtCurrency(p.price)})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">顧客名（複数名可）</label>
            <CustomerNamesInput
              names={editing.customerNames}
              onChange={(next) => setEditing((p) => (p ? { ...p, customerNames: next } : null))}
              summaries={custSummaries}
            />
          </div>
          {!editing.cancelled && (
            <div className="form-row">
              <div className="form-group">
                <label className="form-label">延長回数</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={editing.extend_count}
                  onChange={(e) =>
                    setEditing((p) => (p ? { ...p, extend_count: Math.max(0, Number(e.target.value) || 0) } : null))
                  }
                />
              </div>
              <div className="form-group">
                <label className="form-label">オプション回数</label>
                <input
                  type="number"
                  className="form-input"
                  min="0"
                  value={editing.option_count}
                  onChange={(e) =>
                    setEditing((p) =>
                      p ? { ...p, option_count: Math.max(0, Number(e.target.value) || 0) } : null,
                    )
                  }
                />
              </div>
            </div>
          )}
          <div className="form-group">
            <label className="form-label">備考</label>
            <textarea
              className="form-input"
              value={editing.note}
              onChange={(e) => setEditing((p) => (p ? { ...p, note: e.target.value } : null))}
            />
          </div>
          <div className="edit-revenue-preview">
            {editing.cancelled
              ? <>キャンセル記録のため収益は <strong>0円</strong>（件数のみ）</>
              : <>再計算後の収益金: <strong>{fmtCurrency(editPreview)}</strong></>}
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setEditing(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={saveEdit} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {/* 削除確認 */}
      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>履歴を削除しますか？</h3>
          <p className="muted">
            {fmtDateTime(deleting.開始時間)} ｜ {deleting.対応者} ｜ {deleting.顧客名 || '—'}<br />
            収益: {fmtCurrency(deleting.収益金)}
          </p>
          <p className="err">
            <AlertTriangle size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            この操作は取り消せません。売上集計からも除外されます。
          </p>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setDeleting(null)} disabled={busy}>キャンセル</button>
            <button className="btn-danger" onClick={confirmDelete} disabled={busy}>
              {busy ? '削除中...' : '削除する'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
