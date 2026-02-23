// Обновляй CACHE_NAME при каждом деплое — deploy.bat делает это автоматически
const CACHE_NAME = 'linguavox-20260223';

self.addEventListener('install', () => {
  // Не делаем pre-caching — всегда берём актуальную версию из сети
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  // Удаляем старые версии кэша
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = event.request.url;

  // API и внешние ресурсы — всегда из сети, не кэшируем
  // L-01: добавлен fonts.gstatic (сами файлы .woff2 шрифтов)
  if (url.includes('workers.dev') ||
      url.includes('fonts.google') ||
      url.includes('fonts.gstatic')) return;

  // Стратегия: сеть первая → кэш обновляется → при офлайне отдаём кэш
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      })
      // Исправлено: возвращаем Response.error() если ресурса нет в кэше
      .catch(() => caches.match(event.request).then(r => r || Response.error()))
  );
});
