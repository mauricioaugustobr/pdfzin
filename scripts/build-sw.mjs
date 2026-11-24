// Gera dist/sw.js depois do build: precacheia todos os arquivos do dist para o app
// abrir sem internet (depois da primeira visita) e ser instalável como app.
//
// O nome do cache carrega um hash do conteúdo do build. Deploy novo => cache novo,
// o antigo é apagado na ativação, e o app avisa quando tem versão nova pra recarregar.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

/** Lista todos os arquivos do dist, com caminho relativo em barras normais. */
function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(relative(dist, full).split(sep).join('/'));
  }
  return out;
}

const skip = new Set(['sw.js']);
const files = walk(dist)
  .filter((f) => !skip.has(f))
  .sort();

if (!files.includes('index.html')) {
  console.error('dist/index.html não encontrado: rode `vite build` antes.');
  process.exit(1);
}

// Hash do conteúdo (nome + tamanho + bytes) => muda a cada deploy que muda algo.
const hash = createHash('sha256');
for (const f of files) {
  const buf = readFileSync(join(dist, f));
  hash.update(f);
  hash.update(String(buf.length));
  hash.update(buf);
}
const buildId = hash.digest('hex').slice(0, 12);

const total = files.reduce((n, f) => n + statSync(join(dist, f)).size, 0);

const sw = `/* PDFZIN — service worker gerado no build (build ${buildId}). Não edite à mão. */
const CACHE = 'pdfzin-${buildId}';
const SCOPE = self.registration.scope;
const PRECACHE = ${JSON.stringify(files, null, 2)};

const ABS = PRECACHE.map((p) => new URL(p, SCOPE).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ABS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Abrir o app (navegação): sempre o index.html do cache, pra funcionar offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(new URL('index.html', SCOPE).href);
        if (cached) return cached;
        try {
          return await fetch(req);
        } catch {
          return new Response('PDFZIN está offline e ainda não foi salvo neste navegador.', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        }
      })()
    );
    return;
  }

  // Arquivos do app: cache primeiro; o que não estiver precacheado vai na rede e é guardado.
  event.respondWith(
    (async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(req, copy)).catch(() => {});
      }
      return res;
    })()
  );
});

// O app pede pra ativar a versão nova quando a pessoa clica em "Recarregar".
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
`;

writeFileSync(join(dist, 'sw.js'), sw);
console.log(
  `sw.js gerado: ${files.length} arquivos, ${(total / 1024 / 1024).toFixed(1)} MB, cache pdfzin-${buildId}`
);
