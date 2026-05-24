// Supabase クライアント（シングルトン）
//
// マジックリンク方式の認証フロー:
//   1. signInWithOtp({ email, options: { emailRedirectTo } }) でメール送信
//   2. ユーザーがメール内リンクをタップ
//   3. 戻り先 (emailRedirectTo) で supabase-js が自動的にセッション確立
//   4. onAuthStateChange でログイン状態を購読

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY が未設定です。.env.local を確認してください。',
  )
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,           // localStorage に保存
    autoRefreshToken: true,         // 期限切れ前に自動更新
    detectSessionInUrl: true,       // マジックリンク後のURLハッシュを自動検出
  },
})
