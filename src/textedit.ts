// Edição do texto original: o PDF.js diz onde está cada trecho de texto da página; juntamos os
// trechos em linhas e, ao editar, cobrimos a linha com a cor do fundo e escrevemos o texto novo
// por cima, na mesma posição, tamanho e cor, com a fonte padrão mais parecida.

import type { PDFPageProxy } from './pdf';
import type { FontSpec } from './types';

export interface TextLine {
  text: string;
  /** Início da linha de base, no espaço do usuário do PDF. */
  x: number;
  y: number;
  /** Ângulo da linha (graus, anti-horário). */
  rot: number;
  size: number;
  width: number;
  /** Altura acima e abaixo da linha de base, em pontos. */
  ascent: number;
  descent: number;
  font: FontSpec;
}

interface FontInfo {
  name?: string;
  bold?: boolean;
  black?: boolean;
  italic?: boolean;
  isSerifFont?: boolean;
  isMonospace?: boolean;
}

interface Style {
  fontFamily?: string;
  ascent?: number;
  descent?: number;
}

/** Linhas de texto da página, na ordem em que o PDF as desenha. */
export async function textLinesOf(page: PDFPageProxy): Promise<TextLine[]> {
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, Style>;
  const lines: TextLine[] = [];
  let cur: TextLine | null = null;
  for (const it of content.items) {
    if (!('str' in it)) continue;
    if (!it.str.trim()) {
      if (it.hasEOL) cur = null;
      continue;
    }
    const [a, b, c, d, e, f] = it.transform as number[];
    const size = Math.hypot(c, d) || Math.hypot(a, b);
    if (size < 1) continue;
    const rot = (Math.atan2(b, a) * 180) / Math.PI;
    const style = styles[it.fontName] ?? {};
    const font = fontOf(page, it.fontName, style);
    const r = (rot * Math.PI) / 180;
    let joined = false;
    if (cur && Math.abs(cur.rot - rot) < 1 && Math.abs(cur.size - size) < size * 0.15 && sameFont(cur.font, font)) {
      // Posição do trecho no sistema da linha atual.
      const dx = e - cur.x, dy = f - cur.y;
      const along = dx * Math.cos(r) + dy * Math.sin(r);
      const across = -dx * Math.sin(r) + dy * Math.cos(r);
      const gap = along - cur.width;
      if (Math.abs(across) < size * 0.2 && gap > -size * 0.5 && gap < size * 1.5) {
        if (gap > size * 0.15 && !cur.text.endsWith(' ') && !it.str.startsWith(' ')) cur.text += ' ';
        cur.text += it.str;
        cur.width = Math.max(cur.width, along + it.width);
        joined = true;
      }
    }
    if (!joined) {
      const ascent = Math.max(style.ascent || 0.8, 0.7);
      const descent = Math.min(Math.abs(style.descent || 0.22), 0.35);
      cur = { text: it.str, x: e, y: f, rot, size, width: it.width, ascent: ascent * size, descent: descent * size, font };
      lines.push(cur);
    }
    if (it.hasEOL) cur = null;
  }
  for (const l of lines) l.text = l.text.trim();
  return lines.filter((l) => l.text);
}

function sameFont(a: FontSpec, b: FontSpec): boolean {
  return a.family === b.family && a.bold === b.bold && a.italic === b.italic;
}

function fontOf(page: PDFPageProxy, fontName: string, style: Style): FontSpec {
  let info: FontInfo = {};
  try {
    // Depois que a página foi desenhada, o PDF.js guarda os dados de cada fonte aqui.
    if (page.commonObjs.has(fontName)) info = page.commonObjs.get(fontName) as FontInfo;
  } catch {
    // Sem os dados da fonte: fica só com a família que o PDF.js deduziu.
  }
  const name = (info.name ?? '').replace(/^[A-Z]{6}\+/, '');
  const family: FontSpec['family'] =
    info.isMonospace || /courier|mono|consol/i.test(name) || style.fontFamily === 'monospace'
      ? 'mono'
      : info.isSerifFont || /times|serif|roman|georgia|garamond|cambria|book/i.test(name.replace(/sans/i, '')) || style.fontFamily === 'serif'
        ? 'serif'
        : 'sans';
  return {
    family,
    bold: !!(info.bold || info.black) || /bold|black|heavy|semibold|demi|[-,]bd\b/i.test(name),
    italic: !!info.italic || /italic|oblique|[-,]it\b/i.test(name),
  };
}

