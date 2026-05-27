import { createWorker, type Worker } from "tesseract.js";
import type { LineBox, OcrResult, ParagraphBox, SymbolBox, WordBox } from "../content/ocr-msg";

let workerPromise: Promise<Worker> | null = null;

function url(rel: string): string {
  return chrome.runtime.getURL(`assets/tesseract/${rel}`);
}

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    // workerBlobURL: false avoids wrapping the worker script in a blob: URL,
    // which the default MV3 extension CSP (script-src 'self') would reject.
    workerPromise = createWorker("eng", 1, {
      workerPath: url("worker.min.js"),
      corePath: url(""),
      langPath: url(""),
      gzip: true,
      workerBlobURL: false,
    });
  }
  return workerPromise;
}

// Confidence below this is almost always OCR noise — graphical icons (magnifying glass,
// arrows, decorative glyphs) misclassified as letters.
const WORD_CONFIDENCE_THRESHOLD = 60;

// Real 1–3 character words (I, a, is, of, the) typically score 90+. Junk short tokens
// from icon OCR (e.g., "e", "(w=)") score 60–80 — require a tighter threshold.
const SHORT_WORD_CONFIDENCE_THRESHOLD = 80;
const SHORT_WORD_MAX_LEN = 3;

// Real letters score in the 80–99 range; a word with even one symbol below this
// is almost certainly a partial icon misread (e.g., the ")" in "fw)" coming from
// the magnifying glass curve).
const MIN_SYMBOL_CONFIDENCE = 50;

