import { useEffect, useState, type CSSProperties } from 'react'
import {
  getGuideMacro,
  getPublicNotice,
  getRecruitTemplate,
  getReservationTimeStep,
  getShiftRules,
  hasDiscordWebhook,
  setDiscordWebhook,
  setGuideMacro,
  setPublicNotice,
  setRecruitTemplate,
  setReservationTimeStep,
  setShiftRules,
  type DiscordTarget,
  type ShiftRules,
  DEFAULT_GUIDE_MACRO,
  DEFAULT_RECRUIT_TEMPLATE,
  MACRO_NORMAL_TOKEN,
  MACRO_OPTION_TOKEN,
  MACRO_TARGET_TOKEN,
  MACRO_VIP_TOKEN,
  RECRUIT_ATTRS_TOKEN,
  RECRUIT_SHORTEST_TOKEN,
} from '../../lib/db'
import { fmtGil } from '../../lib/format'
import { fmtHours, fmtShift, shiftHours, type GuaranteeRule } from '../../lib/shift'
import ShiftSelect from '../ShiftSelect'
import { useToast } from '../Toast'
import './AdminCommon.css'

// 予約時刻の入力単位の選択肢（秒）
const STEP_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 1, label: '1秒単位（即時対応をそのままの時刻で記録）' },
  { value: 60, label: '1分単位' },
  { value: 300, label: '5分単位' },
  { value: 600, label: '10分単位' },
  { value: 900, label: '15分単位' },
  { value: 1800, label: '30分単位' },
]

