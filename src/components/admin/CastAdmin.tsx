import { useCallback, useEffect, useState } from 'react'
import {
  addCast,
  adminUnbindCast,
  listAllCasts,
  regenerateInviteCode,
  updateCast,
  type CastAdminRow,
} from '../../lib/db'
import { fmtCurrency } from '../../lib/format'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'

interface FormState {
  id?: string
  name: string
  is_admin: boolean
  active: boolean
  note: string
  guarantee_amount: number  // 待機保証額（0 = なし）
}

const emptyForm = (): FormState => ({ name: '', is_admin: false, active: true, note: '', guarantee_amount: 0 })

export default function CastAdmin() {
  const [list, setList] = useState<CastAdminRow[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      setList(await listAllCasts())
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  function openAdd() {
    setForm(emptyForm())
    setFormOpen(true)
  }

  function openEdit(c: CastAdminRow) {
    setForm({
      id: c.id,
      name: c.name,
      is_admin: c.is_admin,
      active: c.active,
      note: c.note,
      guarantee_amount: c.guarantee_amount,
    })
    setFormOpen(true)
  }

  async function save() {
    if (!form.name.trim()) {
      toast.show('名前は必須です', 'err')
      return
    }
    setBusy(true)
    try {
      if (form.id) {
        await updateCast(form.id, {
          name: form.name.trim(),
          is_admin: form.is_admin,
          active: form.active,
          note: form.note,
          guarantee_amount: Math.max(0, Number(form.guarantee_amount) || 0),
        })
        toast.show('キャストを更新しました')
      } else {
        await addCast({
          name: form.name.trim(),
          is_admin: form.is_admin,
          active: form.active,
          note: form.note,
          guarantee_amount: Math.max(0, Number(form.guarantee_amount) || 0),
        })
        toast.show('キャストを追加しました（招待コードは一覧で確認）')
      }
      setFormOpen(false)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  async function unbindUser(c: CastAdminRow) {
    if (!confirm(`「${c.name}」の紐付けを解除し、新しい招待コードを発行しますか？`)) return
    try {
      const newCode = await adminUnbindCast(c.id)
      toast.show(`紐付け解除しました。新しい招待コード: ${newCode}`)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    }
  }

  async function regenerate(c: CastAdminRow) {
    if (!confirm(`「${c.name}」の招待コードを再発行しますか？古いコードは無効になります。`)) return
    try {
      const newCode = await regenerateInviteCode(c.id)
      toast.show(`新しい招待コード: ${newCode}`)
      load()
    } catch (e) {
      toast.show((e as Error).message, 'err')
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code)
      toast.show('招待コードをコピーしました')
    } catch {
      toast.show('コピーに失敗しました', 'err')
    }
  }

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>キャスト管理</h3>
        <button className="btn-primary admin-add-btn" onClick={openAdd}>＋ 追加</button>
      </div>
      {err && <p className="err">{err}</p>}
      {loading && <p className="muted">読み込み中...</p>}

      {list.map((c) => (
        <div key={c.id} className={`admin-card ${!c.active ? 'inactive' : ''}`}>
          <div className="admin-card-body">
            <div className="admin-card-title">
              <strong>{c.name}</strong>
              {c.is_admin && <span className="admin-badge">管理者</span>}
              {!c.active && <span className="badge-inactive">無効</span>}
            </div>
            <div className="admin-card-meta">
              ログインユーザー: {c.user_id ? (
                <span className="c-green">紐付け済 ({c.user_id.slice(0, 8)}...)</span>
              ) : (
                <span className="muted">未紐付</span>
              )}
            </div>
            {!c.user_id && c.invite_code && (
              <div className="admin-card-meta">
                招待コード: <code style={{ fontSize: '1.05em', letterSpacing: '0.08em' }}>{c.invite_code}</code>{' '}
                <button
                  className="btn-secondary"
                  style={{ padding: '2px 8px', fontSize: '0.85em', marginLeft: 4 }}
                  onClick={() => copyCode(c.invite_code!)}
                >
                  コピー
                </button>
              </div>
            )}
            <div className="admin-card-meta">
              待機保証: {c.guarantee_amount > 0
                ? <span className="c-gold">{fmtCurrency(c.guarantee_amount)}</span>
                : <span className="muted">なし</span>}
            </div>
            {c.note && <div className="admin-card-meta">{c.note}</div>}
          </div>
          <div className="admin-card-actions">
            <button className="btn-secondary" onClick={() => openEdit(c)}>編集</button>
            {!c.user_id && (
              <button className="btn-secondary" onClick={() => regenerate(c)}>コード再発行</button>
            )}
            {c.user_id && (
              <button className="btn-danger" onClick={() => unbindUser(c)}>紐付解除</button>
            )}
          </div>
        </div>
      ))}

      {formOpen && (
        <Modal onClose={() => !busy && setFormOpen(false)}>
          <h3>{form.id ? 'キャストを編集' : 'キャストを追加'}</h3>
          <div className="form-group">
            <label className="form-label">名前</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="キャスト名"
            />
          </div>
          <div className="form-group">
            <label className="form-label">備考</label>
            <input
              type="text"
              className="form-input"
              value={form.note}
              onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            />
          </div>
          <div className="form-group">
            <label className="form-label">待機保証（円 / 営業日）</label>
            <input
              type="number"
              className="form-input"
              min="0"
              step="10000"
              value={form.guarantee_amount}
              onChange={(e) =>
                setForm((f) => ({ ...f, guarantee_amount: Math.max(0, Number(e.target.value) || 0) }))
              }
              placeholder="0 = 保証なし"
            />
            <p className="muted" style={{ fontSize: '0.85em', margin: '6px 2px 0' }}>
              0 で保証なし（例: 500000）。その営業日に1件でも記録があると給与に加算されます。
              給与 = 待機保証 + 席料50% + オプション全額
            </p>
          </div>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))}
            />
            有効（無効にすると選択肢から消える）
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={form.is_admin}
              onChange={(e) => setForm((f) => ({ ...f, is_admin: e.target.checked }))}
            />
            管理者権限を付与
          </label>
          {!form.id && (
            <p className="muted" style={{ fontSize: '0.85em', marginTop: 8 }}>
              招待コードは自動で発行されます。保存後の一覧画面で確認・コピーしてキャスト本人に伝達してください。
            </p>
          )}
          <div className="modal-actions">
            <button className="btn-secondary" onClick={() => setFormOpen(false)} disabled={busy}>キャンセル</button>
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
