import { useCallback, useEffect, useState } from 'react'
import {
  getCompanyChest,
  addChestEntry,
  updateChestEntry,
  deleteChestEntry,
  type ChestLog,
  type ChestSummary,
} from '../lib/db'
import { fmtCurrency, fmtDateTime } from '../lib/format'
import { Plus, Minus, Edit, Trash } from '../icons'
import Modal from './Modal'
import { useToast } from './Toast'
import './CompanyChestTab.css'

interface Props {
  castName: string
  isAdmin: boolean
}

interface FormState {
  log_id?: string
  sign: 1 | -1  // 入金 / 出金
  amount: number
  memo: string
}

export default function CompanyChestTab({ castName, isAdmin }: Props) {
  const [summary, setSummary] = useState<ChestSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [deleting, setDeleting] = useState<ChestLog | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const s = await getCompanyChest()
      setSummary(s)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function canModify(log: ChestLog): boolean {
    return isAdmin || log.キャスト名 === castName
  }

  function openAdd(sign: 1 | -1) {
    setForm({ sign, amount: 0, memo: '' })
  }

  function openEdit(log: ChestLog) {
    setForm({
      log_id: log.log_id,
      sign: log.金額 >= 0 ? 1 : -1,
      amount: Math.abs(log.金額),
      memo: log.メモ,
    })
  }

  async function save() {
    if (!form) return
    if (!form.amount || form.amount === 0) {
      toast.show('金額を入力してください', 'err')
      return
    }
    setBusy(true)
    try {
      const signedAmount = form.amount * form.sign
      if (form.log_id) {
        await updateChestEntry(form.log_id, { amount: signedAmount, memo: form.memo })
        toast.show('記録を更新しました')
      } else {
        await addChestEntry({ amount: signedAmount, memo: form.memo })
        toast.show(form.sign > 0 ? '入金を記録しました' : '出金を記録しました')
      }
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
      await deleteChestEntry(deleting.log_id)
      toast.show('記録を削除しました')
      setDeleting(null)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="chest-tab">
      <div className="chest-summary-card">
        <div className="chest-summary-label">カンパニーチェスト合計</div>
        <div className={`chest-summary-value ${summary && summary.total >= 0 ? 'positive' : 'negative'}`}>
          {summary ? fmtCurrency(summary.total) : '—'}
        </div>
        <div className="chest-actions">
          <button className="btn-chest-in" onClick={() => openAdd(1)}>
            <Plus size={16} />
            <span>入金を記録</span>
          </button>
          <button className="btn-chest-out" onClick={() => openAdd(-1)}>
            <Minus size={16} />
            <span>出金を記録</span>
          </button>
        </div>
      </div>

      <h3 className="chest-section-title">最近の記録</h3>

      {err && <p className="err">{err}</p>}
      {loading && !summary && <p className="muted">読み込み中...</p>}
      {!loading && summary && summary.logs.length === 0 && (
        <div className="card empty-state">まだ記録がありません。最初の入出金を記録してみましょう。</div>
      )}

      {summary?.logs.map((log) => {
        const isPositive = log.金額 >= 0
        return (
          <div key={log.log_id} className={`chest-log ${isPositive ? 'positive' : 'negative'}`}>
            <div className="chest-log-main">
              <div className="chest-log-row">
                <span className={`chest-log-amount ${isPositive ? 'c-green' : 'c-red'}`}>
                  {isPositive ? '+' : ''}{fmtCurrency(log.金額)}
                </span>
                <span className="chest-log-cast muted small">{log.キャスト名 || '—'}</span>
              </div>
              {log.メモ && <div className="chest-log-memo">{log.メモ}</div>}
              <div className="chest-log-date muted small">{fmtDateTime(log.作成日時)}</div>
            </div>
            {canModify(log) && (
              <div className="chest-log-actions">
                <button className="btn-icon" onClick={() => openEdit(log)} title="編集" aria-label="編集">
                  <Edit size={14} />
                </button>
                <button className="btn-icon btn-icon-danger" onClick={() => setDeleting(log)} title="削除" aria-label="削除">
                  <Trash size={14} />
                </button>
              </div>
            )}
          </div>
        )
      })}

      {form && (
        <Modal onClose={() => !busy && setForm(null)}>
          <h3>{form.log_id ? '記録を編集' : form.sign > 0 ? '入金を記録' : '出金を記録'}</h3>

          {!form.log_id && (
            <div className="chest-toggle">
              <button
                type="button"
                className={`chest-toggle-btn ${form.sign > 0 ? 'active' : ''}`}
                onClick={() => setForm((p) => (p ? { ...p, sign: 1 } : null))}
              >
                <Plus size={14} /> 入金
              </button>
              <button
                type="button"
                className={`chest-toggle-btn ${form.sign < 0 ? 'active' : ''}`}
                onClick={() => setForm((p) => (p ? { ...p, sign: -1 } : null))}
              >
                <Minus size={14} /> 出金
              </button>
            </div>
          )}

          <div className="form-group">
            <label className="form-label">金額（{form.sign > 0 ? '入金' : '出金'}）</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="1000"
              value={form.amount || ''}
              onChange={(e) => setForm((p) => (p ? { ...p, amount: Number(e.target.value) || 0 } : null))}
              placeholder="例: 100000"
              autoFocus
            />
          </div>

          <div className="form-group">
            <label className="form-label">メモ（任意）</label>
            <input
              type="text"
              className="form-input"
              value={form.memo}
              onChange={(e) => setForm((p) => (p ? { ...p, memo: e.target.value } : null))}
              placeholder="例: 給与振込、備品購入など"
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
          <h3>記録を削除しますか？</h3>
          <p className="muted">
            {fmtDateTime(deleting.作成日時)} ｜ {deleting.キャスト名} ｜ {deleting.金額 >= 0 ? '+' : ''}{fmtCurrency(deleting.金額)}
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