export default function StoreSettingsAdmin() {
  const [step, setStep] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  // 公開ページに出す案内文
  const [notice, setNotice] = useState('')
  const [savedNotice, setSavedNotice] = useState('')
  const [noticeBusy, setNoticeBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    (async () => {
      try {
        setStep(await getReservationTimeStep())
        const n = await getPublicNotice()
        setNotice(n)
        setSavedNotice(n)
      } catch (e) {
        setErr((e as Error).message)
      }
    })()
  }, [])

  async function saveNotice() {
    setNoticeBusy(true)
    try {
      await setPublicNotice(notice)
      setSavedNotice(notice)
      toast.show('案内文を保存しました。お客様のページに反映されます')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setNoticeBusy(false)
    }
  }

  async function save(next: number) {
    setBusy(true)
    try {
      await setReservationTimeStep(next)
      setStep(next)
      toast.show('予約時刻の入力単位を保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  // DB に選択肢以外の値が入っていても表示できるよう先頭に補う
  const options =
    step !== null && !STEP_OPTIONS.some((o) => o.value === step)
      ? [{ value: step, label: `${step}秒単位` }, ...STEP_OPTIONS]
      : STEP_OPTIONS

  return (
    <div className="admin-section">
      <div className="admin-header">
        <h3>店舗設定</h3>
      </div>
      <p className="muted small">店舗全体で共有される設定です。変更するとすぐ保存されます。</p>

      {err && <p className="err">エラー: {err}</p>}

      <div className="card">
        <div className="form-group">
          <label className="form-label">予約時刻の入力単位</label>
          <p className="muted small" style={{ marginTop: 0 }}>
            予約フォームの時刻入力の刻みです。「1秒単位」にすると「現在時刻を入力」が丸めなしで入り、
            それ以外は選んだ刻みに丸められます。
          </p>
          {step === null && !err ? (
            <p className="muted">読み込み中...</p>
          ) : step !== null ? (
            <div className="select-wrap">
              <select
                className="form-select"
                value={step}
                onChange={(e) => save(Number(e.target.value))}
                disabled={busy}
              >
                {options.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
          ) : null}
        </div>
      </div>

      <div className="card">
        <div className="form-group">
          <label className="form-label" htmlFor="public-notice">お客様の予約ページに出す案内</label>
          <p className="muted small" style={{ marginTop: 0 }}>
            料金、当日の流れ、場所、注意事項など。予約ページの一番上に出ます。
            空欄にすると何も表示されません。
          </p>
          <textarea
            id="public-notice"
            className="form-input"
            rows={7}
            value={notice}
            onChange={(e) => setNotice(e.target.value)}
            placeholder={'例）\n・お時間は30分か60分をお選びいただけます\n・お時間の5分前にお越しください\n・ご確定後のキャンセルはご予約ページから行えます'}
          />
          <div className="store-notice-actions">
            <button className="btn-primary" onClick={saveNotice} disabled={noticeBusy || notice === savedNotice}>
              {noticeBusy ? '保存中...' : notice === savedNotice ? '保存済み' : '案内を保存'}
            </button>
            {notice !== savedNotice && (
              <button className="btn-secondary" onClick={() => setNotice(savedNotice)} disabled={noticeBusy}>
                元に戻す
              </button>
            )}
          </div>
        </div>
      </div>

      <ShiftRulesCard />

      <RecruitTemplateCard />

      <GuideMacroCard />

      <DiscordCard />

      {toast.element}
    </div>
  )
}

// 営業時間と、勤務時間から決まる待機保証の規定表。
// 「3時間なら50万、2時間なら20万」をここで持ち、管理→キャストで勤務時間帯を
// 入れたときの既定額と、受付日でその日だけ時間を変えた日の給与計算に使う
function ShiftRulesCard() {
  const [rules, setRules] = useState<ShiftRules | null>(null)
  const [saved, setSaved] = useState<ShiftRules | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    getShiftRules()
      .then((r) => {
        setRules(r)
        setSaved(r)
      })
      .catch(() => {})
  }, [])

  if (!rules || !saved) return null

  const dirty = JSON.stringify(rules) !== JSON.stringify(saved)
  const hours = shiftHours(rules.businessHours)

  function updateRule(i: number, patch: Partial<GuaranteeRule>) {
    setRules((r) => r && {
      ...r,
      guaranteeRules: r.guaranteeRules.map((row, j) => (j === i ? { ...row, ...patch } : row)),
    })
  }

  async function save() {
    if (!rules) return
    setBusy(true)
    try {
      // 時間の長い順に揃えてから保存する。画面もこの順で読む
      const next: ShiftRules = {
        businessHours: rules.businessHours,
        guaranteeRules: rules.guaranteeRules
          .filter((r) => r.hours > 0)
          .sort((a, b) => b.hours - a.hours),
      }
      await setShiftRules(next)
      setRules(next)
      setSaved(next)
      toast.show('営業時間と待機保証の規定を保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <div className="form-group">
        <span className="form-label">営業時間</span>
        <p className="muted small" style={{ marginTop: 0 }}>
          勤務時間帯を決めていないキャストは、この時間に出るものとして扱います
          （受付ボードの「出勤前」「本日終了」と、待機保証の時間数に使います）。
        </p>
        <ShiftSelect
          value={rules.businessHours}
          onChange={(v) => setRules((r) => r && { ...r, businessHours: v })}
          ariaLabel="営業時間"
        />
        <p className="muted small" style={{ margin: '6px 2px 0' }}>
          {fmtShift(rules.businessHours)}（{fmtHours(hours)}）
          {hours <= 0 && <span className="err"> 終わりは始まりより後にしてください</span>}
        </p>
      </div>

      <div className="form-group">
        <span className="form-label">待機保証の規定（勤務時間 → 金額）</span>
        <p className="muted small" style={{ marginTop: 0 }}>
          勤務時間がその行の時間以上なら、その行の額になります（3時間50万・2時間20万なら、2時間半の人は20万）。
          どの行にも届かない短さは保証なしです。
        </p>
        <div className="rule-table">
          {rules.guaranteeRules.map((row, i) => (
            <div key={i} className="rule-row">
              <input
                type="number"
                className="form-input"
                min="0.5"
                step="0.5"
                value={row.hours}
                aria-label={`規定 ${i + 1} の勤務時間`}
                onChange={(e) => updateRule(i, { hours: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="muted">時間 →</span>
              <input
                type="number"
                className="form-input"
                min="0"
                step="10000"
                value={row.amount}
                aria-label={`規定 ${i + 1} の金額`}
                onChange={(e) => updateRule(i, { amount: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="muted rule-gil">{fmtGil(row.amount)}</span>
              <button
                type="button"
                className="btn-secondary rule-del"
                disabled={rules.guaranteeRules.length <= 1}
                aria-label={`規定 ${i + 1} を削除`}
                onClick={() => setRules((r) => r && { ...r, guaranteeRules: r.guaranteeRules.filter((_, j) => j !== i) })}
              >
                −
              </button>
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn-secondary"
          style={{ marginTop: 8 }}
          onClick={() => setRules((r) => r && { ...r, guaranteeRules: [...r.guaranteeRules, { hours: 1, amount: 0 }] })}
        >
          ＋ 行を足す
        </button>
      </div>

      <div className="store-notice-actions">
        <button className="btn-primary" onClick={save} disabled={busy || !dirty || hours <= 0}>
          {busy ? '保存中...' : dirty ? '規定を保存' : '保存済み'}
        </button>
        {dirty && (
          <button className="btn-secondary" onClick={() => setRules(saved)} disabled={busy}>
            元に戻す
          </button>
        )}
      </div>
      {toast.element}
    </div>
  )
}

// PT募集の文面のひな形。受付ボードで「最短」と「属性」を差し込んで出す
function RecruitTemplateCard() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    getRecruitTemplate()
      .then((t) => {
        setText(t)
        setSaved(t)
      })
      .catch(() => {
        setText(DEFAULT_RECRUIT_TEMPLATE)
        setSaved(DEFAULT_RECRUIT_TEMPLATE)
      })
      .finally(() => setLoaded(true))
  }, [])

  async function save(next: string) {
    setBusy(true)
    try {
      await setRecruitTemplate(next)
      setText(next)
      setSaved(next)
      toast.show('募集文のひな形を保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  return (
    <div className="card">
      <div className="form-group">
        <label className="form-label" htmlFor="recruit-template">PT募集の文面</label>
        <p className="muted small" style={{ marginTop: 0 }}>
          受付ボードで、そのときの最短案内時刻と在店キャストの属性を差し込んで出します。
          差し込む場所は次の2つで指定します。
        </p>
        <ul className="muted small store-token-list">
          <li>
            <code>{RECRUIT_SHORTEST_TOKEN}</code> … 全員空いていれば「即ご案内可能」、
            埋まっていれば「21:30～」のような時刻になります
          </li>
          <li>
            <code>{RECRUIT_ATTRS_TOKEN}</code> … 在店キャストの属性を「・」でつないだもの
            （同じ属性は1つにまとめます）
          </li>
        </ul>
        <textarea
          id="recruit-template"
          className="form-input"
          rows={4}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="store-notice-actions">
          <button className="btn-primary" onClick={() => save(text)} disabled={busy || text === saved}>
            {busy ? '保存中...' : text === saved ? '保存済み' : '文面を保存'}
          </button>
          {text !== saved && (
            <button className="btn-secondary" onClick={() => setText(saved)} disabled={busy}>
              元に戻す
            </button>
          )}
          {text === saved && saved !== DEFAULT_RECRUIT_TEMPLATE && (
            <button className="btn-secondary" onClick={() => setText(DEFAULT_RECRUIT_TEMPLATE)} disabled={busy}>
              既定の文面に戻す
            </button>
          )}
        </div>
      </div>
      {toast.element}
    </div>
  )
}

// お客様へシステムを説明する FF14 マクロのひな形。
// 受付ボードで宛先と料金を差し込んで出す
function GuideMacroCard() {
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const toast = useToast()

  useEffect(() => {
    getGuideMacro()
      .then((t) => {
        setText(t)
        setSaved(t)
      })
      .catch(() => {
        setText(DEFAULT_GUIDE_MACRO)
        setSaved(DEFAULT_GUIDE_MACRO)
      })
      .finally(() => setLoaded(true))
  }, [])

  async function save(next: string) {
    setBusy(true)
    try {
      await setGuideMacro(next)
      setText(next)
      setSaved(next)
      toast.show('案内マクロを保存しました')
    } catch (e) {
      toast.show((e as Error).message, 'err')
    } finally {
      setBusy(false)
    }
  }

  if (!loaded) return null

  const lines = text.split('\n').length

  return (
    <div className="card">
      <div className="form-group">
        <label className="form-label" htmlFor="guide-macro">お客様への案内マクロ</label>
        <p className="muted small" style={{ marginTop: 0 }}>
          受付ボードから、パーティチャット用と tell 用の2通りで写せます。
          本文は共通で、宛先と料金だけを差し込みます。
        </p>
        <ul className="muted small store-token-list">
          <li><code>{MACRO_TARGET_TOKEN}</code> … <code>/p</code> または <code>{'/tell <t>'}</code></li>
          <li>
            <code>{MACRO_NORMAL_TOKEN}</code> <code>{MACRO_VIP_TOKEN}</code>{' '}
            <code>{MACRO_OPTION_TOKEN}</code> … 料金マスタの現在値（「20万G」の形）。
            料金を変えればマクロも自動で変わります
          </li>
        </ul>
        <textarea
          id="guide-macro"
          className="form-input store-macro-area"
          rows={13}
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <p className="muted small" style={{ margin: '6px 2px 0' }}>
          現在 {lines}行{lines > 15 && '（FF14 のマクロは15行までです）'}
        </p>
        <div className="store-notice-actions">
          <button className="btn-primary" onClick={() => save(text)} disabled={busy || text === saved}>
            {busy ? '保存中...' : text === saved ? '保存済み' : 'マクロを保存'}
          </button>
          {text !== saved && (
            <button className="btn-secondary" onClick={() => setText(saved)} disabled={busy}>
              元に戻す
            </button>
          )}
          {text === saved && saved !== DEFAULT_GUIDE_MACRO && (
            <button className="btn-secondary" onClick={() => setText(DEFAULT_GUIDE_MACRO)} disabled={busy}>
              既定の文面に戻す
            </button>
          )}
        </div>
      </div>
      {toast.element}
    </div>
  )
}

// Discord への予約通知（任意）。
// Webhook URL は保管庫に入るので、ここでは「設定済みかどうか」しか分からない。
// 一度保存したら画面には出さず、消したいときは空で保存してもらう。
//
// 通知先は2本。お客様が予約フォームから入れたものと、店で予約タブから入れたものを
// 別のチャンネルで見たい、という要望から分けた。予約フォーム側が未設定なら
// 店内アプリ側にまとめて流れるので、1本のままでも今までどおり使える。
function DiscordCard() {
  return (
    <div className="card">
      <div className="form-group">
        <span className="form-label">Discord に予約のお知らせを送る（任意）</span>
        <p className="muted small" style={{ marginTop: 0 }}>
          店の Discord に、予約や対応の動きを流します。種類ごとに色分けされます。
          設定しなければ何も送りません。
        </p>
        <p className="muted small" style={{ marginTop: 0 }}>
          お客様のお名前と、対応終了時の金額も一緒に送られます。
          チャンネルは、見せてよい人だけが入れるところにしてください。
          URL は Discord のチャンネル設定 → 連携サービス → ウェブフック で作れます。
        </p>
      </div>

      <WebhookField
        target="shop"
        title="店内アプリの動き"
        lead="予約タブから入れた予約と、接客の開始・延長・終了。"
        chips={[
          ['#4aa8b0', '予約追加'],
          ['#5b8fd0', '対応開始'],
          ['#dd7a33', '延長'],
          ['#7a8290', '対応終了'],
        ]}
      />

      <WebhookField
        target="customer"
        title="予約フォーム（お客様の申込）"
        lead="お客様がご自分で入れた申込と、その日時変更・取り消し、店が承認したときの予約確定。別のチャンネルに分けたいときに設定します。未設定なら上のチャンネルにまとめて流します。"
        chips={[
          ['#e0b464', '申込'],
          ['#9aa0d8', '日時変更'],
          ['#9c5f57', '取り消し'],
          ['#5bb98a', '予約確定'],
        ]}
      />
    </div>
  )
}

// 通知先1本ぶんの設定欄。設定済みかどうかの読み込みと保存を、それぞれが自分で持つ
function WebhookField({
  target,
  title,
  lead,
  chips,
}: {
  target: DiscordTarget
  title: string
  lead: string
  chips: Array<[color: string, label: string]>
}) {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const toast = useToast()
  const inputId = `discord-url-${target}`

  useEffect(() => {
    hasDiscordWebhook(target).then(setConfigured).catch(() => setConfigured(false))
  }, [target])

  async function save(next: string) {
    setBusy(true)
    setErr('')
    try {
      await setDiscordWebhook(next, target)
      setConfigured(next !== '')
      setUrl('')
      toast.show(next ? `「${title}」を Discord に送る設定にしました` : `「${title}」の Discord への通知を止めました`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (configured === null) return null

  return (
    <div className="form-group discord-target">
      <label className="form-label" htmlFor={inputId}>{title}</label>
      <p className="muted small" style={{ marginTop: 0 }}>{lead}</p>
      <div className="discord-legend">
        {chips.map(([color, label]) => (
          <span key={label} className="discord-chip" style={{ '--chip': color } as CSSProperties}>{label}</span>
        ))}
      </div>

      {configured ? (
        <>
          <p className="c-green small" style={{ margin: '8px 0' }}>設定済みです。</p>
          <p className="muted small" style={{ marginTop: 0 }}>
            入れ直すときは新しい URL を貼って保存してください。
            安全のため、保存した URL は画面には出しません。
          </p>
        </>
      ) : (
        <p className="muted small" style={{ marginTop: 0 }}>
          Webhook の URL を貼ってください。
        </p>
      )}

      <input
        id={inputId}
        className="form-input"
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://discord.com/api/webhooks/..."
        autoComplete="off"
      />

      <div className="store-notice-actions">
        <button className="btn-primary" onClick={() => save(url.trim())} disabled={busy || !url.trim()}>
          {busy ? '保存中...' : configured ? '入れ直す' : '設定する'}
        </button>
        {configured && (
          <button className="btn-secondary" onClick={() => save('')} disabled={busy}>
            通知を止める
          </button>
        )}
      </div>

      {err && <p className="err small">{err}</p>}
      {toast.element}
    </div>
  )
}
