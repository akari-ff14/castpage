import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { updatePricing, clearCache } from '../../lib/db'
import { fmtCurrency } from '../../lib/format'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'

interface PricingRow {
  key: string
  label: string
  price: number
  active: boolean
  note: string
}

interface FormState {
  key: string
  label: string
  price: number
  active: boolean
  note: string
}

export default function PricingAdmin() {
  const [list, setList] = useState<PricingRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [form, setForm] = useState<FormState | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    const { data, error } = await supabase
      .from('pricing')
      .select('key, label, price, active, note')
      .order('key')
    setLoading(false)
    if (error) {
      setErr(error.message)
      return
    }
    setList(
      (data || []).map((r) => ({
        key: r.key,
        label: r.label,
        price: Number(r.price),
        active: !!r.active,
        note: r.note || '',
      })),
    )
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function save() {
    if (!form) return
    setBusy(true)
    try {
      await updatePricing(form.key, {
        label: form.label,
        price: form.price,
        active: form.active,
        note: form.note,
      })
      clearCache()
      toast.show('料金を更新しました')
      setForm(null)
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
        <h3>料金管理</h3>
      </div>
      <p className="muted small">
        ※ 接客種別 (normal/vip/option) のキー自体は変更できません。ラベル・価格・有効/無効のみ編集可能です。<br />
        ※ 価格変更は **新規セッションから** 反映されます。既存のセッションは開始時の価格がスナップショットされています。
      </p>
      {err && <p className="err">{err}</p>}
      {loading && <p className="muted">読み込み中...</p>}

      {list.map((p) => (
        <div key={p.key} className={`admin-card ${!p.active ? 'inactive' : ''}`}>
          <div className="admin-card-body">
            <div className="admin-card-title">
              <strong>{p.label}</strong>
              <span className="muted small">（{p.key}）</span>
              {!p.active && <span className="badge-inactive">無効</span>}
            </div>
            <div className="admin-card-meta">
              <span className="c-gold">{fmtCurrency(p.price)}</span>
              <span className="muted"> / {p.key === 'option' ? '1回' : '30分'}</span>
            </div>
            {p.note && <div className="admin-card-meta">{p.note}</div>}
          </div>
          <div className="admin-card-actions">
            <button className="btn-secondary" onClick={() => setForm({ ...p })}>編集</button>
          </div>
        </div>
      ))}

      {form && (
        <Modal onClose={() => !busy && setForm(null)}>
          <h3>料金を編集</h3>
          <p className="muted small">キー: <strong>{form.key}</strong></p>
          <div className="form-group">
            <label className="form-label">表示ラベル</label>
            <input
              type="text"
              className="form-input"
              value={form.label}
              onChange={(e) => setForm((f) => (f ? { ...f, label: e.target.value } : null))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">価格</label>
            <input
              type="number"
              className="form-input"
              min="0"
              value={form.price}
              onChange={(e) => setForm((f) => (f ? { ...f, price: Number(e.target.value) || 0 } : null))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <input
              type="text"
              className="form-input"
              value={form.note}
              onChange={(e) => setForm((f) => (f ? { ...f, note: e.target.value } : null))}
            />
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => (f ? { ...f, active: e.target.checked } : null))}
            />
            有効
          </label>
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setForm(null)} disabled={busy}>キャンセル</button>
            <button className="btn-primary" style={{ width: 'auto' }} onClick={save} disabled={busy}>
              {busy ? '保存中...' : '保存'}
            </button>
          </div>
        </Modal>
      )}

      {toast.element}
    </div>
  )
}
