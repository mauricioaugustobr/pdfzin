// Gera os ícones do PWA (PNG) a partir do favicon.svg.
// Rode com: npm run icons
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const favicon = readFileSync(join(root, 'public', 'favicon.svg'), 'utf8');

// Ícone "any": o favicon como está (cantos transparentes fora do retângulo arredondado).
async function fromSvg(svg, size, file) {
  await sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(join(outDir, file));
  console.log(`${file} (${size}×${size})`);
}

// Ícone "maskable": fundo escuro de ponta a ponta e o desenho dentro da zona segura (80% central),
// para o Android poder recortar em círculo, squircle etc. sem cortar a marca.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#16181d"/>
  <g transform="translate(25,32) scale(7)">
    <path d="M18 10h20l10 10v34H18z" fill="#fff"/>
    <path d="M38 10v10h10" fill="#d9dce3"/>
    <path d="M24 44l14-14 4 4-14 14h-4z" fill="#ff6b35"/>
  </g>
</svg>`;

// Ícone da tela de início do iOS: quadrado opaco, sem transparência (o iOS aplica o recorte).
const appleTouch = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#16181d"/>
  <g transform="translate(25,32) scale(7)">
    <path d="M18 10h20l10 10v34H18z" fill="#fff"/>
    <path d="M38 10v10h10" fill="#d9dce3"/>
    <path d="M24 44l14-14 4 4-14 14h-4z" fill="#ff6b35"/>
  </g>
</svg>`;

await fromSvg(favicon, 192, 'icon-192.png');
await fromSvg(favicon, 512, 'icon-512.png');
await fromSvg(maskable, 512, 'icon-maskable-512.png');
await fromSvg(appleTouch, 180, 'apple-touch-icon.png');

// Guarda a fonte do maskable/apple ao lado dos PNGs, pra facilitar ajustes futuros.
writeFileSync(join(outDir, 'icon-maskable.svg'), maskable);
writeFileSync(join(outDir, 'apple-touch-icon.svg'), appleTouch);
console.log('Ícones gerados em public/icons/');
