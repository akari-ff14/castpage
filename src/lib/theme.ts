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

export function getStoredTheme(): ThemeName {
  const t = localStorage.getItem(STORAGE_KEY)
  if (t === 'light' || t === 'midnight') return t
  return 'dark'
}
