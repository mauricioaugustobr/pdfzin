import { FONT_STACK, LINE_HEIGHT, fromLocal, localBox, resizeHandle, textLines } from './geometry';
import type { Annot } from './types';

const images = new Map<string, HTMLImageElement>();

/** Imagem decodificada (com cache). Chama `onLoad` quando ainda não estava pronta. */
function getImage(src: string, onLoad: () => void): HTMLImageElement | null {
  let img = images.get(src);
  if (!img) {
    img = new Image();
    img.onload = onLoad;
    img.src = src;
    images.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

/**
 * Desenha as edições. O contexto já deve estar com a transformação do viewport do PDF.js
 * (espaço do usuário do PDF → pixels), então tudo aqui é em pontos do PDF, eixo Y para cima.
 */
export function drawAnnots(ctx: CanvasRenderingContext2D, annots: Annot[], onImageLoad: () => void): void {
  for (const a of annots) {
    ctx.save();
    switch (a.kind) {
      case 'rect':
        if (a.mode === 'highlight') {
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.45;
          ctx.fillStyle = a.color;
          ctx.fillRect(a.x, a.y, a.w, a.h);
        } else if (a.mode === 'whiteout') {
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(a.x, a.y, a.w, a.h);
        } else {
          ctx.strokeStyle = a.color;
          ctx.lineWidth = a.width;
          ctx.strokeRect(a.x, a.y, a.w, a.h);
        }
        break;
      case 'ink':
        ctx.strokeStyle = a.color;
        ctx.lineWidth = a.width;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(a.points[0], a.points[1]);
        if (a.points.length === 2) ctx.lineTo(a.points[0] + 0.01, a.points[1]);
        for (let i = 2; i < a.points.length; i += 2) ctx.lineTo(a.points[i], a.points[i + 1]);
        ctx.stroke();
        break;
      case 'text': {
        ctx.translate(a.x, a.y);
        ctx.rotate((a.rot * Math.PI) / 180);
        ctx.scale(1, -1);
        ctx.fillStyle = a.color;
        ctx.font = `${a.size}px ${FONT_STACK}`;
        ctx.textBaseline = 'alphabetic';
        textLines(a).forEach((line, i) => ctx.fillText(line, 0, i * a.size * LINE_HEIGHT));
        break;
      }
      case 'image': {
        const img = getImage(a.src, onImageLoad);
        if (img) {
          ctx.translate(a.x, a.y);
          ctx.rotate((a.rot * Math.PI) / 180);
          ctx.scale(1, -1);
          ctx.drawImage(img, 0, -a.h, a.w, a.h);
        }
        break;
      }
    }
    ctx.restore();
  }
}

/** Contorno e alça da edição selecionada. `px` = tamanho de 1 pixel de tela em pontos do PDF. */
export function drawSelection(ctx: CanvasRenderingContext2D, a: Annot, px: number): void {
  const b = localBox(a);
  const corners = [
    fromLocal(a, b.x0, b.y0),
    fromLocal(a, b.x1, b.y0),
    fromLocal(a, b.x1, b.y1),
    fromLocal(a, b.x0, b.y1),
  ];
  ctx.save();
  ctx.strokeStyle = '#2f6bff';
  ctx.lineWidth = 1.5 * px;
  ctx.setLineDash([5 * px, 4 * px]);
  ctx.beginPath();
  corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.stroke();
  const h = resizeHandle(a);
  if (h) {
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffffff';
    ctx.lineWidth = 2 * px;
    ctx.beginPath();
    ctx.arc(h[0], h[1], 6 * px, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
