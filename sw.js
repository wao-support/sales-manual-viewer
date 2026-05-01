// =============================================================================
// Service Worker — オフラインキャッシュ
// 一度閲覧したマニュアルをオフラインでも表示可能にする
// =============================================================================

const CACHE_NAME = 'manual-viewer-v1';

// インストール時にアプリシェルをキャッシュ
const APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manuals.json',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

// アクティベート時に古いキャッシュを削除
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ時: ネットワーク優先 → キャッシュフォールバック
// 画像は取得後にキャッシュに保存（一度見たページはオフラインで表示可能）
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // 画像ファイルの場合: キャッシュ優先（ネットワークフォールバック）
  if (url.pathname.match(/\.(webp|png|jpg)$/)) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
    );
    return;
  }

  // その他: ネットワーク優先（キャッシュフォールバック）
  event.respondWith(
    fetch(event.request)
      .then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
