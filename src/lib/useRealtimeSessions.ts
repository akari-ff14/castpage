// Supabase Realtime を使って sessions テーブルの変更を購読するフック群。
//
// 全体方針:
//   - Postgres Change イベント (INSERT/UPDATE/DELETE) を受け取ったら、
//     ペイロードに依存せず該当データを再取得する（シンプルで堅牢）。
//   - 同じチャンネル名で複数コンポーネントが購読するのを避けるため、
//     useActiveSessions はモジュールレベルで1つのチャンネルを共有し、
//     複数の subscriber (コールバック) に通知する singleton パターンを採用。

import { useEffect, useState, useCallback, useRef, useId } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { supabase } from './supabase'
import { listAllActiveSessions, type SessionShape } from './db'

// ============================================================
// シングルトン購読: 全コンポーネントで1つのチャンネルを共有
// ============================================================

type ChangeListener = () => void
const _listeners = new Set<ChangeListener>()
let _sharedChannel: RealtimeChannel | null = null

function ensureSharedChannel() {
  if (_sharedChannel) return
  _sharedChannel = supabase
    .channel('akari-sessions-shared')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'sessions' },
      () => {
        // 全 subscriber に通知
        _listeners.forEach((cb) => {
          try { cb() } catch (e) { console.error('session listener error:', e) }
        })
      },
    )
    .subscribe()
}

function removeSharedChannelIfIdle() {
  if (_listeners.size === 0 && _sharedChannel) {
    supabase.removeChannel(_sharedChannel)
    _sharedChannel = null
  }
}

// ============================================================
// 進行中セッション一覧 (全キャスト分)
// ============================================================
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

    // シングルトン購読に subscriber を追加
    ensureSharedChannel()
    const listener: ChangeListener = () => reload()
    _listeners.add(listener)

    return () => {
      mountedRef.current = false
      _listeners.delete(listener)
      removeSharedChannelIfIdle()
    }
  }, [reload])

  return { sessions, loading, reload }
}

// ============================================================
// 単一セッションの変更を購読
// チャンネル名にコンポーネントごとのユニークIDを付与して衝突回避
// ============================================================
export function useSessionUpdates(sessionId: string | null | undefined, onChange: () => void) {
  const instanceId = useId()
  const cbRef = useRef(onChange)
  useEffect(() => {
    cbRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!sessionId) return
    const channel = supabase
      .channel(`session-${sessionId}-${instanceId}`)
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
  }, [sessionId, instanceId])
}
