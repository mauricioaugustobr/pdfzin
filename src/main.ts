import './style.css';
import { PDFDocument, degrees } from 'pdf-lib';
import { drawAnnots, drawSelection } from './draw';
import { hitTest, moveAnnot, resizeHandle, toLocal, uid } from './geometry';
import { setupOffline } from './offline';
import { normalize, openPdf, pdfjs } from './pdf';
import type { PDFDocumentProxy, PDFPageProxy } from './pdf';
import { EncryptedPdfError, buildPdf, samplePdf } from './save';
import type { Annot, DocState, ImageAnnot, PageRef, TextAnnot, Tool } from './types';

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

interface Source {
  name: string;
  bytes: Uint8Array;
  doc: PDFDocumentProxy;
}

interface PageView {
  ref: PageRef;
  page: PDFPageProxy;
  el: HTMLDivElement;
  canvas: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  textEl: HTMLDivElement;
  viewport: ReturnType<PDFPageProxy['getViewport']>;
  rendered: boolean;
  task: { cancel(): void } | null;
  textDivs: HTMLElement[];
}

let sources: Source[] = [];
let state: DocState = { pages: [], annots: {} };
let undoStack: string[] = [];
let redoStack: string[] = [];
let tool: Tool = 'read';
let scale = 1;
let dirty = false;
let selected: { pageId: string; annotId: string } | null = null;
let currentPageId: string | null = null;
const views = new Map<string, PageView>();
const pageCache = new Map<string, PDFPageProxy>();
const textCache = new Map<string, string>();

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const viewer = $('viewer');
const pagesEl = $('pages');
const thumbsEl = $('thumbs');
const colorInput = $<HTMLInputElement>('color');
const sizeInput = $<HTMLInputElement>('font-size');
const strokeInput = $<HTMLInputElement>('stroke');
const searchInput = $<HTMLInputElement>('search');

// ---------------------------------------------------------------------------
// Utilidades de interface
// ---------------------------------------------------------------------------

let toastTimer = 0;
function toast(msg: string, error = false): void {
  const el = $('toast');
  el.textContent = msg;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('show'), error ? 6000 : 2600);
}

function pageKey(ref: PageRef): string {
  return `${ref.src}:${ref.index}`;
}

async function getPage(ref: PageRef): Promise<PDFPageProxy> {
  const key = pageKey(ref);
  let p = pageCache.get(key);
  if (!p) {
    p = await sources[ref.src].doc.getPage(ref.index + 1);
    pageCache.set(key, p);
  }
  return p;
}

function rotationOf(page: PDFPageProxy, ref: PageRef): number {
  return (page.rotate + ref.rot) % 360;
}

function annotsOf(pageId: string): Annot[] {
  return (state.annots[pageId] ??= []);
}

function findSelected(): Annot | null {
  if (!selected) return null;
  return state.annots[selected.pageId]?.find((a) => a.id === selected!.annotId) ?? null;
}

function updateButtons(): void {
  const has = state.pages.length > 0;
  $<HTMLButtonElement>('btn-save').disabled = !has;
  $<HTMLButtonElement>('btn-merge').disabled = !has;
  $<HTMLButtonElement>('btn-blank').disabled = !has;
  $<HTMLButtonElement>('btn-undo').disabled = !undoStack.length;
  $<HTMLButtonElement>('btn-redo').disabled = !redoStack.length;
  $<HTMLButtonElement>('btn-delete').disabled = !findSelected();
  searchInput.disabled = !has;
  $('empty').hidden = has;
  $('page-count').textContent = has ? String(state.pages.length) : '';
  $('filename').textContent = sources[0]?.name ?? '';
  document.title = sources[0] ? `${dirty ? '• ' : ''}${sources[0].name} — PDFZIN` : 'PDFZIN — leitor e editor de PDF grátis e open source';
}

// ---------------------------------------------------------------------------
// Histórico (desfazer/refazer)
// ---------------------------------------------------------------------------

const snapshot = () => JSON.stringify(state);

/** Guarda o estado antes de uma mudança. Devolve uma função que descarta o ponto se nada mudou. */
function checkpoint(): () => void {
  const before = snapshot();
  undoStack.push(before);
  if (undoStack.length > 200) undoStack.shift();
  redoStack = [];
  return () => {
    if (snapshot() === before) undoStack.pop();
    else markDirty();
    updateButtons();
  };
}

function markDirty(): void {
  dirty = true;
  updateButtons();
}

async function restore(json: string): Promise<void> {
  const samePages = JSON.stringify(JSON.parse(json).pages) === JSON.stringify(state.pages);
  state = JSON.parse(json);
  selected = null;
  dirty = true;
  if (samePages) views.forEach(drawOverlay);
  else await rebuild();
  updateButtons();
}

async function undo(): Promise<void> {
  const prev = undoStack.pop();
  if (prev === undefined) return;
  redoStack.push(snapshot());
  await restore(prev);
}

async function redo(): Promise<void> {
  const next = redoStack.pop();
  if (next === undefined) return;
  undoStack.push(snapshot());
  await restore(next);
}

// ---------------------------------------------------------------------------
// Abrir arquivos
// ---------------------------------------------------------------------------

async function loadSource(bytes: Uint8Array, name: string): Promise<number> {
  const doc = await openPdf(bytes, (retry) =>
    prompt(retry ? 'Senha incorreta. Tente de novo:' : `"${name}" é protegido por senha. Digite a senha:`)
  );
  sources.push({ name, bytes, doc });
  return sources.length - 1;
}

