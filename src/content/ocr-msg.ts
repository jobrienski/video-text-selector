export type SymbolBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  confidence: number;
};

export type WordBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  symbols: SymbolBox[];
};

export type LineBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  words: WordBox[];
};

export type ParagraphBox = {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  lines: LineBox[];
  // Index of the source Tesseract block. Paragraphs that share a blockIndex
  // form one visually coherent unit (e.g., title + body of a slide) and are
  // grouped into one patch.
  blockIndex: number;
};

export type OcrResult = { paragraphs: ParagraphBox[] };

export type OcrRequest = { type: "ocr"; dataUrl: string };
export type OcrResponse = { ok: true; result: OcrResult } | { ok: false; error: string };
