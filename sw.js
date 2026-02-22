// Меняй версию при каждом деплое на GitHub Pages
// чтобы пользователи получали обновление немедленно
const CACHE_NAME = 'linguavox-v1';

self.addEventListener('install', event => {
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
  if (url.includes('cognitive.microsofttranslator.com') || url.includes('fonts.google')) return;

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
      .catch(() => caches.match(event.request))
  );
});
