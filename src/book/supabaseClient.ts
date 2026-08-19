// お客様用の Supabase クライアント。
//
// キャスト用アプリ (lib/supabase.ts) とは別インスタンスにして、
// ログイン状態の保存先も分ける。理由は3つ。
//
//  1. お客様の匿名セッションがキャスト用アプリに漏れない（逆も同じ）。
//     同じ保存先だと、匿名ログインしたブラウザで管理画面を開いたときに
//     「招待コードを入れてください」の画面に着地してしまう。
//  2. detectSessionInUrl を切れる。あれは URL のハッシュをマジックリンクの
//     戻り値だと思って読み取り、読んだ後にハッシュを消す。この予約ページは
//     #/my のようなハッシュで画面を切り替えるので、そのままだと申し込んだ瞬間に
//     画面が飛ばされる（実際に起きた）。
//  3. 予約ページはマジックリンクも Google ログインも使わない。
//
// キャストがこのページから申し込むことは妨げない。同じ auth.users が
// キャストとお客様を兼ねることだけを DB 側で禁じている。

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。')
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storageKey: 'akari-book-auth',  // キャスト用と別の保存先
    persistSession: true,           // 同じブラウザなら次に来ても自分の予約が見える
    autoRefreshToken: true,
    detectSessionInUrl: false,      // ハッシュはこのページの画面切り替えに使う
  },
  global: {
    // PostgREST は Cache-Control を返さないので、ブラウザが独自にキャッシュできてしまう。
    // 空き状況は常に最新を取りに行く（管理アプリ側と同じ方針）
    fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
  },
})
