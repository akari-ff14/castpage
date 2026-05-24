// ============================================================
// AkariApi — GAS Web App との通信ラッパー
// ============================================================
//
// 使い方:
//   const api = new AkariApi(import.meta.env.VITE_AKARI_API_URL)
//   const r = await api.login('6182')
//   if (r.ok) {
//     const session = await api.call('getActiveSession', r.data.castName)
//   }
//
// 重要な制約:
//   - GAS Web App は 302 リダイレクトする仕様上、Authorization ヘッダは消える。
//     必ず body.token として渡す。
//   - Content-Type は 'text/plain;charset=utf-8' で送る（CORSプリフライト回避）。

export type ApiResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: 'AUTH' | 'LOCKED' | string }

export interface LoginPayload {
  token: string
  castName: string
  exp: number  // Unix秒
}

const TOKEN_STORAGE_KEY = 'akari_token'
const CAST_STORAGE_KEY = 'akari_cast'

export class AkariApi {
  readonly url: string
  private token: string
  private castName: string

  constructor(url: string) {
    if (!url) throw new Error('AkariApi: API URL is required')
    this.url = url
    this.token = localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
    this.castName = localStorage.getItem(CAST_STORAGE_KEY) ?? ''
  }

  get isAuthenticated(): boolean {
    return !!this.token
  }

  get currentCastName(): string {
    return this.castName
  }

  async call<T = unknown>(fn: string, ...args: unknown[]): Promise<ApiResult<T>> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn, args, token: this.token }),
      redirect: 'follow',
    })
    const json = (await res.json()) as ApiResult<T>
    if (!json.ok && json.code === 'AUTH') this.logout()
    return json
  }

  async login(pin: string): Promise<ApiResult<LoginPayload>> {
    const r = await this.call<LoginPayload>('apiLogin', pin)
    if (r.ok) {
      this.token = r.data.token
      this.castName = r.data.castName
      localStorage.setItem(TOKEN_STORAGE_KEY, this.token)
      localStorage.setItem(CAST_STORAGE_KEY, this.castName)
    }
    return r
  }

  logout(): void {
    this.token = ''
    this.castName = ''
    localStorage.removeItem(TOKEN_STORAGE_KEY)
    localStorage.removeItem(CAST_STORAGE_KEY)
  }
}