async function openFile(file: File): Promise<void> {
  if (dirty && !confirm('Você tem edições não salvas. Abrir outro PDF mesmo assim?')) return;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes, file.name);
  } catch (err) {
    console.error(err);
    toast(`Não consegui abrir "${file.name}". Ele é mesmo um PDF?`, true);
  }
}

async function openBytes(bytes: Uint8Array, name: string): Promise<void> {
  const old = sources;
  sources = [];
  try {
    const src = await loadSource(bytes, name);
    old.forEach((s) => s.doc.loadingTask.destroy());
    pageCache.clear();
    textCache.clear();
    thumbCache.clear();
    const n = sources[src].doc.numPages;
    state = { pages: Array.from({ length: n }, (_, i) => ({ id: uid(), src, index: i, rot: 0 })), annots: {} };
    undoStack = [];
    redoStack = [];
    selected = null;
    dirty = false;
    clearSearch();
    // Ajusta à largura, sem passar de 130% em telas largas.
    scale = Math.min(1.3, await fitWidthScale());
    await rebuild();
    viewer.scrollTop = 0;
    updateButtons();
  } catch (err) {
    sources = old;
    throw err;
  }
}

async function mergeFiles(files: FileList): Promise<void> {
  const done = checkpoint();
  let added = 0;
  for (const file of Array.from(files)) {
    try {
      const src = await loadSource(new Uint8Array(await file.arrayBuffer()), file.name);
      for (let i = 0; i < sources[src].doc.numPages; i++) state.pages.push({ id: uid(), src, index: i, rot: 0 });
      added++;
    } catch (err) {
      console.error(err);
      toast(`Não consegui juntar "${file.name}".`, true);
    }
  }
  done();
  if (added) {
    await rebuild();
    toast(added > 1 ? `${added} PDFs adicionados no final.` : 'PDF adicionado no final.');
  }
}

async function insertBlank(): Promise<void> {
  const at = currentPageId ? state.pages.findIndex((p) => p.id === currentPageId) : state.pages.length - 1;
  const ref = state.pages[at];
  const base = ref ? await getPage(ref) : null;
  const [x0, y0, x1, y1] = base?.view ?? [0, 0, 595.28, 841.89];
  const doc = await PDFDocument.create();
  const page = doc.addPage([x1 - x0, y1 - y0]);
  if (base) page.setRotation(degrees(rotationOf(base, ref)));
  const src = await loadSource(await doc.save(), 'em-branco.pdf');
  const done = checkpoint();
  const id = uid();
  state.pages.splice(at + 1, 0, { id, src, index: 0, rot: 0 });
  done();
  await rebuild();
  scrollToPage(id);
}

// ---------------------------------------------------------------------------
// Visualização das páginas
// ---------------------------------------------------------------------------

const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      const view = views.get((e.target as HTMLElement).dataset.id!);
      if (!view) continue;
      if (e.isIntersecting) renderPage(view);
      else unrenderPage(view);
    }
  },
  { root: viewer, rootMargin: '800px 0px' }
);

async function fitWidthScale(): Promise<number> {
  if (!state.pages.length && !sources.length) return 1;
  const ref = state.pages[0] ?? { id: '', src: sources.length - 1, index: 0, rot: 0 };
  const page = await getPage(ref);
  const vp = page.getViewport({ scale: 1, rotation: rotationOf(page, ref) });
  const avail = viewer.clientWidth - 48;
  return Math.max(0.25, Math.min(2.5, avail / vp.width));
}

async function rebuild(): Promise<void> {
  const keepId = currentPageId;
  const keepRatio = keepId && views.get(keepId) ? (viewer.scrollTop - views.get(keepId)!.el.offsetTop) / views.get(keepId)!.el.offsetHeight : 0;
  closeTextEditor(true);
  for (const v of views.values()) {
    v.task?.cancel();
    observer.unobserve(v.el);
  }
  views.clear();
  const pages = await Promise.all(state.pages.map(getPage));
  const frag = document.createDocumentFragment();
  state.pages.forEach((ref, i) => {
    const page = pages[i];
    const viewport = page.getViewport({ scale, rotation: rotationOf(page, ref) });
    const el = document.createElement('div');
    el.className = 'page';
    el.dataset.id = ref.id;
    el.style.width = `${Math.floor(viewport.width)}px`;
    el.style.height = `${Math.floor(viewport.height)}px`;
    el.style.setProperty('--scale-factor', String(scale));
    el.style.setProperty('--total-scale-factor', String(scale));
    el.setAttribute('aria-label', `Página ${i + 1}`);
    const canvas = document.createElement('canvas');
    canvas.className = 'pdf';
    const textEl = document.createElement('div');
    textEl.className = 'textLayer';
    const overlay = document.createElement('canvas');
    overlay.className = 'overlay';
    el.append(canvas, textEl, overlay);
    frag.append(el);
    const view: PageView = { ref, page, el, canvas, overlay, textEl, viewport, rendered: false, task: null, textDivs: [] };
    views.set(ref.id, view);
    bindOverlay(view);
  });
  pagesEl.replaceChildren(frag);
  views.forEach((v) => observer.observe(v.el));
  $('zoom-label').textContent = `${Math.round(scale * 100)}%`;
  if (keepId && views.has(keepId)) {
    const el = views.get(keepId)!.el;
    viewer.scrollTop = el.offsetTop + keepRatio * el.offsetHeight;
  }
  currentPageId = keepId && views.has(keepId) ? keepId : state.pages[0]?.id ?? null;
  buildThumbs();
  updatePageInfo();
  updateButtons();
}

