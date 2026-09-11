// テーマ適用ユーティリティ

export type ThemeName = 'dark' | 'light' | 'midnight'

const STORAGE_KEY = 'akari_theme'

export function applyTheme(theme: ThemeName) {
  localStorage.setItem(STORAGE_KEY, theme)
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme')
  } else {
    document.documentElement.setAttribute('data-theme', theme)
  }
}

// 既定はライト。まだ選んだことがない人にだけ効くので、
// すでに使っている端末は保存済みの見た目のまま（設定タブで変えられる）
export function getStoredTheme(): ThemeName {
  const t = localStorage.getItem(STORAGE_KEY)
  if (t === 'dark' || t === 'midnight') return t
  return 'light'
}
