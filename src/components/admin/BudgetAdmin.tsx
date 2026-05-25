import { useCallback, useEffect, useMemo, useState } from 'react'
import { getExpenses, addExpense, deleteExpense, type ExpenseRow } from '../../lib/db'
import { fmtCurrency, fmtDate, jstToday } from '../../lib/format'
import { Plus, Trash } from '../../icons'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'

interface FormState {
  date: string
  amount: number
  category: string
  memo: string
}

const COMMON_CATEGORIES = ['仕入れ', '備品', 'ハウス', 'スタッフ給与', 'その他']

const emptyForm = (): FormState => ({
  date: jstToday(),
  amount: 0,
  category: 'その他',
  memo: '',
})

export default function BudgetAdmin() {
  const [list, setList] = useState<ExpenseRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<ExpenseRow | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setList(await getExpenses())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 月別グループ化 + 合計
  const groups = useMemo(() => {
    const m = new Map<string, ExpenseRow[]>()
    for (const e of list) {
      const ym = e.日付.slice(0, 7)  // YYYY-MM
      if (!m.has(ym)) m.set(ym, [])
      m.get(ym)!.push(e)
    }
    return [...m.entries()]
      .sort((a, b) => (a[0] > b[0] ? -1 : 1))
      .map(([ym, items]) => ({
        ym,
        items,
        total: items.reduce((s, i) => s + i.金額, 0),
      }))
  }, [list])

  const totalAll = list.reduce((s, e) => s + e.金額, 0)
  const thisMonthYm = jstToday().slice(0, 7)
  const thisMonthTotal = list
    .filter((e) => e.日付.slice(0, 7) === thisMonthYm)
    .reduce((s, e) => s + e.金額, 0)

  async function save() {
    if (!form) return
    if (!form.amount || form.amount === 0) {
      toast.show('金額を入力してください', 'err')
      return
    }
    setBusy(true)
    try {
      await addExpense({
        date: form.date,
        amount: form.amount,
        category: form.category,
        memo: form.memo,
      })
      toast.show('経費を記録しました')
      setForm(null)
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
      await deleteExpense(deleting.expense_id)
      toast.show('経費を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>予算（経費管理）</h3>
        <button className="btn-primary admin-add-btn" onClick={() => setForm(emptyForm())}>
          <Plus size={14} style={{ marginRight: 4, verticalAlign: '-2px' }} />
          経費を記録
        </button>
      </div>

      <div className="budget-totals">
        <div className="budget-total-card">
          <div className="budget-total-label">今月の経費</div>
          <div className="budget-total-value c-red">{fmtCurrency(thisMonthTotal)}</div>
        </div>
        <div className="budget-total-card">
          <div className="budget-total-label">累計</div>
          <div className="budget-total-value muted">{fmtCurrency(totalAll)}</div>
        </div>
      </div>

      {err && <p className="err">{err}</p>}
      {loading && !list.length && <p className="muted">読み込み中...</p>}
      {!loading && !list.length && (
        <div className="card empty-state">まだ経費の記録はありません。</div>
      )}

      {groups.map((g) => (
        <div key={g.ym} className="budget-month">
          <div className="budget-month-header">
            <span className="budget-month-label">{g.ym.replace('-', '年')}月</span>
            <span className="budget-month-total c-red">{fmtCurrency(g.total)}</span>
          </div>
          {g.items.map((e) => (
            <div key={e.expense_id} className="budget-row">
              <div className="budget-row-main">
                <div className="budget-row-top">
                  <span className="budget-row-date">{fmtDate(e.日付)}</span>
                  <span className={`budget-row-category cat-${e.カテゴリ}`}>{e.カテゴリ}</span>
                  <span className="budget-row-amount c-red">{fmtCurrency(e.金額)}</span>
                </div>
                {e.メモ && <div className="budget-row-memo muted small">{e.メモ}</div>}
              </div>
              <button
                className="btn-icon btn-icon-danger"
                onClick={() => setDeleting(e)}
                title="削除"
                aria-label="削除"
              >
                <Trash size={14} />
              </button>
            </div>
          ))}
        </div>
      ))}

      {form && (
        <Modal onClose={() => !busy && setForm(null)}>
          <h3>経費を記録</h3>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">日付</label>
              <input
                type="date"
                className="form-input"
                value={form.date}
                onChange={(e) => setForm((p) => (p ? { ...p, date: e.target.value } : null))}
              />
            </div>
            <div className="form-group">
              <label className="form-label">金額</label>
              <input
                type="number"
                className="form-input"
                min="0"
                step="1000"
                value={form.amount || ''}
                onChange={(e) => setForm((p) => (p ? { ...p, amount: Number(e.target.value) || 0 } : null))}
                placeholder="例: 50000"
              />
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">カテゴリ</label>
            <div className="category-chips">
              {COMMON_CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`category-chip ${form.category === c ? 'active' : ''}`}
                  onClick={() => setForm((p) => (p ? { ...p, category: c } : null))}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="form-group">
            <label className="form-label">メモ（任意）</label>
            <input
              type="text"
              className="form-input"
              value={form.memo}
              onChange={(e) => setForm((p) => (p ? { ...p, memo: e.target.value } : null))}
              placeholder="例: ハウス家賃、消耗品など"
            />
          </div>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={save} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal onClose={() => !busy && setDeleting(null)}>
          <h3>経費を削除しますか？</h3>
          <p className="muted">
            {fmtDate(deleting.日付)} ｜ {deleting.カテゴリ} ｜ {fmtCurrency(deleting.金額)}
            {deleting.メモ && <><br />「{deleting.メモ}」</>}
          </p>
          <p className="err">この操作は取り消せません。</p>
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