function outputScale(view: PageView): number {
  const dpr = window.devicePixelRatio || 1;
  const maxPixels = 16_000_000;
  const px = view.viewport.width * view.viewport.height * dpr * dpr;
  return px > maxPixels ? dpr * Math.sqrt(maxPixels / px) : dpr;
}

async function renderPage(view: PageView): Promise<void> {
  if (view.rendered) return;
  view.rendered = true;
  const os = outputScale(view);
  const { canvas, viewport } = view;
  canvas.width = Math.floor(viewport.width * os);
  canvas.height = Math.floor(viewport.height * os);
  view.overlay.width = canvas.width;
  view.overlay.height = canvas.height;
  drawOverlay(view);
  const task = view.page.render({ canvas, viewport, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : undefined });
  view.task = task;
  try {
    await task.promise;
  } catch (err) {
    if ((err as Error)?.name !== 'RenderingCancelledException') console.error(err);
    return;
  } finally {
    if (view.task === task) view.task = null;
  }
  if (!view.rendered) return;
  try {
    const tl = new pdfjs.TextLayer({ textContentSource: view.page.streamTextContent(), container: view.textEl, viewport });
    await tl.render();
    view.textDivs = tl.textDivs;
    applySearchHighlight(view);
  } catch (err) {
    console.warn('Camada de texto indisponível nesta página', err);
  }
}

function unrenderPage(view: PageView): void {
  if (!view.rendered) return;
  view.rendered = false;
  view.task?.cancel();
  view.canvas.width = view.canvas.height = 0;
  view.overlay.width = view.overlay.height = 0;
  view.textEl.replaceChildren();
  view.textDivs = [];
}

function drawOverlay(view: PageView): void {
  const { overlay, viewport } = view;
  if (!overlay.width) return;
  const ctx = overlay.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const k = overlay.width / viewport.width;
  const t = viewport.transform;
  ctx.setTransform(t[0] * k, t[1] * k, t[2] * k, t[3] * k, t[4] * k, t[5] * k);
  const list = (state.annots[view.ref.id] ?? []).filter((a) => a !== editor?.annot);
  drawAnnots(ctx, list, () => drawOverlay(view));
  const sel = findSelected();
  if (sel && selected?.pageId === view.ref.id) drawSelection(ctx, sel, 1 / scale);
}

function setScale(next: number): void {
  next = Math.max(0.25, Math.min(5, Math.round(next * 100) / 100));
  if (next === scale || !state.pages.length) return;
  scale = next;
  rebuild();
}

function updatePageInfo(): void {
  const i = state.pages.findIndex((p) => p.id === currentPageId);
  $('page-info').textContent = state.pages.length ? `${i + 1} / ${state.pages.length}` : '';
  thumbsEl.querySelectorAll('.thumb').forEach((li) => li.classList.toggle('current', (li as HTMLElement).dataset.id === currentPageId));
}

function scrollToPage(id: string): void {
  const v = views.get(id);
  if (!v) return;
  viewer.scrollTo({ top: v.el.offsetTop - 12 });
  currentPageId = id;
  updatePageInfo();
}

viewer.addEventListener('scroll', () => {
  const mark = viewer.scrollTop + viewer.clientHeight / 3;
  let cur: string | null = null;
  for (const v of views.values()) {
    if (v.el.offsetTop <= mark) cur = v.ref.id;
    else break;
  }
  if (cur && cur !== currentPageId) {
    currentPageId = cur;
    updatePageInfo();
    thumbsEl.querySelector<HTMLElement>(`.thumb[data-id="${cur}"]`)?.scrollIntoView({ block: 'nearest' });
  }
});

// ---------------------------------------------------------------------------
// Miniaturas e operações de página
// ---------------------------------------------------------------------------

const thumbCache = new Map<string, HTMLCanvasElement>();
const thumbObserver = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      thumbObserver.unobserve(e.target);
      renderThumb(e.target as HTMLLIElement);
    }
  },
  { root: thumbsEl, rootMargin: '400px 0px' }
);

async function renderThumb(li: HTMLLIElement): Promise<void> {
  const ref = state.pages.find((p) => p.id === li.dataset.id);
  if (!ref) return;
  const page = await getPage(ref);
  const rotation = rotationOf(page, ref);
  const key = `${pageKey(ref)}:${rotation}`;
  const frame = li.querySelector('canvas')!;
  let cached = thumbCache.get(key);
  if (!cached) {
    const vp1 = page.getViewport({ scale: 1, rotation });
    const vp = page.getViewport({ scale: (140 * 2) / vp1.width, rotation });
    cached = document.createElement('canvas');
    cached.width = Math.floor(vp.width);
    cached.height = Math.floor(vp.height);
    await page.render({ canvas: cached, viewport: vp }).promise.catch(() => undefined);
    thumbCache.set(key, cached);
  }
  frame.width = cached.width;
  frame.height = cached.height;
  frame.style.width = `${cached.width / 2}px`;
  frame.getContext('2d')!.drawImage(cached, 0, 0);
}

