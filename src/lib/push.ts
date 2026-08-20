// キャスト・管理者側の Chrome 通知。
//
// 予約タブを開いていなくても、お客様から申込・取り消し・変更申請があったことに
// 気づけるようにする。承認が遅れるとお客様を待たせるし、確定した予約を
// 取り消されたことに気づかないと当日その時間を空けて待つことになる。
//
// 送信は Supabase の Edge Function notify-staff がやる。ここは宛先の登録だけ。

import { supabase } from './supabase'

// VAPID の公開鍵。お客様側 (src/book/push.ts) と同じ送信元なので同じ鍵を使う。
// 秘密ではなく、通知の送り主を示すための公開情報。
const VAPID_PUBLIC_KEY = 'BCOF-XJHldHdUSX_qL58ZlmF1ct4tj0KMOJK_QFoeIvJFz1GXGlXuXKsHDxoz3Qh8hZHIgB_uJU8zES1f4PqQn4'

const SW_URL = '/castpage/admin-sw.js'
const SW_SCOPE = '/castpage/'

export type StaffPushState = 'unsupported' | 'ios-needs-pwa' | 'denied' | 'off' | 'on'

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

export async function getStaffPushState(): Promise<StaffPushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return isIos() ? 'ios-needs-pwa' : 'unsupported'
  }
  if (Notification.permission === 'denied') return 'denied'
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
    const sub = await reg?.pushManager.getSubscription()
    return sub ? 'on' : 'off'
  } catch {
    return 'off'
  }
}

function urlBase64ToBytes(base64: string): ArrayBuffer {
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=')
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'))
  const buf = new ArrayBuffer(raw.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return buf
}

function bufToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface StaffPushResult {
  ok: boolean
  state: StaffPushState
  error?: string
}

// 通知の許可はユーザー操作を起点にしないと求められないので、必ずボタンから呼ぶ
export async function enableStaffPush(): Promise<StaffPushResult> {
  const state = await getStaffPushState()
  if (state === 'unsupported' || state === 'ios-needs-pwa') return { ok: false, state }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return {
      ok: false,
      state: permission === 'denied' ? 'denied' : 'off',
      error: '通知が許可されませんでした',
    }
  }

  try {
    const reg = await navigator.serviceWorker.register(SW_URL, { scope: SW_SCOPE })
    await navigator.serviceWorker.ready

    const sub =
      (await reg.pushManager.getSubscription()) ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(VAPID_PUBLIC_KEY),
      }))

    const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
    const endpoint = json.endpoint || sub.endpoint
    const p256dh = json.keys?.p256dh || bufToBase64Url(sub.getKey('p256dh'))
    const auth = json.keys?.auth || bufToBase64Url(sub.getKey('auth'))
    if (!endpoint || !p256dh || !auth) {
      return { ok: false, state: 'off', error: '通知の宛先を作れませんでした' }
    }

    const { data: sess } = await supabase.auth.getSession()
    if (!sess.session) return { ok: false, state: 'off', error: 'ログインし直してください' }

    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        user_id: sess.session.user.id,
        endpoint,
        p256dh,
        auth,
        user_agent: navigator.userAgent.slice(0, 300),
      },
      { onConflict: 'endpoint' },
    )
    if (error) return { ok: false, state: 'off', error: '通知の設定を保存できませんでした' }

    return { ok: true, state: 'on' }
  } catch {
    return { ok: false, state: 'off', error: '通知を有効にできませんでした' }
  }
}

export async function disableStaffPush(): Promise<StaffPushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {
    // 宛先を消せなくても画面はオフに倒す。送信側が失効した宛先を掃除する
  }
  return 'off'
}

// 動作確認用。この端末に届くかを試す
export async function sendStaffTestPush(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('notify-staff', {
      body: { test: true },
    })
    if (error) return { ok: false, error: '送信できませんでした' }
    const r = (data || {}) as { ok?: boolean; sent?: number; error?: string }
    if (!r.ok) return { ok: false, error: r.error || '送信できませんでした' }
    if (!r.sent) return { ok: false, error: '宛先が見つかりませんでした。もう一度オンにしてください' }
    return { ok: true }
  } catch {
    return { ok: false, error: '送信できませんでした' }
  }
}