async function runOcr(imageDataUrl: string): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(imageDataUrl, {}, { blocks: true });
  const paragraphs: ParagraphBox[] = [];
  const blocks = data.blocks ?? [];
  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
    const block = blocks[blockIndex];
    if (!block) continue;
    for (const para of block.paragraphs ?? []) {
      const lines: LineBox[] = [];
      const rawLineTexts: string[] = [];
      for (const line of para.lines ?? []) {
        rawLineTexts.push(line.text);
        const words: WordBox[] = [];
        const rawWords = Array.from(line.words ?? []);
        for (let wi = 0; wi < rawWords.length; wi++) {
          const word = rawWords[wi];
          if (!word) continue;
          const trimmed = word.text.trim();

          // Tesseract sometimes splits a real word in two: "Builds" → "B" + "uilds",
          // "for" → "f" + "or". If we were about to drop a short letter-y word but the
          // next word starts with lowercase AND sits very close horizontally, it's
          // almost certainly a split-off fragment. Keep it.
          const next = rawWords[wi + 1];
          const isLikelyFragment = (() => {
            if (trimmed.length > 1) return false;
            if (!/^[A-Za-z]$/.test(trimmed)) return false;
            if (!next) return false;
            const nextTrim = next.text.trim();
            if (!/^[a-z]/.test(nextTrim)) return false;
            const wordW = word.bbox.x1 - word.bbox.x0;
            const gap = next.bbox.x0 - word.bbox.x1;
            return gap < wordW * 2;
          })();

          if (word.confidence < WORD_CONFIDENCE_THRESHOLD) {
            if (isLikelyFragment) {
              console.log(`[svt-ocr] keep "${trimmed}" as split-word fragment of "${next!.text.trim()}"`);
            } else {
              console.log(`[svt-ocr] drop low-conf word "${trimmed}" conf=${word.confidence.toFixed(0)}`);
              continue;
            }
          } else if (trimmed.length <= SHORT_WORD_MAX_LEN && word.confidence < SHORT_WORD_CONFIDENCE_THRESHOLD) {
            // Within the short-suspicious range, only drop the actually-suspicious
            // ones: single characters (typical bullet misreads like "e" or "*") or
            // tokens with non-letter chars ("fw)", "(w=)"). Real English short
            // words like "The", "and", "for" are all letters and routinely score
            // 60–80 even when correctly OCR'd, so we keep them.
            const isSingleChar = trimmed.length === 1;
            const hasNonLetter = /[^A-Za-z']/.test(trimmed);
            if (!(isSingleChar || hasNonLetter)) {
              // real-word-shaped, keep
            } else if (isLikelyFragment) {
              console.log(`[svt-ocr] keep "${trimmed}" as split-word fragment of "${next!.text.trim()}"`);
            } else {
              console.log(`[svt-ocr] drop short suspicious word "${trimmed}" conf=${word.confidence.toFixed(0)}`);
              continue;
            }
          }
          // Short tokens with no letters or digits are dividers/punctuation misreads
          // (e.g., "\", "—", "/"). Real text rarely consists of pure punctuation.
          if (trimmed.length <= 3 && !/[A-Za-z0-9]/.test(trimmed)) {
            console.log(`[svt-ocr] drop punctuation-only word "${trimmed}"`);
            continue;
          }
          // Any individual symbol with very low confidence taints the whole word.
          // This catches mixed-confidence cases like "fw)" where the ")" is an icon
          // fragment riding alongside two real letters.
          const lowConfSym = (word.symbols ?? []).find((s) => s.confidence < MIN_SYMBOL_CONFIDENCE);
          if (lowConfSym) {
            if (isLikelyFragment) {
              console.log(`[svt-ocr] keep "${trimmed}" as split-word fragment of "${next!.text.trim()}"`);
            } else {
              console.log(
                `[svt-ocr] drop word "${trimmed}" — symbol "${lowConfSym.text}" conf=${lowConfSym.confidence.toFixed(0)}`,
              );
              continue;
            }
          }
          const symbols: SymbolBox[] = [];
          for (const sym of word.symbols ?? []) {
            symbols.push({
              text: sym.text,
              bbox: { x0: sym.bbox.x0, y0: sym.bbox.y0, x1: sym.bbox.x1, y1: sym.bbox.y1 },
              confidence: sym.confidence,
            });
          }
          if (symbols.length === 0) continue;
          words.push({
            text: word.text,
            bbox: { x0: word.bbox.x0, y0: word.bbox.y0, x1: word.bbox.x1, y1: word.bbox.y1 },
            symbols,
          });
        }
        // Drop horizontally isolated outliers — a word sitting far apart from the
        // rest of its line is almost always an icon or page-decoration glyph
        // (magnifying glass, arrow, watermark) misread as text.
        const filteredWords = dropHorizontalOutliers(words);
        if (filteredWords.length === 0) continue;
        // Recompute line bbox AND text from the surviving words. Tesseract's reported
        // line.text and line.bbox both include every word it OCR'd, including the
        // junk we filtered above — so rebuilding from filteredWords is what makes
        // the rendered .svt-line span show only the real text.
        const lineBbox = unionBbox(filteredWords.map((w) => w.bbox));
        if (!lineBbox) continue;
        const lineText = joinLineText(filteredWords);
        lines.push({ text: lineText, bbox: lineBbox, words: filteredWords });
      }
      if (lines.length === 0) continue;
      // If the paragraph looks like a bulleted/numbered list, emit one
      // ParagraphBox per line so the copy output separates items with "\n".
      // Otherwise, use the y-gap split that catches visually-disjoint groupings
      // within a single Tesseract paragraph.
      const filteredLineTexts = lines.map((l) => l.text);
      const isList = detectListPattern(rawLineTexts, filteredLineTexts);
      if (isList) stripSharedBulletPrefix(lines);
      const groups: LineBox[][] = isList ? lines.map((l) => [l]) : splitByYGap(lines);
      for (const subLines of groups) {
        const subBbox = unionBbox(subLines.map((l) => l.bbox));
        if (!subBbox) continue;
        paragraphs.push({
          // Visually-wrapped lines in a paragraph are one logical sentence; join with space.
          text: subLines.map((l) => l.text).join(" "),
          bbox: subBbox,
          lines: subLines,
          blockIndex,
        });
      }
    }
  }
  return { paragraphs };
}

// Build a line's text from its word array. Normally words are space-joined, but
// when Tesseract splits a real word into two ("Builds" → "B" + "uilds"), we
// concatenate the fragment to the next word with no space so the joined text
// reconstitutes the original ("Builds"). The look-ahead filter that kept "B"
// would otherwise leave "B uilds" in the copy.
function joinLineText(words: WordBox[]): string {
  if (words.length === 0) return "";
  const parts: string[] = [words[0]?.text.trim() ?? ""];
  for (let i = 1; i < words.length; i++) {
    const prev = words[i - 1];
    const curr = words[i];
    if (!prev || !curr) continue;
    parts.push(isFragmentPair(prev, curr) ? "" : " ");
    parts.push(curr.text.trim());
  }
  return parts.join("");
}

