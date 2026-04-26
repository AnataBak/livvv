// Cloudflare Worker — прокси для Gemini Live API.
//
// Этот воркер живёт на домене `*.workers.dev`, который доступен из стран
// с блокировкой Google API (Беларусь, Россия и пр.), и форвардит WebSocket
// от браузера на upstream-сервер, который уже умеет дойти до Google.
//
// Поддерживаются два режима — выбирай тот, что проще:
//
//   1) Прямо в Google. UPSTREAM_HOST = 'generativelanguage.googleapis.com'.
//      Работает, только если Cloudflare сам по себе ходит к Google из
//      «разрешённой» страны. На бесплатном тарифе у Cloudflare есть
//      Smart Placement (Settings → Placement → Smart), но он не всегда
//      перемещает воркер в США/ЕС, и Google может блокировать узел в той
//      стране, куда CF его поставил.
//
//   2) Через цепочку CF → Fly.io → Google. UPSTREAM_HOST указывает на
//      Fly.io-приложение из ../fly-app, которое гарантированно живёт в
//      выбранном регионе США/ЕС. Этот вариант надёжнее.
//
// Деплой:
//   1. Создай аккаунт на https://dash.cloudflare.com (бесплатно, без карты).
//   2. Workers & Pages → Create Worker → Start with Hello World!
//   3. Open editor → удали дефолтный код → вставь содержимое этого файла →
//      замени UPSTREAM_HOST под себя → Deploy.
//   4. Открой https://<worker-name>.<your-subdomain>.workers.dev/health —
//      должно вернуться "Liv proxy is alive...". Если так — прокси работает.
//   5. В Liv: Настройки → Маршрут → включить «через прокси» и вставить адрес.

// Подставь сюда либо `generativelanguage.googleapis.com` (режим 1),
// либо адрес своего Fly.io-приложения (режим 2).
const UPSTREAM_HOST = 'livvv-proxy-dyqkxfjd.fly.dev';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const upgradeHeader = request.headers.get('Upgrade');

    // Любой обычный HTTP-запрос — отдаём диагностические странички,
    // чтобы было удобно отлаживать «работает ли вообще прокси».
    if (upgradeHeader !== 'websocket') {
      if (url.pathname === '/debug') {
        return debug(request);
      }
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

    // Тонкая, но критичная деталь: в CF Workers fetch() с заголовком
    // Upgrade: websocket нужно использовать схему `https://`, а не `wss://`.
    // С `wss://` Cloudflare отвечает «Fetch API cannot load: wss://...».
    const upstreamUrl = `https://${UPSTREAM_HOST}${url.pathname}${url.search}`;

    let upstream;
    try {
      const upstreamResp = await fetch(upstreamUrl, {
        headers: { Upgrade: 'websocket' },
      });
      upstream = upstreamResp.webSocket;
      if (!upstream) {
        return new Response(
          'Failed to upgrade upstream connection (status ' + upstreamResp.status + ')',
          { status: 502 },
        );
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

async function debug(request) {
  const cf = request.cf || {};

  let egressTrace = 'unavailable';
  try {
    const traceResp = await fetch('https://www.cloudflare.com/cdn-cgi/trace');
    egressTrace = await traceResp.text();
  } catch (err) {
    egressTrace = 'fetch failed: ' + (err && err.message);
  }

  let upstreamHealth = 'unavailable';
  try {
    const r = await fetch('https://' + UPSTREAM_HOST + '/health');
    upstreamHealth = r.status + ' ' + (await r.text()).slice(0, 200);
  } catch (err) {
    upstreamHealth = 'upstream fetch failed: ' + (err && err.message);
  }

  const body = [
    '== inbound (where YOU hit the worker) ==',
    'colo:    ' + (cf.colo || '?'),
    'country: ' + (cf.country || '?'),
    'region:  ' + (cf.region || '?'),
    '',
    '== outbound (where the worker calls upstream FROM) ==',
    egressTrace,
    '',
    '== upstream (' + UPSTREAM_HOST + ') /health ==',
    upstreamHealth,
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