let dragId: string | null = null;

function buildThumbs(): void {
  const frag = document.createDocumentFragment();
  state.pages.forEach((ref, i) => {
    const li = document.createElement('li');
    li.className = 'thumb';
    li.dataset.id = ref.id;
    li.draggable = true;
    const frame = document.createElement('canvas');
    frame.className = 'frame';
    frame.width = 140;
    frame.height = 180;
    frame.style.width = '140px';
    frame.tabIndex = 0;
    frame.setAttribute('role', 'button');
    frame.setAttribute('aria-label', `Ir para a página ${i + 1}`);
    frame.addEventListener('click', () => {
      scrollToPage(ref.id);
      if (window.innerWidth <= 800) $('sidebar').classList.add('closed');
    });
    frame.addEventListener('keydown', (e) => e.key === 'Enter' && scrollToPage(ref.id));
    const num = document.createElement('span');
    num.className = 'num';
    num.textContent = String(i + 1);
    const ops = document.createElement('div');
    ops.className = 'ops';
    const op = (label: string, title: string, fn: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-label', `${title} (página ${i + 1})`);
      b.disabled = disabled;
      b.addEventListener('click', fn);
      ops.append(b);
    };
    op('⟲', 'Girar para a esquerda', () => rotatePage(ref.id, -90));
    op('⟳', 'Girar para a direita', () => rotatePage(ref.id, 90));
    op('↑', 'Mover para cima', () => movePage(ref.id, i - 1), i === 0);
    op('↓', 'Mover para baixo', () => movePage(ref.id, i + 1), i === state.pages.length - 1);
    op('✕', 'Excluir página', () => deletePage(ref.id), state.pages.length === 1);
    li.append(frame, num, ops);
    li.addEventListener('dragstart', (e) => {
      dragId = ref.id;
      e.dataTransfer?.setData('text/plain', ref.id);
    });
    li.addEventListener('dragover', (e) => {
      if (!dragId) return;
      e.preventDefault();
      li.classList.add('drop-before');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-before'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('drop-before');
      if (!dragId || dragId === ref.id) return;
      const from = state.pages.findIndex((p) => p.id === dragId);
      let to = state.pages.findIndex((p) => p.id === ref.id);
      if (from < to) to--;
      movePage(dragId, to);
      dragId = null;
    });
    li.addEventListener('dragend', () => (dragId = null));
    frag.append(li);
    thumbObserver.observe(li);
  });
  thumbsEl.replaceChildren(frag);
  updatePageInfo();
}

async function rotatePage(id: string, delta: number): Promise<void> {
  const done = checkpoint();
  const ref = state.pages.find((p) => p.id === id)!;
  ref.rot = (((ref.rot + delta) % 360) + 360) % 360;
  done();
  await rebuild();
}

async function movePage(id: string, to: number): Promise<void> {
  const from = state.pages.findIndex((p) => p.id === id);
  if (from < 0 || to < 0 || to >= state.pages.length || to === from) return;
  const done = checkpoint();
  const [ref] = state.pages.splice(from, 1);
  state.pages.splice(to, 0, ref);
  done();
  await rebuild();
}

async function deletePage(id: string): Promise<void> {
  if (state.pages.length <= 1) return;
  const done = checkpoint();
  const i = state.pages.findIndex((p) => p.id === id);
  state.pages.splice(i, 1);
  delete state.annots[id];
  if (selected?.pageId === id) selected = null;
  if (currentPageId === id) currentPageId = state.pages[Math.min(i, state.pages.length - 1)].id;
  done();
  await rebuild();
  toast('Página excluída. Ctrl+Z desfaz.');
}

// ---------------------------------------------------------------------------
// Ferramentas de edição
// ---------------------------------------------------------------------------

function setTool(next: Tool): void {
  closeTextEditor(true);
  tool = next;
  viewer.dataset.tool = next;
  document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => {
    const on = b.dataset.tool === next;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  });
  if (next !== 'select' && selected) select(null);
  if (next === 'highlight' && colorInput.value === '#d62828') colorInput.value = '#ffd400';
  else if (next !== 'highlight' && colorInput.value === '#ffd400') colorInput.value = '#d62828';
}

function select(sel: { pageId: string; annotId: string } | null): void {
  const prev = selected?.pageId;
  selected = sel;
  if (prev && views.get(prev)) drawOverlay(views.get(prev)!);
  if (sel && views.get(sel.pageId)) drawOverlay(views.get(sel.pageId)!);
  const a = findSelected();
  if (a?.kind === 'text') {
    sizeInput.value = String(a.size);
    colorInput.value = a.color;
  } else if (a && (a.kind === 'ink' || (a.kind === 'rect' && a.mode !== 'whiteout'))) {
    colorInput.value = a.color;
    strokeInput.value = String(a.width);
  }
  updateButtons();
}

function deleteSelected(): void {
  const a = findSelected();
  if (!a || !selected) return;
  const done = checkpoint();
  const list = annotsOf(selected.pageId);
  list.splice(list.indexOf(a), 1);
  const pageId = selected.pageId;
  selected = null;
  done();
  drawOverlay(views.get(pageId)!);
}

