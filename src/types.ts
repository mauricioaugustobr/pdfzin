// Todas as coordenadas das edições ficam no espaço do usuário do PDF (pontos, eixo Y para cima),
// as mesmas que o pdf-lib usa ao salvar. Assim a tela e o arquivo final batem em qualquer zoom ou giro.

export type Tool = 'read' | 'select' | 'text' | 'ink' | 'highlight' | 'box' | 'whiteout';

/** Uma página do documento final: aponta para uma página de um PDF de origem. */
export interface PageRef {
  id: string;
  /** Índice em `sources`. */
  src: number;
  /** Índice da página (0..n-1) no PDF de origem. */
  index: number;
  /** Giro extra aplicado no PDFZIN (0, 90, 180, 270), somado ao /Rotate original. */
  rot: number;
}

interface AnnotBase {
  id: string;
}

export interface TextAnnot extends AnnotBase {
  kind: 'text';
  /** Início da linha de base da primeira linha. */
  x: number;
  y: number;
  size: number;
  color: string;
  text: string;
  /** Ângulo (graus, anti-horário) para o texto ficar em pé na página girada. */
  rot: number;
}

export interface InkAnnot extends AnnotBase {
  kind: 'ink';
  /** Pontos [x0, y0, x1, y1, ...]. */
  points: number[];
  color: string;
  width: number;
}

export interface RectAnnot extends AnnotBase {
  kind: 'rect';
  mode: 'highlight' | 'box' | 'whiteout';
  /** Canto inferior esquerdo. */
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
}

export interface ImageAnnot extends AnnotBase {
  kind: 'image';
  /** Canto inferior esquerdo no sistema girado da imagem. */
  x: number;
  y: number;
  w: number;
  h: number;
  rot: number;
  /** data:image/png ou data:image/jpeg */
  src: string;
}

export type Annot = TextAnnot | InkAnnot | RectAnnot | ImageAnnot;

export interface DocState {
  pages: PageRef[];
  annots: Record<string, Annot[]>;
}
