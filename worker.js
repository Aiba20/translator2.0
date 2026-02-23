// Cloudflare Worker — прокси для Groq API (Llama 3.3 70B)
// Ключ хранится как секрет: GROQ_KEY (Settings → Variables and Secrets)
// KV-namespace: привяжи с именем KV (Workers → Settings → Bindings → KV)
// Rate-limit: 30 запросов с одного IP в минуту (= лимит Groq Free tier)

const ALLOWED_ORIGINS = [
  'https://aiba20.github.io',
];

export default {
  async fetch(request, env) {

    // Извлекаем origin ДО определения CORS — нужен для динамического заголовка (fix M-01)
    const origin  = request.headers.get('Origin')  || '';
    const referer = request.headers.get('Referer') || '';
    const isAllowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));

    // M-01: динамический Allow-Origin вместо wildcard '*'
    const cors = {
      'Access-Control-Allow-Origin': isAllowed ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    // Проверяем источник запроса
    if (!isAllowed) {
      console.log(JSON.stringify({ type: 'BLOCK', origin, referer }));
      return new Response(JSON.stringify({
        error: { code: 403, message: 'Forbidden', status: 'PERMISSION_DENIED' }
      }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // H-01: ограничение размера тела запроса — защита от oversized payload DoS
    const contentLength = parseInt(request.headers.get('content-length') || '0');
    if (contentLength > 32_768) {
      console.log(JSON.stringify({ type: 'PAYLOAD_TOO_LARGE', size: contentLength, origin }));
      return new Response(JSON.stringify({
        error: { code: 413, message: 'Payload too large', status: 'INVALID_ARGUMENT' }
      }), { status: 413, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (!env.GROQ_KEY) {
      console.error(JSON.stringify({ type: 'CONFIG_ERROR', message: 'GROQ_KEY not set' }));
      return new Response(JSON.stringify({
        error: { code: 500, message: 'Server configuration error', status: 'INTERNAL' }
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // M-02: rate limiting — 30 запросов в минуту на IP (fixed-minute bucket)
    // Соответствует лимиту Groq Free tier (30 RPM), предотвращает бан аккаунта
    if (env.KV) {
      const ip     = request.headers.get('CF-Connecting-IP') || 'unknown';
      const minute = new Date().toISOString().slice(0, 16); // 'YYYY-MM-DDTHH:MM'
      const key    = `rl:${ip}:${minute}`;
      const count  = parseInt(await env.KV.get(key) || '0');
      if (count >= 30) {
        console.log(JSON.stringify({ type: 'RATE_LIMIT', ip, count, minute }));
        return new Response(JSON.stringify({
          error: { code: 429, message: 'Слишком много запросов. Подождите минуту.', status: 'RESOURCE_EXHAUSTED' }
        }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      await env.KV.put(key, String(count + 1), { expirationTtl: 60 }); // TTL 60 сек
    }

    try {
      const body        = await request.json();
      const prompt      = body.contents?.[0]?.parts?.[0]?.text || '';
      const maxTokens   = body.generationConfig?.maxOutputTokens || 1024;
      const temperature = body.generationConfig?.temperature ?? 0.2;

      // H-02: таймаут 25 сек на запрос к Groq — защита от зависания Worker
      const groqResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${env.GROQ_KEY}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [{ role: 'user', content: prompt }],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(25_000),
      });

      const groqData = await groqResp.json();

      if (!groqResp.ok) {
        console.error(JSON.stringify({ type: 'GROQ_ERROR', status: groqResp.status, message: groqData.error?.message }));
        return new Response(JSON.stringify({
          error: {
            code: groqResp.status,
            message: groqData.error?.message || 'Groq error',
            status: groqResp.status === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL',
          }
        }), { status: groqResp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      const text = groqData.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
      }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

    } catch (e) {
      const isTimeout = e.name === 'TimeoutError' || e.name === 'AbortError';
      console.error(JSON.stringify({ type: isTimeout ? 'GROQ_TIMEOUT' : 'EXCEPTION', message: e.message }));
      return new Response(JSON.stringify({
        error: {
          code: isTimeout ? 504 : 500,
          message: isTimeout ? 'Groq API не ответил вовремя. Попробуйте снова.' : 'Ошибка сервера',
          status: 'INTERNAL',
        }
      }), { status: isTimeout ? 504 : 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