/** Aplica cor/tamanho/espessura na edição selecionada. */
function applyProps(): void {
  const a = findSelected();
  if (!a || !selected) return;
  const done = checkpoint();
  if (a.kind === 'text') {
    a.color = colorInput.value;
    a.size = clamp(Number(sizeInput.value) || a.size, 4, 200);
  } else if (a.kind === 'ink' || (a.kind === 'rect' && a.mode !== 'whiteout')) {
    a.color = colorInput.value;
    a.width = clamp(Number(strokeInput.value) || a.width, 0.5, 48);
  }
  done();
  drawOverlay(views.get(selected.pageId)!);
}

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function pdfPoint(view: PageView, e: PointerEvent | MouseEvent): [number, number] {
  const r = view.overlay.getBoundingClientRect();
  const [x, y] = view.viewport.convertToPdfPoint(e.clientX - r.left, e.clientY - r.top) as [number, number];
  return [x, y];
}

function topAnnotAt(view: PageView, x: number, y: number): Annot | null {
  const list = state.annots[view.ref.id] ?? [];
  const tol = 4 / scale;
  for (let i = list.length - 1; i >= 0; i--) if (hitTest(list[i], x, y, tol)) return list[i];
  return null;
}

function nearHandle(a: Annot, x: number, y: number): boolean {
  const h = resizeHandle(a);
  return !!h && Math.hypot(h[0] - x, h[1] - y) <= 10 / scale;
}

function bindOverlay(view: PageView): void {
  const { overlay } = view;
  let gesture: null | {
    done: () => void;
    kind: 'ink' | 'rect' | 'move' | 'resize';
    annot: Annot;
    start: [number, number];
    last: [number, number];
    aspect: number;
  } = null;

  overlay.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const [x, y] = pdfPoint(view, e);
    if (tool === 'text') {
      e.preventDefault();
      const hit = topAnnotAt(view, x, y);
      if (hit?.kind === 'text') openTextEditor(view, hit);
      else openTextEditor(view, null, e);
      return;
    }
    if (tool === 'select') {
      const sel = findSelected();
      if (sel && selected?.pageId === view.ref.id && nearHandle(sel, x, y)) {
        const aspect = sel.kind === 'image' ? sel.h / sel.w : 0;
        gesture = { done: checkpoint(), kind: 'resize', annot: sel, start: [x, y], last: [x, y], aspect };
      } else {
        const hit = topAnnotAt(view, x, y);
        select(hit ? { pageId: view.ref.id, annotId: hit.id } : null);
        if (!hit) return;
        gesture = { done: checkpoint(), kind: 'move', annot: hit, start: [x, y], last: [x, y], aspect: 0 };
      }
    } else if (tool === 'ink') {
      const annot: Annot = { id: uid(), kind: 'ink', points: [x, y], color: colorInput.value, width: clamp(Number(strokeInput.value) || 2, 0.5, 48) };
      const done = checkpoint();
      annotsOf(view.ref.id).push(annot);
      gesture = { done, kind: 'ink', annot, start: [x, y], last: [x, y], aspect: 0 };
    } else if (tool === 'highlight' || tool === 'box' || tool === 'whiteout') {
      const annot: Annot = {
        id: uid(),
        kind: 'rect',
        mode: tool,
        x,
        y,
        w: 0,
        h: 0,
        color: tool === 'whiteout' ? '#ffffff' : colorInput.value,
        width: clamp(Number(strokeInput.value) || 2, 0.5, 48),
      };
      const done = checkpoint();
      annotsOf(view.ref.id).push(annot);
      gesture = { done, kind: 'rect', annot, start: [x, y], last: [x, y], aspect: 0 };
    } else return;
    e.preventDefault();
    overlay.setPointerCapture(e.pointerId);
    drawOverlay(view);
  });

  overlay.addEventListener('pointermove', (e) => {
    const [x, y] = pdfPoint(view, e);
    if (!gesture) {
      if (tool === 'select') {
        const sel = findSelected();
        const onHandle = !!sel && selected?.pageId === view.ref.id && nearHandle(sel, x, y);
        overlay.classList.toggle('over-handle', onHandle);
        overlay.classList.toggle('over-item', !onHandle && !!topAnnotAt(view, x, y));
      }
      return;
    }
    const g = gesture;
    const a = g.annot;
    if (g.kind === 'ink' && a.kind === 'ink') {
      const n = a.points.length;
      if (Math.hypot(x - a.points[n - 2], y - a.points[n - 1]) * scale >= 1.5) a.points.push(x, y);
    } else if (g.kind === 'rect' && a.kind === 'rect') {
      a.x = Math.min(g.start[0], x);
      a.y = Math.min(g.start[1], y);
      a.w = Math.abs(x - g.start[0]);
      a.h = Math.abs(y - g.start[1]);
    } else if (g.kind === 'move') {
      moveAnnot(a, x - g.last[0], y - g.last[1]);
    } else if (g.kind === 'resize') {
      if (a.kind === 'image') {
        const [lx] = toLocal(a, x, y);
        const w = Math.max(8, lx);
        // Mantém o canto de cima à esquerda parado: o canto de baixo desce quando a imagem cresce.
        const dh = w * g.aspect - a.h;
        const r = (a.rot * Math.PI) / 180;
        a.x += dh * Math.sin(r);
        a.y -= dh * Math.cos(r);
        a.w = w;
        a.h = w * g.aspect;
      } else if (a.kind === 'rect') {
        const top = a.y + a.h;
        a.w = Math.max(2, x - a.x);
        a.y = Math.min(y, top - 2);
        a.h = top - a.y;
      }
    }
    g.last = [x, y];
    drawOverlay(view);
  });

  const end = () => {
    if (!gesture) return;
    const g = gesture;
    gesture = null;
    const a = g.annot;
    if (g.kind === 'rect' && a.kind === 'rect' && (a.w * scale < 3 || a.h * scale < 3)) {
      const list = annotsOf(view.ref.id);
      list.splice(list.indexOf(a), 1);
    }
    g.done();
    drawOverlay(view);
  };
  overlay.addEventListener('pointerup', end);
  overlay.addEventListener('pointercancel', end);

  overlay.addEventListener('dblclick', (e) => {
    if (tool !== 'select') return;
    const [x, y] = pdfPoint(view, e);
    const hit = topAnnotAt(view, x, y);
    if (hit?.kind === 'text') openTextEditor(view, hit);
  });
}

