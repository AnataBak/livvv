// Cloudflare Worker — прокси для Gemini Live API.
// Принимает WebSocket от браузера и форвардит его в generativelanguage.googleapis.com.
// Полезно из стран, где Google AI API недоступен напрямую (Беларусь, Россия, Иран и пр.).
//
// Деплой:
//   1. Создай аккаунт на https://dash.cloudflare.com (бесплатно, без карты).
//   2. Workers & Pages → Create Worker → Start with Hello World!
//   3. Open editor → удали дефолтный код → вставь содержимое этого файла → Deploy.
//   4. Открой https://<worker-name>.<your-subdomain>.workers.dev/health — должно
//      вернуться "Liv proxy is alive...". Если так — прокси работает.
//   5. В Liv: Настройки → Маршрут → включить «через прокси» и вставить адрес.

const UPSTREAM_HOST = 'generativelanguage.googleapis.com';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // Обычный GET — отдаём табличку, чтобы было понятно, что прокси жив.
    if (upgradeHeader !== 'websocket') {
      if (url.pathname === '/' || url.pathname === '/health') {
        return new Response(
          'Liv proxy is alive. Use WebSocket to /ws/...\n',
          {
            headers: {
              'Content-Type': 'text/plain; charset=utf-8',
              'Access-Control-Allow-Origin': '*',
            },
          },
        );
      }
      return new Response('Expected WebSocket upgrade', { status: 426 });
    }

    // Целевой URL у Google — тот же путь и query, что прислал клиент.
    const upstreamUrl = `wss://${UPSTREAM_HOST}${url.pathname}${url.search}`;

    let upstream;
    try {
      const upstreamResp = await fetch(upstreamUrl, {
        headers: { Upgrade: 'websocket' },
      });
      upstream = upstreamResp.webSocket;
      if (!upstream) {
        return new Response('Failed to upgrade upstream connection', { status: 502 });
      }
    } catch (err) {
      return new Response('Upstream connect failed: ' + (err && err.message), { status: 502 });
    }
    upstream.accept();

    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    const closeBoth = (code, reason) => {
      try { server.close(code, reason); } catch (_) {}
      try { upstream.close(code, reason); } catch (_) {}
    };

    server.addEventListener('message', (event) => {
      try {
        upstream.send(event.data);
      } catch (_) {
        closeBoth(1011, 'forward to upstream failed');
      }
    });

    upstream.addEventListener('message', (event) => {
      try {
        server.send(event.data);
      } catch (_) {
        closeBoth(1011, 'forward to client failed');
      }
    });

    server.addEventListener('close', (event) => closeBoth(event.code || 1000, event.reason || ''));
    upstream.addEventListener('close', (event) => closeBoth(event.code || 1000, event.reason || ''));
    server.addEventListener('error', () => closeBoth(1011, 'client error'));
    upstream.addEventListener('error', () => closeBoth(1011, 'upstream error'));

    return new Response(null, { status: 101, webSocket: client });
  },
};
