// Modo offline: registra o service worker gerado no build (scripts/build-sw.mjs) para o
// app abrir sem internet depois da primeira visita, e avisa quando tem versão nova.
//
// Só roda no build de produção: em `npm run dev` o sw.js não existe.

export function setupOffline(): void {
  if (!import.meta.env.PROD) return;
  if (!('serviceWorker' in navigator)) return;
  // file:// não tem origem válida pra service worker.
  if (location.protocol === 'file:') return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });

  window.addEventListener('load', () => {
    const swUrl = new URL('sw.js', document.baseURI);
    navigator.serviceWorker
      .register(swUrl, { scope: './' })
      .then((reg) => {
        // Já tinha uma versão nova esperando (ex.: aba aberta durante o deploy).
        if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdateBar(reg);
            }
          });
        });

        // Voltar pra aba também procura atualização (sem depender de recarregar).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') void reg.update().catch(() => {});
        });
      })
      .catch(() => {
        // Sem service worker o app continua funcionando, só não fica offline.
      });
  });
}

function showUpdateBar(reg: ServiceWorkerRegistration): void {
  if (document.getElementById('sw-update')) return;

  const bar = document.createElement('div');
  bar.id = 'sw-update';
  bar.className = 'sw-update';
  bar.setAttribute('role', 'status');

  const text = document.createElement('span');
  text.textContent = 'Nova versão do PDFZIN disponível.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn small primary';
  button.textContent = 'Recarregar';
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Atualizando…';
    // controllerchange recarrega a página quando o novo worker assume.
    if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    else location.reload();
  });

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'icon-btn';
  close.setAttribute('aria-label', 'Dispensar aviso de atualização');
  close.textContent = '×';
  close.addEventListener('click', () => bar.remove());

  bar.append(text, button, close);
  document.body.append(bar);
}