/** Converte um ponto do PDF para o sistema da linha (origem no início da linha de base). */
function toLine(l: TextLine, px: number, py: number): [number, number] {
  const r = (l.rot * Math.PI) / 180;
  const dx = px - l.x, dy = py - l.y;
  return [dx * Math.cos(r) + dy * Math.sin(r), -dx * Math.sin(r) + dy * Math.cos(r)];
}

/** Os 4 cantos da linha no PDF. */
export function lineCorners(l: TextLine): [number, number][] {
  const r = (l.rot * Math.PI) / 180;
  const pts: [number, number][] = [
    [0, -l.descent],
    [l.width, -l.descent],
    [l.width, l.ascent],
    [0, l.ascent],
  ];
  return pts.map(([lx, ly]) => [l.x + lx * Math.cos(r) - ly * Math.sin(r), l.y + lx * Math.sin(r) + ly * Math.cos(r)]);
}

/** Retângulo (alinhado à página) que cobre a linha inteira, com uma folguinha. */
export function lineCover(l: TextLine): { x: number; y: number; w: number; h: number } {
  const c = lineCorners(l);
  const pad = Math.max(0.6, l.size * 0.04);
  const xs = c.map((p) => p[0]), ys = c.map((p) => p[1]);
  const x = Math.min(...xs) - pad, y = Math.min(...ys) - pad;
  return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
}

export function lineAt(lines: TextLine[], px: number, py: number, tolerance: number): TextLine | null {
  // A última desenhada fica por cima.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    const [lx, ly] = toLine(l, px, py);
    if (lx >= -tolerance && lx <= l.width + tolerance && ly >= -l.descent - tolerance && ly <= l.ascent + tolerance) return l;
  }
  return null;
}

/**
 * Lê no desenho da página a cor do fundo (a mais comum na borda em volta da linha) e a cor do
 * texto (os pixels mais diferentes do fundo dentro da linha). `box` em pixels do canvas.
 */
export function sampleColors(canvas: HTMLCanvasElement, box: { x: number; y: number; w: number; h: number }): { bg: string; fg: string } {
  const m = 3;
  const x0 = Math.max(0, Math.floor(box.x) - m), y0 = Math.max(0, Math.floor(box.y) - m);
  const x1 = Math.min(canvas.width, Math.ceil(box.x + box.w) + m), y1 = Math.min(canvas.height, Math.ceil(box.y + box.h) + m);
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return { bg: '#ffffff', fg: '#000000' };
  const { data } = canvas.getContext('2d', { willReadFrequently: true })!.getImageData(x0, y0, w, h);
  const inside = (x: number, y: number) => x0 + x >= box.x && x0 + x < box.x + box.w && y0 + y >= box.y && y0 + y < box.y + box.h;

  const buckets = new Map<number, [number, number, number, number]>();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (inside(x, y)) continue;
      const i = (y * w + x) * 4;
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      const s = buckets.get(key) ?? [0, 0, 0, 0];
      s[0] += data[i];
      s[1] += data[i + 1];
      s[2] += data[i + 2];
      s[3]++;
      buckets.set(key, s);
    }
  let best: [number, number, number, number] = [255, 255, 255, 1];
  for (const s of buckets.values()) if (s[3] > best[3]) best = s;
  const bg: [number, number, number] = [best[0] / best[3], best[1] / best[3], best[2] / best[3]];

  const dist = (i: number) => Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]);
  let max = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (inside(x, y)) max = Math.max(max, dist((y * w + x) * 4));
  if (max < 30) return { bg: toHex(bg), fg: bg[0] + bg[1] + bg[2] > 384 ? '#000000' : '#ffffff' };
  const fg = [0, 0, 0];
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!inside(x, y) || dist(i) < max * 0.85) continue;
      fg[0] += data[i];
      fg[1] += data[i + 1];
      fg[2] += data[i + 2];
      n++;
    }
  return { bg: toHex(bg), fg: toHex([fg[0] / n, fg[1] / n, fg[2] / n]) };
}

function toHex(c: number[]): string {
  return '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}
