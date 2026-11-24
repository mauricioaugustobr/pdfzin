import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Gera o dist/sw.js: pega o molde em src/sw.js, injeta a lista de arquivos do build
 * e um hash do conteúdo (versão do cache) e grava o resultado no dist.
 */
function pdfzinServiceWorker(): Plugin {
  let root = process.cwd();
  let outDir = 'dist';

  return {
    name: 'pdfzin-service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = config.build.outDir;
    },
    closeBundle() {
      const dist = join(root, outDir);
      const files: string[] = [];
      const walk = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) walk(full);
          else files.push(relative(dist, full).split(sep).join('/'));
        }
      };
      walk(dist);

      const precache = files
        .filter((file) => file !== 'sw.js')
        .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

      const hash = createHash('sha256');
      for (const file of precache) hash.update(file).update(readFileSync(join(dist, file)));
      const version = hash.digest('hex').slice(0, 12);

      const source = readFileSync(join(root, 'src', 'sw.js'), 'utf8')
        .replace('__PDFZIN_VERSION__', version)
        .replace('__PDFZIN_PRECACHE__', JSON.stringify(precache));

      if (source.includes('__PDFZIN_')) {
        throw new Error('[pdfzin] src/sw.js ainda tem marcadores não substituídos.');
      }

      writeFileSync(join(dist, 'sw.js'), source);
      console.log(`\n[pdfzin] sw.js gerado — ${precache.length} arquivos, versão ${version}\n`);
    },
  };
}

/** Ordem de prioridade: o app primeiro, os recursos do PDF.js por último. */
function rank(file: string): number {
  if (file === 'index.html') return 0;
  if (file === 'manifest.webmanifest') return 1;
  if (file.endsWith('.js') || file.endsWith('.css')) return 2;
  if (file.startsWith('icons/')) return 3;
  if (file.startsWith('pdfjs/')) return 5;
  return 4;
}

export default defineConfig({
  // Base relativa: funciona em qualquer subcaminho (GitHub Pages etc.).
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
  plugins: [pdfzinServiceWorker()],
});
