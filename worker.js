// Cloudflare Worker — прокси для Groq API (Llama 3.3 70B)
// Принимает запросы в формате Gemini, конвертирует в Groq и обратно
// Ключ хранится как секрет: GROQ_KEY (Settings → Variables and Secrets)
// IP rate-limit: привяжи KV-namespace с именем KV (Workers → Settings → Bindings → KV)
//   Лимит: 60 запросов с одного IP за 30 минут (= 120/час, окно скользящее)

const ALLOWED_ORIGINS = [
  'https://aiba20.github.io',
];

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: cors });
    }

    // Проверяем источник запроса (H1: защита от внешних скраперов)
    const origin  = request.headers.get('Origin')  || '';
    const referer = request.headers.get('Referer') || '';
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o) || referer.startsWith(o));
    if (!allowed) {
      console.log(`[BLOCK] Forbidden origin="${origin}" referer="${referer}"`);
      return new Response(JSON.stringify({
        error: { code: 403, message: 'Forbidden', status: 'PERMISSION_DENIED' }
      }), { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    if (!env.GROQ_KEY) {
      console.error('[ERROR] GROQ_KEY secret not set');
      return new Response(JSON.stringify({
        error: { code: 500, message: 'GROQ_KEY secret not set', status: 'INTERNAL' }
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // IP rate limiting — 60 запросов за 30 минут (M1: скользящее окно вместо часового)
    if (env.KV) {
      const ip      = request.headers.get('CF-Connecting-IP') || 'unknown';
      const now     = new Date();
      // Ключ меняется каждые 30 мин: 'YYYY-MM-DDTHH:00' или 'YYYY-MM-DDTHH:30'
      const half    = now.getUTCMinutes() < 30 ? '00' : '30';
      const window  = now.toISOString().slice(0, 13) + ':' + half;
      const key     = `rl:${ip}:${window}`;
      const count   = parseInt(await env.KV.get(key) || '0');
      if (count >= 60) {
        console.log(`[RATE_LIMIT] ip=${ip} count=${count} window=${window}`);
        return new Response(JSON.stringify({
          error: { code: 429, message: 'Слишком много запросов с вашего IP. Подождите до следующего получаса.', status: 'RESOURCE_EXHAUSTED' }
        }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      await env.KV.put(key, String(count + 1), { expirationTtl: 1800 }); // TTL 30 мин
    }

    try {
      // Парсим запрос в формате Gemini
      const body = await request.json();
      const prompt = body.contents?.[0]?.parts?.[0]?.text || '';
      const maxTokens = body.generationConfig?.maxOutputTokens || 1024;
      const temperature = body.generationConfig?.temperature ?? 0.2;

      // Отправляем в Groq в формате OpenAI
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
          temperature: temperature,
        }),
      });

      const groqData = await groqResp.json();

      if (!groqResp.ok) {
        // L1: логируем ошибки Groq
        console.error(`[GROQ_ERROR] status=${groqResp.status} message=${groqData.error?.message}`);
        return new Response(JSON.stringify({
          error: {
            code: groqResp.status,
            message: groqData.error?.message || 'Groq error',
            status: groqResp.status === 429 ? 'RESOURCE_EXHAUSTED' : 'INTERNAL',
          }
        }), { status: groqResp.status, headers: { ...cors, 'Content-Type': 'application/json' } });
      }

      // Конвертируем ответ Groq в формат Gemini
      const text = groqData.choices?.[0]?.message?.content || '';
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }]
      }), { status: 200, headers: { ...cors, 'Content-Type': 'application/json' } });

    } catch (e) {
      console.error(`[EXCEPTION] ${e.message}`);
      return new Response(JSON.stringify({
        error: { code: 500, message: e.message, status: 'INTERNAL' }
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
