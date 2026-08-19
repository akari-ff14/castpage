import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages: https://akari-ff14.github.io/castpage/
//
// 入口は2つある。
//   index.html      → キャスト・管理者用のアプリ  /castpage/
//   book/index.html → お客様用の予約ページ        /castpage/book/
//
// ビルドを分けているのは見た目の都合ではなく、お客様に配るファイルの中に
// 売上や顧客リストを扱うコードを一切含めないため。2つは import を共有しない
// （supabase クライアントだけは同じものを使う）。
export default defineConfig({
  base: '/castpage/',
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        book: resolve(__dirname, 'book/index.html'),
      },
    },
  },
})