// --- Editor de texto -------------------------------------------------------

let editor: null | { el: HTMLTextAreaElement; view: PageView; annot: TextAnnot | null; at: [number, number] } = null;

function openTextEditor(view: PageView, annot: TextAnnot | null, e?: PointerEvent): void {
  closeTextEditor(true);
  const size = annot?.size ?? clamp(Number(sizeInput.value) || 14, 4, 200);
  const color = annot?.color ?? colorInput.value;
  const px = size * scale;
  let left: number, top: number;
  if (annot) {
    const [sx, sy] = view.viewport.convertToViewportPoint(annot.x, annot.y) as [number, number];
    left = sx;
    top = sy - px * 1.05;
  } else {
    const r = view.overlay.getBoundingClientRect();
    left = e!.clientX - r.left;
    top = e!.clientY - r.top - px * 0.6;
  }
  const el = document.createElement('textarea');
  el.className = 'text-editor';
  el.value = annot?.text ?? '';
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  el.style.fontSize = `${px}px`;
  el.style.color = color;
  el.spellcheck = false;
  el.setAttribute('aria-label', 'Texto a inserir no PDF');
  el.rows = 1;
  const fit = () => {
    el.style.height = 'auto';
    el.style.width = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
    el.style.width = `${Math.max(40, el.scrollWidth + px)}px`;
  };
  el.addEventListener('input', fit);
  el.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Escape') closeTextEditor(!!annot);
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) closeTextEditor(true);
  });
  el.addEventListener('blur', () => setTimeout(() => editor?.el === el && closeTextEditor(true), 0));
  view.el.append(el);
  editor = { el, view, annot, at: [left, top] };
  // Esconde o texto original enquanto edita (drawOverlay pula editor.annot).
  if (annot) drawOverlay(view);
  fit();
  requestAnimationFrame(() => el.focus());
}

function closeTextEditor(commit: boolean): void {
  if (!editor) return;
  const { el, view, annot, at } = editor;
  editor = null;
  const text = el.value.replace(/\s+$/, '');
  el.remove();
  if (commit) {
    const done = checkpoint();
    const list = annotsOf(view.ref.id);
    if (annot) {
      if (!text) list.splice(list.indexOf(annot), 1);
      else annot.text = text;
    } else if (text) {
      const size = clamp(Number(sizeInput.value) || 14, 4, 200);
      const [x, y] = view.viewport.convertToPdfPoint(at[0], at[1] + size * scale * 1.05) as [number, number];
      const a: TextAnnot = { id: uid(), kind: 'text', x, y, size, color: colorInput.value, text, rot: rotationOf(view.page, view.ref) };
      list.push(a);
    }
    done();
  }
  drawOverlay(view);
}

// --- Imagens e assinatura --------------------------------------------------

