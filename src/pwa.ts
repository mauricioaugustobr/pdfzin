// PWA do PDFZIN: instalação, funcionamento offline e atualização do service worker.

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type Toast = (message: string, error?: boolean) => void;

interface PwaOptions {
  toast: Toast;
}

let installPrompt: InstallPromptEvent | null = null;
let askedUpdate = false;
let reloading = false;

function byId<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function isStandalone(): boolean {
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone;
  return window.matchMedia('(display-mode: standalone)').matches || ios === true;
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  // iPadOS 13+ se apresenta como Mac; o toque distingue de um Mac de verdade.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function initPwa({ toast }: PwaOptions): void {
  setupInstallButton(toast);
  setupInstallNote();
  setupConnectionToasts(toast);
  registerServiceWorker(toast);
}

// ---------------------------------------------------------------------------
// Instalação
// ---------------------------------------------------------------------------

function setupInstallButton(toast: Toast): void {
  const button = byId<HTMLButtonElement>('btn-install');
  if (!button) return;

  if (isStandalone()) {
    button.hidden = true;
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    button.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    button.hidden = true;
    toast('PDFZIN instalado! Abra pelo ícone e ele funciona até sem internet.');
  });

  button.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    button.hidden = true;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome !== 'accepted') {
      toast('Sem problema — o PDFZIN continua funcionando aqui no navegador.');
    }
  });
}

/** Aviso na tela inicial: como instalar no iPhone (que não tem botão automático). */
function setupInstallNote(): void {
  const note = byId<HTMLElement>('install-note');
  if (!note) return;

  if (isStandalone()) {
    note.hidden = true;
    return;
  }

  if (!isIos() || localStorage.getItem('pdfzin:ios-hint') === 'dismissed') return;

  note.hidden = false;
  note.textContent = 'No iPhone ou iPad: toque em Compartilhar e depois em “Adicionar à Tela de Início”.';
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'linklike';
  dismiss.textContent = 'Ok, entendi';
  dismiss.addEventListener('click', () => {
    localStorage.setItem('pdfzin:ios-hint', 'dismissed');
    note.hidden = true;
  });
  note.append(' ', dismiss);
}

// ---------------------------------------------------------------------------
// Offline
// ---------------------------------------------------------------------------

function setupConnectionToasts(toast: Toast): void {
  window.addEventListener('offline', () => {
    toast('Você está sem internet. O PDFZIN continua funcionando com os arquivos já salvos no aparelho.');
  });
  window.addEventListener('online', () => {
    toast('Conexão de volta.');
  });
}

// ---------------------------------------------------------------------------
// Service worker e atualização
// ---------------------------------------------------------------------------

function registerServiceWorker(toast: Toast): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    void (async () => {
      const hadController = Boolean(navigator.serviceWorker.controller);
      let registration: ServiceWorkerRegistration;
      try {
        registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI).href, {
          scope: './',
        });
      } catch (error) {
        console.warn('PDFZIN: não foi possível registrar o service worker.', error);
        return;
      }

      // Primeira instalação: avisa que agora dá para usar offline.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) {
          reloading = false;
          location.reload();
          return;
        }
        if (!hadController) {
          toast('Pronto: o PDFZIN agora abre e funciona sem internet.');
        }
      });

      if (registration.waiting && navigator.serviceWorker.controller) {
        showUpdateButton(registration.waiting, toast);
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateButton(installing, toast);
          }
        });
      });

      // Procura versão nova de vez em quando (o navegador também checa sozinho).
      window.setInterval(() => void registration.update().catch(() => {}), 60 * 60 * 1000);
    })();
  });
}

function showUpdateButton(worker: ServiceWorker, toast: Toast): void {
  const button = byId<HTMLButtonElement>('btn-update');
  if (!button || !button.hidden) return;

  button.hidden = false;
  button.addEventListener('click', () => {
    if (askedUpdate) return;
    askedUpdate = true;
    button.disabled = true;
    button.textContent = 'Atualizando…';
    reloading = true;
    worker.postMessage('SKIP_WAITING');
    // Se o worker novo não assumir em alguns segundos, avisa em vez de ficar travado.
    window.setTimeout(() => {
      if (!reloading) return;
      reloading = false;
      askedUpdate = false;
      button.disabled = false;
      button.textContent = '↻ Atualizar';
      toast('A atualização não terminou. Feche e abra o PDFZIN para tentar de novo.', true);
    }, 10000);
  });
}
