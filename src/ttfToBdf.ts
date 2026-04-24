import opentype from 'opentype.js';

export interface ConvertOptions {
  /** sRGB 1..254 darkness cutoff. Lower = thinner glyph, higher = heavier. Default 128. */
  threshold?: number;
  /** 1..4 supersample factor. Default 2 (improves small sizes noticeably). */
  supersample?: number;
  /** 0..3 pixel horizontal dilation of the final bitmap. Default 0. */
  embolden?: number;
}

export async function convertTtfToBdf(
  fontBuffer: ArrayBuffer,
  fontSize: number,
  opts: ConvertOptions = {},
): Promise<string> {
  const threshold = clampInt(opts.threshold ?? 128, 1, 254);
  const supersample = clampInt(opts.supersample ?? 2, 1, 4);
  const embolden = clampInt(opts.embolden ?? 0, 0, 3);

  const font = opentype.parse(fontBuffer);
  const scale = fontSize / font.unitsPerEm;
  const ascender = Math.ceil(font.ascender * scale);
  const descender = Math.floor(font.descender * scale);
  const descentPositive = Math.abs(descender);

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not get 2D context');

  const linearThreshold = srgbToLinear(threshold);

  interface GlyphEntry {
    codepoint: number;
    lines: string[];
    dwidth: number;
  }
  const generated: GlyphEntry[] = [];

  let globalMinX = Infinity;
  let globalMinY = Infinity;
  let globalMaxX = -Infinity;
  let globalMaxY = -Infinity;

  const numGlyphs = font.glyphs.length;
  for (let i = 0; i < numGlyphs; i++) {
    const glyph = font.glyphs.get(i);

    const codepoint =
      glyph.unicode !== undefined
        ? glyph.unicode
        : (glyph.unicodes && glyph.unicodes.length > 0 ? glyph.unicodes[0] : -1);

    if (codepoint < 0) continue;

    const advanceWidthPx = Math.round((glyph.advanceWidth || 0) * scale);

    const pad = 1 + embolden;
    const bbox = glyph.getBoundingBox();
    const vXMin = Math.floor(bbox.x1 * scale) - pad;
    const vYMin = Math.floor(bbox.y1 * scale) - pad;
    const vXMax = Math.ceil(bbox.x2 * scale) + pad;
    const vYMax = Math.ceil(bbox.y2 * scale) + pad;
    const vW = Math.max(0, vXMax - vXMin);
    const vH = Math.max(0, vYMax - vYMin);

    const hexRows: string[] = [];
    let bbxW = 0, bbxH = 0, bbxX = 0, bbxY = 0;

    if (vW > 0 && vH > 0) {
      const cW = vW * supersample;
      const cH = vH * supersample;
      canvas.width = cW;
      canvas.height = cH;
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, cW, cH);

      const path = glyph.getPath(-vXMin * supersample, vYMax * supersample, fontSize * supersample);
      path.fill = 'black';
      path.draw(ctx);

      const img = ctx.getImageData(0, 0, cW, cH).data;

      const on = new Uint8Array(vW * vH);
      const ssArea = supersample * supersample;
      for (let y = 0; y < vH; y++) {
        for (let x = 0; x < vW; x++) {
          let lin = 0;
          for (let dy = 0; dy < supersample; dy++) {
            for (let dx = 0; dx < supersample; dx++) {
              const px = x * supersample + dx;
              const py = y * supersample + dy;
              lin += srgbToLinear(img[(py * cW + px) * 4]);
            }
          }
          if (lin / ssArea < linearThreshold) on[y * vW + x] = 1;
        }
      }

      if (embolden > 0) {
        const src = new Uint8Array(on);
        for (let y = 0; y < vH; y++) {
          const rs = y * vW;
          for (let x = 0; x < vW; x++) {
            if (src[rs + x]) {
              const end = Math.min(vW - 1, x + embolden);
              for (let d = x; d <= end; d++) on[rs + d] = 1;
            }
          }
        }
      }

      let inkMinX = Infinity, inkMaxX = -Infinity, inkMinY = Infinity, inkMaxY = -Infinity;
      for (let y = 0; y < vH; y++) {
        for (let x = 0; x < vW; x++) {
          if (on[y * vW + x]) {
            if (x < inkMinX) inkMinX = x;
            if (x > inkMaxX) inkMaxX = x;
            if (y < inkMinY) inkMinY = y;
            if (y > inkMaxY) inkMaxY = y;
          }
        }
      }

      if (inkMinX <= inkMaxX && inkMinY <= inkMaxY) {
        bbxW = inkMaxX - inkMinX + 1;
        bbxH = inkMaxY - inkMinY + 1;
        bbxX = vXMin + inkMinX;
        bbxY = vYMax - inkMaxY - 1;

        const bytesPerRow = Math.ceil(bbxW / 8);
        for (let y = inkMinY; y <= inkMaxY; y++) {
          let hexRow = '';
          for (let b = 0; b < bytesPerRow; b++) {
            let byteValue = 0;
            for (let bit = 0; bit < 8; bit++) {
              const x = inkMinX + b * 8 + bit;
              if (x <= inkMaxX && on[y * vW + x]) byteValue |= 1 << (7 - bit);
            }
            hexRow += byteValue.toString(16).padStart(2, '0').toUpperCase();
          }
          hexRows.push(hexRow);
        }

        if (bbxX < globalMinX) globalMinX = bbxX;
        if (bbxY < globalMinY) globalMinY = bbxY;
        if (bbxX + bbxW > globalMaxX) globalMaxX = bbxX + bbxW;
        if (bbxY + bbxH > globalMaxY) globalMaxY = bbxY + bbxH;
      }
    }

    if (advanceWidthPx === 0 && bbxW === 0 && bbxH === 0) continue;

    const swidth = Math.round(((glyph.advanceWidth || 0) / font.unitsPerEm) * 1000);
    const glyphName = sanitizeName(glyph.name) || `uni${codepoint.toString(16).toUpperCase().padStart(4, '0')}`;

    const glyphLines: string[] = [];
    glyphLines.push(`STARTCHAR ${glyphName}`);
    glyphLines.push(`ENCODING ${codepoint}`);
    glyphLines.push(`SWIDTH ${swidth} 0`);
    glyphLines.push(`DWIDTH ${advanceWidthPx} 0`);
    glyphLines.push(`BBX ${bbxW} ${bbxH} ${bbxX} ${bbxY}`);
    if (bbxW > 0 && bbxH > 0) {
      glyphLines.push(`BITMAP`);
      glyphLines.push(...hexRows);
    }
    glyphLines.push(`ENDCHAR`);

    generated.push({ codepoint, lines: glyphLines, dwidth: advanceWidthPx });
  }

  generated.sort((a, b) => a.codepoint - b.codepoint);
  const seen = new Set<number>();
  const finalGlyphs: GlyphEntry[] = [];
  for (const g of generated) {
    if (!seen.has(g.codepoint)) {
      seen.add(g.codepoint);
      finalGlyphs.push(g);
    }
  }

  if (finalGlyphs.length === 0) {
    globalMinX = 0;
    globalMaxX = Math.max(1, fontSize);
    globalMinY = -descentPositive;
    globalMaxY = ascender;
  } else {
    globalMinY = Math.min(globalMinY, -descentPositive);
    globalMaxY = Math.max(globalMaxY, ascender);
  }
  let fbbW = globalMaxX - globalMinX;
  let fbbH = globalMaxY - globalMinY;
  if (fbbW <= 0) { fbbW = Math.max(1, fontSize); globalMinX = 0; }
  if (fbbH <= 0) { fbbH = Math.max(1, ascender + descentPositive, fontSize); globalMinY = -descentPositive; }

  const familyRaw = font.names.fontFamily?.en || 'Unknown';
  const subfamRaw = font.names.fontSubfamily?.en || 'Regular';
  const familyClean = familyRaw.replace(/ /g, '');
  const subfamLc = subfamRaw.toLowerCase();

  let slantCode = 'R';
  if (subfamLc.includes('italic')) slantCode = 'I';
  else if (subfamLc.includes('oblique')) slantCode = 'O';

  let weightXLFD = 'Medium';
  if (subfamLc.includes('bold')) weightXLFD = 'Bold';
  else if (subfamLc.includes('light')) weightXLFD = 'Light';

  const avgWidth = finalGlyphs.length > 0
    ? Math.round((finalGlyphs.reduce((s, g) => s + g.dwidth, 0) / finalGlyphs.length) * 10)
    : 0;

  const os2 = (font.tables as { os2?: { sCapHeight?: number; sxHeight?: number } }).os2 || {};
  const capHeight = typeof os2.sCapHeight === 'number' ? Math.round(os2.sCapHeight * scale) : null;
  const xHeight = typeof os2.sxHeight === 'number' ? Math.round(os2.sxHeight * scale) : null;

  const defaultChar =
    seen.has(0x3F) ? 0x3F :
    finalGlyphs.length > 0 ? finalGlyphs[0].codepoint : 0;

  const bdfLines: string[] = [];
  bdfLines.push(`STARTFONT 2.1`);
  bdfLines.push(`COMMENT Generated by bdf-fontcreator from ${familyRaw}`);
  bdfLines.push(`COMMENT Render: size=${fontSize}px, threshold=${threshold}, supersample=${supersample}, embolden=${embolden}`);
  bdfLines.push(`FONT -Unknown-${familyClean}-${weightXLFD}-${slantCode}-Normal--${fontSize}-${fontSize * 10}-75-75-P-${avgWidth}-ISO10646-1`);
  bdfLines.push(`SIZE ${fontSize} 75 75`);
  bdfLines.push(`FONTBOUNDINGBOX ${fbbW} ${fbbH} ${globalMinX} ${globalMinY}`);

  const props: string[] = [];
  props.push(`FAMILY_NAME "${familyRaw}"`);
  props.push(`WEIGHT_NAME "${weightXLFD}"`);
  props.push(`SLANT "${slantCode}"`);
  props.push(`SETWIDTH_NAME "Normal"`);
  props.push(`PIXEL_SIZE ${fontSize}`);
  props.push(`POINT_SIZE ${fontSize * 10}`);
  props.push(`RESOLUTION_X 75`);
  props.push(`RESOLUTION_Y 75`);
  props.push(`SPACING "P"`);
  props.push(`AVERAGE_WIDTH ${avgWidth}`);
  props.push(`CHARSET_REGISTRY "ISO10646"`);
  props.push(`CHARSET_ENCODING "1"`);
  props.push(`FONT_ASCENT ${ascender}`);
  props.push(`FONT_DESCENT ${descentPositive}`);
  props.push(`DEFAULT_CHAR ${defaultChar}`);
  if (capHeight !== null && capHeight > 0) props.push(`CAP_HEIGHT ${capHeight}`);
  if (xHeight !== null && xHeight > 0) props.push(`X_HEIGHT ${xHeight}`);

  bdfLines.push(`STARTPROPERTIES ${props.length}`);
  bdfLines.push(...props);
  bdfLines.push(`ENDPROPERTIES`);

  bdfLines.push(`CHARS ${finalGlyphs.length}`);
  for (const g of finalGlyphs) bdfLines.push(...g.lines);
  bdfLines.push(`ENDFONT`);

  const encodings: number[] = [];
  let charsCount = 0;
  let startCharCount = 0;
  for (const line of bdfLines) {
    if (line.startsWith('ENCODING ')) encodings.push(parseInt(line.split(' ')[1]));
    else if (line.startsWith('CHARS ')) charsCount = parseInt(line.split(' ')[1]);
    else if (line.startsWith('STARTCHAR ')) startCharCount++;
  }
  for (let k = 1; k < encodings.length; k++) {
    if (encodings[k] <= encodings[k - 1]) throw new Error('BDF output not strictly ascending by codepoint');
  }
  if (charsCount !== startCharCount) throw new Error(`CHARS count mismatch: ${charsCount} != ${startCharCount}`);

  return bdfLines.join('\n');
}

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  n = Math.round(n);
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function srgbToLinear(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function sanitizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name.replace(/[^A-Za-z0-9_.-]/g, '_');
}
