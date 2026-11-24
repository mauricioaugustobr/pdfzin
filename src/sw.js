/* Service worker do PDFZIN.
 *
 * Este arquivo é um molde: o build injeta a versão (hash do conteúdo) e a lista de
 * arquivos do dist nas duas constantes abaixo, e grava o resultado em dist/sw.js.
 * Ele não é processado pelo TypeScript nem empacotado pelo Vite.
 *
 * Estratégia:
 *  - instala: guarda o app inteiro (HTML, CSS, JS, ícones e recursos do PDF.js) no cache;
 *  - navegação: rede primeiro (para pegar versão nova), cache como reserva offline;
 *  - demais arquivos: cache primeiro, rede depois (e guarda o que vier).
 */

const VERSION = '__PDFZIN_VERSION__';
const PRECACHE = __PDFZIN_PRECACHE__;
const CACHE = `pdfzin-${VERSION}`;
const OFFLINE_HTML = './index.html';

const scopeUrl = (path) => new URL(path, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Guarda em paralelo, mas em blocos, pra não abrir centenas de requisições de uma vez.
      const queue = [...PRECACHE];
      const workers = Array.from({ length: 6 }, async () => {
        while (queue.length) {
          const file = queue.shift();
          if (!file) return;
          try {
            const response = await fetch(scopeUrl(file), { cache: 'no-cache' });
            if (response.ok) await cache.put(scopeUrl(file), response);
          } catch {
            // Um arquivo que falhar não impede a instalação; ele cai na rede quando precisar.
          }
        }
      });
      await Promise.all(workers);
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith('pdfzin-') && key !== CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

// A página pede a troca quando o usuário clica em "Atualizar".
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(self.registration.scope)) return;

  // Abrir o app: tenta a rede (versão nova) e, sem internet, serve o HTML guardado.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          if (response.ok) {
            const cache = await caches.open(CACHE);
            await cache.put(scopeUrl(OFFLINE_HTML), response.clone());
          }
          return response;
        } catch {
          const cached = await caches.match(scopeUrl(OFFLINE_HTML));
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Arquivos: cache primeiro; o que não estiver guardado vai na rede e fica para a próxima.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok && response.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    })(),
  );
});