function currentView(): PageView | null {
  return (currentPageId && views.get(currentPageId)) || views.values().next().value || null;
}

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Converte para PNG/JPEG (o que o PDF aceita) e reduz fotos enormes. */
async function prepareImage(file: File): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const max = 2400;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const keep = k === 1 && (file.type === 'image/png' || file.type === 'image/jpeg');
    if (keep) {
      const src = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(r.result as string);
        r.readAsDataURL(file);
      });
      return { src, w: img.naturalWidth, h: img.naturalHeight };
    }
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * k);
    c.height = Math.round(img.naturalHeight * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const jpeg = file.type === 'image/jpeg';
    return { src: c.toDataURL(jpeg ? 'image/jpeg' : 'image/png', 0.9), w: c.width, h: c.height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function insertImage(src: string, iw: number, ih: number, widthRatio: number): void {
  const view = currentView();
  if (!view) return;
  const rot = rotationOf(view.page, view.ref);
  // Centro da parte visível da página.
  const pr = view.el.getBoundingClientRect();
  const vr = viewer.getBoundingClientRect();
  const cx = clamp((Math.max(pr.left, vr.left) + Math.min(pr.right, vr.right)) / 2 - pr.left, 0, pr.width);
  const cy = clamp((Math.max(pr.top, vr.top) + Math.min(pr.bottom, vr.bottom)) / 2 - pr.top, 0, pr.height);
  const [px, py] = view.viewport.convertToPdfPoint(cx, cy) as [number, number];
  const w = (view.viewport.width / scale) * widthRatio;
  const h = (w * ih) / iw;
  const r = (rot * Math.PI) / 180;
  const a: ImageAnnot = {
    id: uid(),
    kind: 'image',
    x: px - ((w / 2) * Math.cos(r) - (h / 2) * Math.sin(r)),
    y: py - ((w / 2) * Math.sin(r) + (h / 2) * Math.cos(r)),
    w,
    h,
    rot,
    src,
  };
  const done = checkpoint();
  annotsOf(view.ref.id).push(a);
  done();
  setTool('select');
  select({ pageId: view.ref.id, annotId: a.id });
  toast('Arraste para posicionar. A bolinha no canto muda o tamanho.');
}

function setupSignaturePad(): void {
  const dialog = $<HTMLDialogElement>('sign-dialog');
  const pad = $<HTMLCanvasElement>('sign-pad');
  const ctx = pad.getContext('2d')!;
  let drawing = false;
  let empty = true;
  const pos = (e: PointerEvent): [number, number] => {
    const r = pad.getBoundingClientRect();
    return [((e.clientX - r.left) * pad.width) / r.width, ((e.clientY - r.top) * pad.height) / r.height];
  };
  const reset = () => {
    ctx.clearRect(0, 0, pad.width, pad.height);
    empty = true;
  };
  pad.addEventListener('pointerdown', (e) => {
    drawing = true;
    empty = false;
    pad.setPointerCapture(e.pointerId);
    const [x, y] = pos(e);
    ctx.strokeStyle = '#1a2a6c';
    ctx.lineWidth = 3.2;
    ctx.lineCap = ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.01, y);
    ctx.stroke();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const [x, y] = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
  });
  pad.addEventListener('pointerup', () => (drawing = false));
  $('sign-clear').addEventListener('click', reset);
  $('btn-sign').addEventListener('click', () => {
    if (!state.pages.length) return toast('Abra um PDF primeiro.');
    reset();
    dialog.showModal();
  });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue !== 'ok' || empty) return;
    const trimmed = trimCanvas(pad);
    if (trimmed) insertImage(trimmed.toDataURL('image/png'), trimmed.width, trimmed.height, 0.3);
  });
}