function isFragmentPair(prev: WordBox, curr: WordBox): boolean {
  const prevText = prev.text.trim();
  if (prevText.length !== 1) return false;
  if (!/^[A-Za-z]$/.test(prevText)) return false;
  const currText = curr.text.trim();
  if (!/^[a-z]/.test(currText)) return false;
  const prevW = prev.bbox.x1 - prev.bbox.x0;
  const gap = curr.bbox.x0 - prev.bbox.x1;
  return gap < prevW * 2;
}

// Real single-character English words. Don't strip these as bullet markers even
// if they happen to lead multiple lines.
const SAFE_LEADING_CHARS = new Set(["a", "A", "I"]);

// When list-mode is detected, the bullet marker may still be present as line.words[0]
// for lines where Tesseract's confidence on it was high enough to slip past the
// short-word filter (e.g., an "e" with conf >= 80 stays even though others were
// dropped at conf 70). If 2+ lines have the *same* single-character non-"safe"
// leading word, strip it from those lines' words + text in place.
function stripSharedBulletPrefix(lines: LineBox[]): void {
  const leadingCount = new Map<string, number>();
  for (const line of lines) {
    const w = line.words[0];
    if (!w) continue;
    const t = w.text.trim();
    if (t.length !== 1) continue;
    if (SAFE_LEADING_CHARS.has(t)) continue;
    leadingCount.set(t, (leadingCount.get(t) ?? 0) + 1);
  }
  let stripToken: string | null = null;
  for (const [tok, count] of leadingCount) {
    if (count >= 2) {
      stripToken = tok;
      break;
    }
  }
  if (!stripToken) return;
  for (const line of lines) {
    const w = line.words[0];
    if (w && w.text.trim() === stripToken) {
      line.words = line.words.slice(1);
      line.text = joinLineText(line.words);
    }
  }
  console.log(`[svt-ocr] stripped shared bullet prefix "${stripToken}" from list items`);
}

// Detect bulleted or numbered list paragraphs. We use Tesseract's *raw* line.text
// (pre-filter) because our word filters typically drop bullet glyphs (a stray "•",
// "©", "®", or "e" character that's actually a misread bullet). A paragraph is
// considered a list when 2+ raw lines start with a recognizable list marker:
//   - bullet: a non-alphanumeric leading char followed by whitespace ("• X", "© Y")
//   - numbered: digits/letter/roman followed by "." or ")" and whitespace ("1. ", "a) ")
// Requiring 2+ matches avoids tripping on a single quoted line or em-dash opener.
function detectListPattern(rawLineTexts: string[], filteredLineTexts: string[]): boolean {
  if (rawLineTexts.length < 2) return false;
  const bullet = /^[^A-Za-z0-9\s][\s ]/;
  const numbered = /^([0-9]+|[A-Za-z]|[ivxIVX]+)[.)][\s ]/;
  let markerMatches = 0;
  for (const raw of rawLineTexts) {
    const trimmed = raw.replace(/^\s+/, "");
    if (bullet.test(trimmed) || numbered.test(trimmed)) markerMatches++;
  }
  if (markerMatches >= 2) {
    console.log(`[svt-ocr] list detected via markers (${markerMatches}/${rawLineTexts.length})`);
    return true;
  }

  // Signal 1b: 2+ raw lines share the same short (1–3 char) leading token,
  // followed by whitespace. Catches the case where Tesseract OCR'd every bullet
  // as the same alphanumeric character (e.g., "e Builds...", "e Creates...") so
  // Signal 1's non-alphanumeric regex misses it.
  const leadingTokens = new Map<string, number>();
  for (const raw of rawLineTexts) {
    const trimmed = raw.replace(/^\s+/, "");
    const m = trimmed.match(/^(\S{1,3})\s/);
    if (m && m[1]) leadingTokens.set(m[1], (leadingTokens.get(m[1]) ?? 0) + 1);
  }
  for (const [token, count] of leadingTokens) {
    if (count >= 2) {
      console.log(
        `[svt-ocr] list detected via shared leading token "${token}" (${count}/${rawLineTexts.length})`,
      );
      return true;
    }
  }

  // Signal 2: every filtered line starts with [A-Z0-9]. In wrapped prose,
  // continuation lines start lowercase; in a list, every item starts uppercase.
  // Catches the case where Tesseract drops bullet glyphs entirely (too graphic
  // to OCR) and the raw text already begins at "Builds on..." with no marker.
  let upperStarts = 0;
  let nonEmpty = 0;
  for (const filtered of filteredLineTexts) {
    const trimmed = filtered.replace(/^\s+/, "");
    if (trimmed.length === 0) continue;
    nonEmpty++;
    if (/^[A-Z0-9]/.test(trimmed)) upperStarts++;
  }
  if (nonEmpty >= 2 && upperStarts === nonEmpty) {
    console.log(`[svt-ocr] list detected via uppercase starts (${upperStarts}/${nonEmpty})`);
    return true;
  }

  console.log(
    `[svt-ocr] list NOT detected: markers=${markerMatches}/${rawLineTexts.length}, upper=${upperStarts}/${nonEmpty}`,
  );
  return false;
}

