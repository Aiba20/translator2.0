// Cloudflare Worker — прокси для Groq API (Llama 3.3 70B)
// Принимает запросы в формате Gemini, конвертирует в Groq и обратно
// Ключ хранится как секрет: GROQ_KEY (Settings → Variables and Secrets)
// IP rate-limit: привяжи KV-namespace с именем KV (Workers → Settings → Bindings → KV)
//   Лимит: 120 запросов с одного IP в час
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

    if (!env.GROQ_KEY) {
      return new Response(JSON.stringify({
        error: { code: 500, message: 'GROQ_KEY secret not set', status: 'INTERNAL' }
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }

    // IP rate limiting (работает если привязан KV namespace с именем KV)
    if (env.KV) {
      const ip    = request.headers.get('CF-Connecting-IP') || 'unknown';
      const hour  = new Date().toISOString().slice(0, 13); // 'YYYY-MM-DDTHH'
      const key   = `rl:${ip}:${hour}`;
      const count = parseInt(await env.KV.get(key) || '0');
      if (count >= 120) {
        return new Response(JSON.stringify({
          error: { code: 429, message: 'Слишком много запросов с вашего IP. Подождите час.', status: 'RESOURCE_EXHAUSTED' }
        }), { status: 429, headers: { ...cors, 'Content-Type': 'application/json' } });
      }
      await env.KV.put(key, String(count + 1), { expirationTtl: 3600 });
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
        // Конвертируем ошибку Groq в формат Gemini
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
      return new Response(JSON.stringify({
        error: { code: 500, message: e.message, status: 'INTERNAL' }
      }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
  }
};
