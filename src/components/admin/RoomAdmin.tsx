import { useCallback, useEffect, useState } from 'react'
import { addRoom, listAllRooms, updateRoom, type RoomAdminRow } from '../../lib/db'
import Modal from '../Modal'
import { useToast } from '../Toast'
import './AdminCommon.css'

interface FormState {
  id?: string
  name: string
  vip: boolean
  active: boolean
  note: string
}

const emptyForm = (): FormState => ({ name: '', vip: false, active: true, note: '' })

export default function RoomAdmin() {
  const [list, setList] = useState<RoomAdminRow[]>([])
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
      setList(await listAllRooms())
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

  function openEdit(r: RoomAdminRow) {
    setForm({ id: r.id, name: r.name, vip: r.vip, active: r.active, note: r.note })
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
        await updateRoom(form.id, {
          name: form.name.trim(),
          vip: form.vip,
          active: form.active,
          note: form.note,
        })
        toast.show('ルームを更新しました')
      } else {
        await addRoom({
          name: form.name.trim(),
          vip: form.vip,
          active: form.active,
          note: form.note,
        })
        toast.show('ルームを追加しました')
      }
      setFormOpen(false)
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
        <h3>ルーム管理</h3>
        <button className="btn-primary admin-add-btn" onClick={openAdd}>＋ 追加</button>
      </div>
      {err && <p className="err">{err}</p>}
      {loading && <p className="muted">読み込み中...</p>}

      {list.map((r) => (
        <div key={r.id} className={`admin-card ${!r.active ? 'inactive' : ''}`}>
          <div className="admin-card-body">
            <div className="admin-card-title">
              <strong>{r.name}</strong>
              {r.vip && <span className="badge badge-vip">VIP</span>}
              {!r.active && <span className="badge-inactive">無効</span>}
            </div>
            {r.note && <div className="admin-card-meta">{r.note}</div>}
          </div>
          <div className="admin-card-actions">
            <button className="btn-secondary" onClick={() => openEdit(r)}>編集</button>
          </div>
        </div>
      ))}

      {formOpen && (
        <Modal onClose={() => !busy && setFormOpen(false)}>
          <h3>{form.id ? 'ルームを編集' : 'ルームを追加'}</h3>
          <div className="form-group">
            <label className="form-label">名前</label>
            <input
              type="text"
              className="form-input"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="ルーム名"
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
              checked={form.vip}
              onChange={(e) => setForm((f) => ({ ...f, vip: e.target.checked }))}
            />
            VIPルーム（接客開始時に自動で接客種別=VIPになる）
          </label>
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
