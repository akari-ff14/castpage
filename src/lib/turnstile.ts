// Cloudflare Turnstile（いたずら防止の確認）。
//
// 守りたいのは匿名アカウントの作られ方。ブラウザの保存領域を消せば
// アカウントは作り直せるので、「1営業日1件」だけでは機械的な連投を止められない。
// Supabase Auth 側でも Captcha protection を有効にしてあり、
// ここで取ったトークンが無いと匿名ログインそのものが通らない。
//
// ただし Supabase の Captcha protection はプロジェクト全体に効く。
// 匿名ログイン（予約ページ）だけでなく、キャスト用のマジックリンク送信 (/otp) も
// トークンを添えないと "captcha protection: request disallowed" で弾かれる
// （2026-09-17、新しいキャストが登録できない形で実際に起きた）。
// なので予約ページとキャスト用アプリの両方から使う。Google ログインは
// /authorize に飛ぶだけなので対象外。
//
// 2つのバンドルで共有する唯一のモジュール。店のデータには触らず、
// 他のモジュールも取り込まない葉のままにしておくこと（vite.config.ts を参照）。
//
// サイトキーが空のあいだは何もしない。Cloudflare の登録が済むまで
// これまで通り動かしておくため。

// Cloudflare のダッシュボードで発行するサイトキー。公開情報なのでコードに置いてよい。
// 対になるシークレットキーは Supabase の Authentication → Attack Protection に入れる。
export const TURNSTILE_SITE_KEY = '0x4AAAAAAEWM115OOhUl_LXV'

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

interface TurnstileApi {
  // 同じ箱に二重に描こうとすると警告を出して undefined を返す
  render: (el: HTMLElement, opts: Record<string, unknown>) => string | undefined
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
  // 確認をやり直して新しいトークンを取る。トークンは1回きりなので送信のあとに呼ぶ
  reset: () => void
  // ウィジェットを消す。まだ読み込み待ちなら、描かずに終える
  remove: () => void
  // 確認が使えるか。スクリプトを読み込めなかったときだけ false（読み込み中は true）。
  // false なら待っても結果は来ないので、呼び出し側はトークン無しで送ってよい。
  // サーバー側で弾かれ、その返事をそのまま伝えることになる
  available: () => boolean
}

// 指定した箱に確認ウィジェットを描く。
// appearance: 'interaction-only' なので、怪しくないアクセスには何も表示されない。
// theme は表示されたときの色。予約ページは常に暗いが、キャスト用アプリは
// 見た目を選べるので、置く画面の色に合わせて渡す。
//
// スクリプトの読み込みを待つぶん描画は少し遅れるが、取っ手はすぐ返す。
// effect の後始末で remove() を呼べば、読み込み中に画面が閉じられても
// （開発中の StrictMode による二重実行を含め）同じ箱に二重に描くことはない。
// 以前は描き終えてから取っ手を返していたので、二重実行のときに
// 1つ目が描いた直後に2つ目が拒否され、1つ目の後始末で箱が空になっていた。
export function renderTurnstile(
  container: HTMLElement,
  onToken: (token: string) => void,
  theme: 'light' | 'dark' = 'dark',
): TurnstileHandle {
  let api: TurnstileApi | null = null
  let id: string | undefined
  let removed = false
  let available = true

  loadScript().then((loaded) => {
    if (!loaded) {
      available = false
      return
    }
    if (removed) return
    api = loaded
    id = api.render(container, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: 'interaction-only',
      theme,
      language: 'ja',
      callback: (token: string) => onToken(token),
      'error-callback': () => onToken(''),
      'expired-callback': () => onToken(''),
    })
  })

  return {
    reset: () => {
      if (id !== undefined) api?.reset(id)
    },
    remove: () => {
      removed = true
      if (id !== undefined) api?.remove(id)
      id = undefined
    },
    available: () => available,
  }
}
