// Cloudflare Turnstile（いたずら防止の確認）。
//
// 守りたいのは匿名アカウントの作られ方。ブラウザの保存領域を消せば
// アカウントは作り直せるので、「1営業日1件」だけでは機械的な連投を止められない。
// Supabase Auth 側でも Captcha protection を有効にしてあり、
// ここで取ったトークンが無いと匿名ログインそのものが通らない。
//
// サイトキーが空のあいだは何もしない。Cloudflare の登録が済むまで
// これまで通り動かしておくため。

// Cloudflare のダッシュボードで発行するサイトキー。公開情報なのでコードに置いてよい。
// 対になるシークレットキーは Supabase の Authentication → Attack Protection に入れる。
export const TURNSTILE_SITE_KEY = ''

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  reset: (id?: string) => void
  remove: (id?: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export function isTurnstileEnabled(): boolean {
  return TURNSTILE_SITE_KEY.length > 0
}

let loader: Promise<TurnstileApi | null> | null = null

function loadScript(): Promise<TurnstileApi | null> {
  if (!isTurnstileEnabled()) return Promise.resolve(null)
  if (loader) return loader

  loader = new Promise((resolve) => {
    if (window.turnstile) return resolve(window.turnstile)

    const el = document.createElement('script')
    el.src = SCRIPT_URL
    el.async = true
    el.defer = true
    el.onload = () => resolve(window.turnstile ?? null)
    // 読み込めなくても申し込み自体は止めない。確認が付かないだけ
    el.onerror = () => resolve(null)
    document.head.appendChild(el)
  })
  return loader
}

export interface TurnstileHandle {
  reset: () => void
  remove: () => void
}

// 指定した箱に確認ウィジェットを描く。
// appearance: 'interaction-only' なので、怪しくないアクセスには何も表示されない。
export async function renderTurnstile(
  container: HTMLElement,
  onToken: (token: string) => void,
): Promise<TurnstileHandle | null> {
  const api = await loadScript()
  if (!api) return null

  const id = api.render(container, {
    sitekey: TURNSTILE_SITE_KEY,
    appearance: 'interaction-only',
    theme: 'dark',
    language: 'ja',
    callback: (token: string) => onToken(token),
    'error-callback': () => onToken(''),
    'expired-callback': () => onToken(''),
  })

  return {
    reset: () => api.reset(id),
    remove: () => api.remove(id),
  }
}
