# LinguaVox — Контекст проекта для ИИ-ассистента

## Суть проекта
Личный голосовой переводчик для Android (Google Chrome).
Пользователь говорит — приложение переводит и озвучивает.
Проект для личного использования, не коммерческий.

---

## Деплой
- **GitHub Pages:** https://aiba20.github.io/translator2.0 (репозиторий `Aiba20/translator2.0`, ветка `main`)
- Деплой: `deploy.bat` — авторизация через GitHub CLI, `git push origin main`

---

## Архитектура

```
Браузер (index.html, PWA)
    ↓  POST /  (Gemini-формат запроса)
Cloudflare Worker (worker.js)  — прокси, IP rate-limit
    ↓  POST /openai/v1/chat/completions
Groq API (Llama 3.3 70B)
```

| Функция             | Технология                              |
|---------------------|-----------------------------------------|
| Распознавание речи  | Web Speech API (браузер, Chrome)        |
| Перевод             | Groq API — Llama 3.3 70B (через прокси)|
| Прокси / безопасность | Cloudflare Worker + KV rate-limit     |
| Озвучка (TTS)       | Web Speech Synthesis (браузер)          |
| Хостинг             | GitHub Pages                            |
| Оффлайн-кэш        | Service Worker (linguavox-v2)           |

---

## Секреты и ключи
- `GROQ_KEY` — хранится как **Cloudflare secret** (Settings → Variables and Secrets)
- В коде (`index.html`) ключей нет — только URL воркера
- Worker URL: `https://rough-cherry-2b43.timtim044.workers.dev/`

---

## Rate Limiting
- **Cloudflare KV** (`linguavox-rl`, binding: `KV`)
- Лимит: **60 запросов за 30 минут** с одного IP (= 120/час)
- Groq free tier: 14 400 req/день, 30 req/мин

---

## Языки
- **Режим «Я»:** Пользователь говорит по-русски → переводит на выбранный язык
  (Арабский, Турецкий, Английский + ещё 13 языков в списке)
- **Режим «Собеседник»:** Иностранный → Русский

---

## localStorage (данные в браузере)
| Ключ               | Назначение               | Лимит      |
|--------------------|--------------------------|------------|
| `lv_history`       | История переводов        | 50 записей |
| `lv_tr_cache`      | Кэш переводов            | 200 записей|
| `lv_chat`          | Чат-диалог               | 50 сообщ.  |
| `lv_custom_phrases`| Пользовательские фразы   | 30 фраз    |
| `lv_favorites`     | Избранные переводы       | —          |
| `lv_chars`         | Счётчик символов         | —          |
| `theme`            | Тема (dark/light)        | —          |
| `mode`             | Режим (ru/foreign)       | —          |

---

## Файлы проекта
| Файл           | Назначение                                    |
|----------------|-----------------------------------------------|
| `index.html`   | Всё приложение (~2300 строк, HTML+CSS+JS)     |
| `worker.js`    | Cloudflare Worker — прокси + rate limiting    |
| `sw.js`        | Service Worker — оффлайн-кэш (network-first) |
| `manifest.json`| PWA manifest                                  |
| `icon.svg`     | Иконка приложения                             |
| `deploy.bat`   | Скрипт деплоя на GitHub Pages                 |
| `.gitignore`   | Исключения для git                            |

---

## Ограничения
- Работает **только в Google Chrome или Edge** (Web Speech API)
- Нужен **интернет** (для перевода и распознавания речи)
- Пользователь на **Android**
