// Supabase Realtime を使って sessions テーブルの変更を購読するフック群。
//
// 全体方針:
//   - Postgres Change イベント (INSERT/UPDATE/DELETE) を受け取ったら、
//     ペイロードに依存せず該当データを再取得する（シンプルで堅牢）。
//   - 1コンポーネント=1チャンネルだと購読数が増えるが、Free tier の
//     上限は 200 同時接続なので3キャスト×タブ数程度なら余裕。

import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from './supabase'
import { listAllActiveSessions, type SessionShape } from './db'

// ========================================
// 進行中セッション一覧 (全キャスト分)
// ========================================
export function useActiveSessions(): {
  sessions: SessionShape[]
  loading: boolean
  reload: () => Promise<void>
} {
  const [sessions, setSessions] = useState<SessionShape[]>([])
  const [loading, setLoading] = useState(true)
  const mountedRef = useRef(true)

  const reload = useCallback(async () => {
    try {
      const list = await listAllActiveSessions()
      if (mountedRef.current) {
        setSessions(list)
        setLoading(false)
      }
    } catch (e) {
      console.error('useActiveSessions reload failed:', e)
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    reload()

    // Realtime 購読: sessions の任意の変更で再フェッチ
    const channel = supabase
      .channel('active-sessions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'sessions' },
        () => {
          reload()
        },
      )
      .subscribe()

    return () => {
      mountedRef.current = false
      supabase.removeChannel(channel)
    }
  }, [reload])

  return { sessions, loading, reload }
}

// ========================================
// 単一セッションの変更を購読
// 自分のセッションが管理者に編集された等を即時反映するため
// ========================================
export function useSessionUpdates(sessionId: string | null | undefined, onChange: () => void) {
  // onChange を ref で持って、毎レンダで購読を貼り直さないようにする
  const cbRef = useRef(onChange)
  useEffect(() => {
    cbRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`session-${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'sessions',
          filter: `id=eq.${sessionId}`,
        },
        () => cbRef.current(),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
    }
  }, [sessionId])
}
