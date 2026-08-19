// お客様の予約ページ用の Service Worker。
//
// やることは通知の表示だけ。ページのキャッシュには一切関わらない
// （オフライン対応をすると、古い空き状況を見せてしまう事故のほうが怖い）。
//
// scope は /castpage/book/ に絞って登録している。キャスト用アプリ側には効かない。

self.addEventListener('install', () => {
  // 新しい版をすぐ有効にする。通知の文面を直したときに古い版が残らないように
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
    // 同じ予約について複数回届いたときに積み上がらないよう、予約ごとにまとめる
    tag: payload.tag || 'akari-reservation',
    renotify: true,
    data: { url: payload.url || '/castpage/book/#/my' },
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/castpage/book/#/my'

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // すでに予約ページを開いていれば、そのタブを前に出す
      for (const w of windows) {
        if (w.url.includes('/castpage/book/')) return w.focus()
      }
      return self.clients.openWindow(url)
    }),
  )
})
