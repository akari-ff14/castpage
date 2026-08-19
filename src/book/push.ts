// Chrome 通知（Web Push）の購読まわり。
//
// 承認・却下のお知らせをブラウザの通知で届ける。送信は Supabase の
// Edge Function がやるので、ここは「宛先を作って DB に預ける」だけ。

import { supabase } from './supabaseClient'

// VAPID の公開鍵。これは秘密ではなく、通知の送り主を示すための公開情報。
// 対になる秘密鍵は Supabase の Edge Function シークレット (VAPID_PRIVATE_KEY) にある。
const VAPID_PUBLIC_KEY = 'BCOF-XJHldHdUSX_qL58ZlmF1ct4tj0KMOJK_QFoeIvJFz1GXGlXuXKsHDxoz3Qh8hZHIgB_uJU8zES1f4PqQn4'

const SW_URL = '/castpage/book-sw.js'
const SW_SCOPE = '/castpage/book/'

export type PushState =
  | 'unsupported'   // このブラウザでは通知を扱えない
  | 'ios-needs-pwa' // iPhone/iPad で、ホーム画面に追加していない
  | 'denied'        // ブラウザ側で拒否されている
  | 'off'           // まだ許可していない
  | 'on'            // 購読済み

// iPhone / iPad かどうか。iPadOS は Mac を名乗るのでタッチの有無で見分ける
function isIos(): boolean {
  const ua = navigator.userAgent
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

// ホーム画面に追加した状態で開いているか
function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari だけの独自プロパティ
    (navigator as unknown as { standalone?: boolean }).standalone === true
  )
}

export function isIosWithoutPwa(): boolean {
  return isIos() && !isStandalone()
}

export async function getPushState(): Promise<PushState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    // iOS はホーム画面に追加するまで PushManager 自体が無い。
    // 「使えません」で終わらせず、やれば使えることを伝えたいので分けて返す
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

export interface EnableResult {
  ok: boolean
  state: PushState
  error?: string
}

// 通知を受け取れるようにする。ブラウザの許可ダイアログは
// ユーザーの操作を起点にしないと出せないので、必ずボタンから呼ぶこと
export async function enablePush(): Promise<EnableResult> {
  const state = await getPushState()
  if (state === 'unsupported' || state === 'ios-needs-pwa') {
    return { ok: false, state }
  }

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
    if (!sess.session) {
      return { ok: false, state: 'off', error: '先にお申し込みを済ませてください' }
    }

    // 同じ端末で登録し直したときに行が増えないよう endpoint で上書きする
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

export async function disablePush(): Promise<PushState> {
  try {
    const reg = await navigator.serviceWorker.getRegistration(SW_SCOPE)
    const sub = await reg?.pushManager.getSubscription()
    if (sub) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
      await sub.unsubscribe()
    }
  } catch {
    // 宛先が消せなくても画面は「オフ」に倒す。送信側は無効な宛先を掃除する
  }
  return 'off'
}
