import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import BookApp from './BookApp'

// お客様用の予約ページ。キャスト用アプリ (src/main.tsx) とは別のバンドルになる。
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BookApp />
  </StrictMode>,
)
