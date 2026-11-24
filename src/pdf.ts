import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };
export type { PDFDocumentProxy, PDFPageProxy };

const assets = new URL('./pdfjs/', document.baseURI).href;

/** Abre um PDF a partir dos bytes. Pede a senha quando o arquivo é protegido. */
export async function openPdf(bytes: Uint8Array, askPassword: (retry: boolean) => string | null): Promise<PDFDocumentProxy> {
  let password: string | undefined;
  for (let retry = false; ; retry = true) {
    try {
      // O PDF.js transfere o buffer para o worker; mandamos uma cópia para manter os bytes originais.
      return await pdfjs.getDocument({
        data: bytes.slice(),
        password,
        cMapUrl: assets + 'cmaps/',
        cMapPacked: true,
        standardFontDataUrl: assets + 'standard_fonts/',
        wasmUrl: assets + 'wasm/',
        iccUrl: assets + 'iccs/',
        enableXfa: false,
      }).promise;
    } catch (err) {
      if ((err as Error)?.name !== 'PasswordException') throw err;
      const p = askPassword(retry);
      if (p === null) throw new Error('Senha não informada.');
      password = p;
    }
  }
}

/** Remove acentos e caixa, para a busca achar "acao" em "Ação". */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
