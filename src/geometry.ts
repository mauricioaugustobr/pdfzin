import type { Annot, TextAnnot } from './types';

export const FONT_STACK = 'Helvetica, Arial, "Liberation Sans", sans-serif';
export const LINE_HEIGHT = 1.2;

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const measureCtx = document.createElement('canvas').getContext('2d')!;

export function textLines(a: TextAnnot): string[] {
  return a.text.split('\n');
}

export function textWidth(line: string, size: number): number {
  measureCtx.font = `${size}px ${FONT_STACK}`;
  return measureCtx.measureText(line).width;
}

/** Caixa no sistema local da edição (origem em x,y; já girado quando houver `rot`). */
export function localBox(a: Annot): Box {
  switch (a.kind) {
    case 'text': {
      const lines = textLines(a);
      const w = Math.max(4, ...lines.map((l) => textWidth(l, a.size)));
      const lh = a.size * LINE_HEIGHT;
      return { x0: -2, y0: -(lines.length - 1) * lh - a.size * 0.3, x1: w + 2, y1: a.size };
    }
    case 'image':
      return { x0: 0, y0: 0, x1: a.w, y1: a.h };
    case 'rect':
      return { x0: 0, y0: 0, x1: a.w, y1: a.h };
    case 'ink': {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < a.points.length; i += 2) {
        x0 = Math.min(x0, a.points[i]);
        x1 = Math.max(x1, a.points[i]);
        y0 = Math.min(y0, a.points[i + 1]);
        y1 = Math.max(y1, a.points[i + 1]);
      }
      const p = a.width / 2 + 2;
      return { x0: x0 - p, y0: y0 - p, x1: x1 + p, y1: y1 + p };
    }
  }
}

export function origin(a: Annot): { x: number; y: number; rot: number } {
  if (a.kind === 'ink') return { x: 0, y: 0, rot: 0 };
  if (a.kind === 'rect') return { x: a.x, y: a.y, rot: 0 };
  return { x: a.x, y: a.y, rot: a.rot };
}

/** Converte um ponto do PDF para o sistema local da edição. */
export function toLocal(a: Annot, px: number, py: number): [number, number] {
  const o = origin(a);
  const r = (-o.rot * Math.PI) / 180;
  const dx = px - o.x, dy = py - o.y;
  return [dx * Math.cos(r) - dy * Math.sin(r), dx * Math.sin(r) + dy * Math.cos(r)];
}

/** Converte um ponto local da edição para o PDF. */
export function fromLocal(a: Annot, lx: number, ly: number): [number, number] {
  const o = origin(a);
  const r = (o.rot * Math.PI) / 180;
  return [o.x + lx * Math.cos(r) - ly * Math.sin(r), o.y + lx * Math.sin(r) + ly * Math.cos(r)];
}

export function hitTest(a: Annot, px: number, py: number, tolerance: number): boolean {
  const [lx, ly] = toLocal(a, px, py);
  const b = localBox(a);
  if (lx < b.x0 - tolerance || lx > b.x1 + tolerance || ly < b.y0 - tolerance || ly > b.y1 + tolerance) return false;
  if (a.kind !== 'ink') return true;
  // Desenho: perto de algum segmento do traço.
  const lim = a.width / 2 + tolerance;
  for (let i = 0; i + 3 < a.points.length; i += 2) {
    if (distToSegment(px, py, a.points[i], a.points[i + 1], a.points[i + 2], a.points[i + 3]) <= lim) return true;
  }
  return a.points.length === 2 && Math.hypot(px - a.points[0], py - a.points[1]) <= lim;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1, dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Alça de redimensionar: canto de baixo à direita (local), para imagens e retângulos. */
export function resizeHandle(a: Annot): [number, number] | null {
  if (a.kind !== 'image' && a.kind !== 'rect') return null;
  return fromLocal(a, a.w, 0);
}

export function moveAnnot(a: Annot, dx: number, dy: number): void {
  if (a.kind === 'ink') {
    for (let i = 0; i < a.points.length; i += 2) {
      a.points[i] += dx;
      a.points[i + 1] += dy;
    }
  } else {
    a.x += dx;
    a.y += dy;
  }
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
