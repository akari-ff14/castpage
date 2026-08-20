// キャスト・管理者用の Service Worker。
//
// お客様の予約ページ用 (book-sw.js) とは別に持つ。通知の文面も遷移先も違うし、
// scope も分けておくとどちらか一方だけを差し替えられる。
//
// ここでもページのキャッシュには関わらない。通知を出すことだけをする。

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = {}
  }

  const title = payload.title || '対話店［灯］'
  const options = {
    body: payload.body || '',
    icon: '/castpage/favicon.svg',
    badge: '/castpage/favicon.svg',
    // 予約ごとにまとめる。同じ予約で申込→変更と続いても積み上がらない
    tag: payload.tag || 'akari-staff',
    renotify: true,
    // 承認を促す通知なので、勝手に消えないようにする
    requireInteraction: true,
    data: { url: payload.url || '/castpage/' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/castpage/'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // すでに管理アプリを開いていれば、そのタブを前に出す
      for (const w of windows) {
        if (w.url.includes('/castpage/') && !w.url.includes('/castpage/book/')) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
