import {
  BlendMode,
  LineCapStyle,
  LineJoinStyle,
  PDFDocument,
  PDFFont,
  PDFImage,
  PDFPage,
  StandardFonts,
  closePath,
  degrees,
  lineTo,
  moveTo,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setLineCap,
  setLineJoin,
  setLineWidth,
  setStrokingRgbColor,
  stroke,
} from 'pdf-lib';
import { LINE_HEIGHT, fromLocal, hexToRgb, textLines } from './geometry';
import type { Annot, DocState, FontSpec } from './types';

export class EncryptedPdfError extends Error {}

/** Monta o PDF final: páginas na ordem/giro atuais + edições gravadas no conteúdo da página. */
export async function buildPdf(sources: Uint8Array[], state: DocState, title?: string): Promise<Uint8Array> {
  const srcDocs = await Promise.all(
    sources.map(async (bytes) => {
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
      return doc;
    })
  );

  const out = await PDFDocument.create();
  out.setProducer('PDFZIN (https://github.com/mauricioaugustobr/pdfzin)');
  out.setCreator('PDFZIN');
  if (title) out.setTitle(title);

  // Copia por PDF de origem de uma vez (recursos como fontes não se repetem à toa).
  const copied = new Map<string, PDFPage>();
  for (let s = 0; s < srcDocs.length; s++) {
    const refs = state.pages.filter((p) => p.src === s);
    if (!refs.length) continue;
    if (srcDocs[s].isEncrypted) throw new EncryptedPdfError();
    const pages = await out.copyPages(srcDocs[s], refs.map((r) => r.index));
    refs.forEach((r, i) => copied.set(r.id, pages[i]));
  }

  const fonts = new Map<StandardFonts, Promise<PDFFont>>();
  const font = (spec?: FontSpec) => {
    const name = standardFont(spec);
    if (!fonts.has(name)) fonts.set(name, out.embedFont(name));
    return fonts.get(name)!;
  };
  const imageCache = new Map<string, PDFImage>();

  for (const ref of state.pages) {
    const page = out.addPage(copied.get(ref.id)!);
    const rotation = (((page.getRotation().angle + ref.rot) % 360) + 360) % 360;
    page.setRotation(degrees(rotation));
    for (const a of state.annots[ref.id] ?? []) await drawAnnot(out, page, a, font, imageCache);
  }

  return out.save();
}

async function drawAnnot(
  out: PDFDocument,
  page: PDFPage,
  a: Annot,
  font: (spec?: FontSpec) => Promise<PDFFont>,
  imageCache: Map<string, PDFImage>
): Promise<void> {
  switch (a.kind) {
    case 'rect': {
      if (a.mode === 'highlight') {
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(...hexToRgb(a.color)), opacity: 0.45, blendMode: BlendMode.Multiply });
      } else if (a.mode === 'whiteout') {
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, color: rgb(...hexToRgb(a.color)) });
      } else {
        page.drawRectangle({ x: a.x, y: a.y, width: a.w, height: a.h, borderColor: rgb(...hexToRgb(a.color)), borderWidth: a.width });
      }
      break;
    }
    case 'ink': {
      const [r, g, b] = hexToRgb(a.color);
      const p = a.points;
      const ops = [
        pushGraphicsState(),
        setStrokingRgbColor(r, g, b),
        setLineWidth(a.width),
        setLineCap(LineCapStyle.Round),
        setLineJoin(LineJoinStyle.Round),
        moveTo(p[0], p[1]),
      ];
      if (p.length === 2) ops.push(lineTo(p[0] + 0.01, p[1]));
      for (let i = 2; i < p.length; i += 2) ops.push(lineTo(p[i], p[i + 1]));
      if (p.length === 2) ops.push(closePath());
      ops.push(stroke(), popGraphicsState());
      page.pushOperators(...ops);
      break;
    }
    case 'text': {
      const color = rgb(...hexToRgb(a.color));
      const f = await font(a.font);
      textLines(a).forEach((line, i) => {
        const [x, y] = fromLocal(a, 0, -i * a.size * LINE_HEIGHT);
        const safe = encodable(f, line);
        if (safe) page.drawText(safe, { x, y, size: a.size, font: f, color, rotate: degrees(a.rot) });
      });
      break;
    }
    case 'image': {
      let img = imageCache.get(a.src);
      if (!img) {
        const bytes = dataUrlToBytes(a.src);
        img = a.src.startsWith('data:image/jpeg') ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        imageCache.set(a.src, img);
      }
      page.drawImage(img, { x: a.x, y: a.y, width: a.w, height: a.h, rotate: degrees(a.rot) });
      break;
    }
  }
}

const STANDARD: Record<FontSpec['family'], StandardFonts[]> = {
  // normal, negrito, itálico, negrito + itálico
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

function standardFont(spec?: FontSpec): StandardFonts {
  return STANDARD[spec?.family ?? 'sans'][(spec?.bold ? 1 : 0) + (spec?.italic ? 2 : 0)];
}

/** A Helvetica padrão só tem os caracteres do WinAnsi (português inteiro cabe). O resto vira "?". */
function encodable(font: PDFFont, text: string): string {
  let out = '';
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** PDF de exemplo, para quem quer testar sem ter um arquivo à mão. */
export async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle('Exemplo do PDFZIN');
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pages = [
    ['Bem-vindo ao PDFZIN', [
      'Este é um PDF de exemplo para você testar o editor.',
      'Experimente:',
      '• Editar texto: clique em "Aa Editar texto" e depois nesta frase.',
      '• Texto: clique em "T Texto" e depois em qualquer lugar da página.',
      '• Marca-texto: arraste por cima desta frase para destacá-la.',
      '• Desenho: faça um círculo em volta de alguma coisa.',
      '• Assinatura: desenhe a sua e posicione onde quiser.',
      '• Corretivo: cubra com branco o que não deve aparecer.',
      '• Páginas: gire, reordene ou exclua pela barra lateral.',
      '',
      'Quando terminar, clique em "Baixar PDF".',
      'Nada sai do seu computador: tudo roda no navegador.',
    ]],
    ['Contrato de exemplo', [
      'Cláusula 1. As partes acordam que este documento é só um teste.',
      'Cláusula 2. Ação, atenção, coração: acentos funcionam normalmente.',
      'Cláusula 3. Use esta página para testar a assinatura abaixo.',
      '',
      '',
      '_____________________________________',
      'Assinatura',
    ]],
    ['Página 3', ['Mova esta página para cima ou para baixo na lista ao lado.']],
  ] as const;
  for (const [title, lines] of pages) {
    const page = doc.addPage([595.28, 841.89]);
    page.drawRectangle({ x: 0, y: 781, width: 595.28, height: 61, color: rgb(0.086, 0.094, 0.114) });
    page.drawText('PDFZIN', { x: 48, y: 803, size: 20, font: bold, color: rgb(1, 0.42, 0.21) });
    page.drawText(title, { x: 48, y: 720, size: 26, font: bold, color: rgb(0.1, 0.1, 0.12) });
    lines.forEach((l, i) => page.drawText(l, { x: 48, y: 680 - i * 24, size: 13, font, color: rgb(0.2, 0.2, 0.24) }));
  }
  return doc.save();
}