/** Recorta as bordas transparentes da assinatura. */
function trimCanvas(c: HTMLCanvasElement): HTMLCanvasElement | null {
  const { data, width, height } = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if (data[(y * width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) return null;
  const pad = 6;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(width - 1, x1 + pad);
  y1 = Math.min(height - 1, y1 + pad);
  const out = document.createElement('canvas');
  out.width = x1 - x0 + 1;
  out.height = y1 - y0 + 1;
  out.getContext('2d')!.drawImage(c, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

// ---------------------------------------------------------------------------
// Busca
// ---------------------------------------------------------------------------

let searchQuery = '';
let matches: string[] = [];
let matchIndex = -1;

async function pageText(ref: PageRef): Promise<string> {
  const key = pageKey(ref);
  let t = textCache.get(key);
  if (t === undefined) {
    const page = await getPage(ref);
    const content = await page.getTextContent();
    t = normalize(content.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? ' ' : '') : '')).join(''));
    textCache.set(key, t);
  }
  return t;
}

async function runSearch(): Promise<void> {
  const q = normalize(searchInput.value.trim());
  searchQuery = q;
  matches = [];
  matchIndex = -1;
  if (q) {
    for (const ref of state.pages) {
      if ((await pageText(ref)).includes(q)) matches.push(ref.id);
      if (searchQuery !== q) return;
    }
  }
  const curIdx = state.pages.findIndex((p) => p.id === currentPageId);
  matchIndex = matches.findIndex((id) => state.pages.findIndex((p) => p.id === id) >= curIdx);
  if (matchIndex < 0 && matches.length) matchIndex = 0;
  showMatch();
}

function showMatch(): void {
  const info = $('search-info');
  $<HTMLButtonElement>('search-prev').disabled = matches.length < 2;
  $<HTMLButtonElement>('search-next').disabled = matches.length < 2;
  if (!searchQuery) info.textContent = '';
  else if (!matches.length) info.textContent = 'nada';
  else info.textContent = `pág. ${matchIndex + 1}/${matches.length}`;
  info.title = matches.length ? `Encontrado em ${matches.length} página(s)` : '';
  if (matches.length) scrollToPage(matches[matchIndex]);
  views.forEach(applySearchHighlight);
}

function stepMatch(d: number): void {
  if (!matches.length) return;
  matchIndex = (matchIndex + d + matches.length) % matches.length;
  showMatch();
}

function clearSearch(): void {
  searchInput.value = '';
  searchQuery = '';
  matches = [];
  matchIndex = -1;
  $('search-info').textContent = '';
}

function applySearchHighlight(view: PageView): void {
  const current = matches[matchIndex] === view.ref.id;
  for (const div of view.textDivs) {
    const hit = !!searchQuery && normalize(div.textContent ?? '').includes(searchQuery);
    div.classList.toggle('match', hit);
    div.classList.toggle('current', hit && current);
  }
}

// ---------------------------------------------------------------------------
// Salvar
// ---------------------------------------------------------------------------

async function save(): Promise<void> {
  if (!state.pages.length) return;
  closeTextEditor(true);
  const btn = $<HTMLButtonElement>('btn-save');
  btn.disabled = true;
  btn.textContent = 'Gerando…';
  try {
    const title = sources[0].name.replace(/\.pdf$/i, '');
    const bytes = await buildPdf(sources.map((s) => s.bytes), state, title);
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${title}-editado.pdf`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    dirty = false;
    toast('PDF baixado.');
  } catch (err) {
    console.error(err);
    toast(
      err instanceof EncryptedPdfError
        ? 'Este PDF é protegido por senha: dá para ler, mas não para salvar edições nele.'
        : 'Não consegui gerar o PDF. Veja o console para detalhes.',
      true
    );
  } finally {
    btn.textContent = 'Baixar PDF';
    updateButtons();
  }
}

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

const filePdf = $<HTMLInputElement>('file-pdf');
const fileMerge = $<HTMLInputElement>('file-merge');
const fileImage = $<HTMLInputElement>('file-image');

$('btn-open').addEventListener('click', () => filePdf.click());
$('btn-open-2').addEventListener('click', () => filePdf.click());
$('btn-sample').addEventListener('click', async () => {
  await openBytes(await samplePdf(), 'exemplo-pdfzin.pdf');
});
filePdf.addEventListener('change', () => {
  const f = filePdf.files?.[0];
  filePdf.value = '';
  if (f) openFile(f);
});
$('btn-merge').addEventListener('click', () => fileMerge.click());
fileMerge.addEventListener('change', () => {
  if (fileMerge.files?.length) mergeFiles(fileMerge.files).finally(() => (fileMerge.value = ''));
});
$('btn-blank').addEventListener('click', () => insertBlank());
$('btn-image').addEventListener('click', () => {
  if (!state.pages.length) return toast('Abra um PDF primeiro.');
  fileImage.click();
});
fileImage.addEventListener('change', async () => {
  const f = fileImage.files?.[0];
  fileImage.value = '';
  if (!f) return;
  try {
    const { src, w, h } = await prepareImage(f);
    insertImage(src, w, h, 0.4);
  } catch {
    toast('Não consegui ler essa imagem.', true);
  }
});
$('btn-save').addEventListener('click', save);
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-delete').addEventListener('click', deleteSelected);
$('zoom-in').addEventListener('click', () => setScale(scale * 1.2));
$('zoom-out').addEventListener('click', () => setScale(scale / 1.2));
$('zoom-label').addEventListener('click', async () => setScale(await fitWidthScale()));
$('btn-sidebar').addEventListener('click', () => $('sidebar').classList.toggle('closed'));
document.querySelectorAll<HTMLButtonElement>('.tool').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool as Tool)));
[colorInput, sizeInput, strokeInput].forEach((el) => el.addEventListener('change', applyProps));

let searchTimer = 0;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = window.setTimeout(runSearch, 250);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (normalize(searchInput.value.trim()) !== searchQuery) runSearch();
    else stepMatch(e.shiftKey ? -1 : 1);
  }
});
$('search-prev').addEventListener('click', () => stepMatch(-1));
$('search-next').addEventListener('click', () => stepMatch(1));

const toolKeys: Record<string, Tool> = { v: 'read', s: 'select', t: 'text', d: 'ink', h: 'highlight', r: 'box', w: 'whiteout' };

window.addEventListener('keydown', (e) => {
  const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault();
    filePdf.click();
  } else if (mod && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  } else if (mod && e.key.toLowerCase() === 'f' && state.pages.length) {
    e.preventDefault();
    searchInput.focus();
    searchInput.select();
  } else if (typing) {
    return;
  } else if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
  } else if (mod && e.key.toLowerCase() === 'y') {
    e.preventDefault();
    redo();
  } else if (mod && (e.key === '+' || e.key === '=')) {
    e.preventDefault();
    setScale(scale * 1.2);
  } else if (mod && e.key === '-') {
    e.preventDefault();
    setScale(scale / 1.2);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && findSelected()) {
    e.preventDefault();
    deleteSelected();
  } else if (e.key === 'Escape') {
    select(null);
  } else if (!mod && !e.altKey && toolKeys[e.key.toLowerCase()] && state.pages.length) {
    setTool(toolKeys[e.key.toLowerCase()]);
  }
});

viewer.addEventListener(
  'wheel',
  (e) => {
    if (!e.ctrlKey || !state.pages.length) return;
    e.preventDefault();
    setScale(scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  },
  { passive: false }
);

// Arrastar e soltar PDF na janela.
let dragDepth = 0;
const isFileDrag = (e: DragEvent) => !dragId && !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth++;
  $('drop-hint').classList.add('show');
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  if (--dragDepth <= 0) $('drop-hint').classList.remove('show');
});
window.addEventListener('dragover', (e) => isFileDrag(e) && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  $('drop-hint').classList.remove('show');
  const files = Array.from(e.dataTransfer!.files).filter((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (!files.length) return toast('Solte um arquivo PDF.', true);
  // Sem documento aberto: abre. Com documento: junta no final (Ctrl+Z desfaz).
  if (!state.pages.length) return void openFile(files[0]);
  const dt = new DataTransfer();
  files.forEach((f) => dt.items.add(f));
  mergeFiles(dt.files);
});

window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => views.forEach((v) => v.rendered && drawOverlay(v)), 150);
});

if (window.innerWidth <= 800) $('sidebar').classList.add('closed');
setupSignaturePad();
setupOffline();
setTool('read');
updateButtons();

// Atalho para testes automatizados e para quem quiser integrar.
(window as unknown as { pdfzin: object }).pdfzin = {
  get state() {
    return state;
  },
  openBytes,
  buildPdf: () => buildPdf(sources.map((s) => s.bytes), state),
};
