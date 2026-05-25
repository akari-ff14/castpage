// AdminTab とサブコンポーネント間で共有する型定義
export type AdminSub =
  | 'home'
  | 'cast'
  | 'room'
  | 'pricing'
  | 'session'
  | 'budget'
  | 'insights'

export type AdminSubGroup = 'master' | 'ops' | 'analytics'