// Within a line, drop words whose nearest horizontal neighbor is more than 3× the
// word's own width away. The magnifying glass sitting 400px to the right of
// "Evolutionary" is the canonical case — that word is an outlier and gets dropped,
// while "Evolutionary" itself has a near-neighbor (the icon) within threshold and
// stays. Threshold is asymmetric on purpose: real text words have many close
// neighbors; isolated icons have none.
function dropHorizontalOutliers(words: WordBox[]): WordBox[] {
  if (words.length <= 1) return words;
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  // Use the median word height as the unit — real word-to-word gaps within a line
  // are 0.3–0.5× the line height (just a space character). A gap of 4× line height
  // means the candidate is geographically isolated and almost always an icon.
  const heights = sorted.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 20;
  const threshold = medianHeight * 4;
  return sorted.filter((word, i) => {
    const left = i > 0 ? sorted[i - 1] : null;
    const right = i < sorted.length - 1 ? sorted[i + 1] : null;
    const gapLeft = left ? word.bbox.x0 - left.bbox.x1 : Infinity;
    const gapRight = right ? right.bbox.x0 - word.bbox.x1 : Infinity;
    const nearestGap = Math.min(gapLeft, gapRight);
    if (nearestGap > threshold) {
      console.log(
        `[svt-ocr] drop x-outlier word "${word.text.trim()}" gap=${nearestGap.toFixed(0)}px threshold=${threshold.toFixed(0)}px`,
      );
      return false;
    }
    return true;
  });
}

function splitByYGap(lines: LineBox[]): LineBox[][] {
  if (lines.length <= 1) return lines.length === 1 ? [lines] : [];
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0);
  const heights = sorted.map((l) => l.bbox.y1 - l.bbox.y0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;
  const gapThreshold = medianHeight * 1.5;

  const groups: LineBox[][] = [];
  let current: LineBox[] = [];
  let prev: LineBox | null = null;
  for (const line of sorted) {
    if (prev) {
      const gap = line.bbox.y0 - prev.bbox.y1;
      const prevHeight = prev.bbox.y1 - prev.bbox.y0;
      const currHeight = line.bbox.y1 - line.bbox.y0;
      const minH = Math.min(prevHeight, currHeight);
      const maxH = Math.max(prevHeight, currHeight);
      const heightRatio = minH > 0 ? maxH / minH : 1;
      // Split on big vertical gap OR a font-size shift (heightRatio > 1.5) — the
      // latter catches a bold/large title sitting just above body text, where
      // the gap alone may be too small to trigger.
      if (gap > gapThreshold || heightRatio > 1.5) {
        console.log(
          `[svt-ocr] split paragraph: gap=${gap.toFixed(0)} threshold=${gapThreshold.toFixed(0)} heightRatio=${heightRatio.toFixed(2)} prevH=${prevHeight} currH=${currHeight}`,
        );
        if (current.length > 0) groups.push(current);
        current = [];
      }
    }
    current.push(line);
    prev = line;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function unionBbox(
  bboxes: { x0: number; y0: number; x1: number; y1: number }[],
): { x0: number; y0: number; x1: number; y1: number } | null {
  if (bboxes.length === 0) return null;
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const b of bboxes) {
    if (b.x0 < x0) x0 = b.x0;
    if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1;
    if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "ocr" || msg?.target !== "offscreen") return false;
  runOcr(msg.dataUrl)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err: unknown) =>
      sendResponse({ ok: false, error: err instanceof Error ? err.message : String(err) }),
    );
  return true;
});

console.log("[svt-offscreen] booted");
