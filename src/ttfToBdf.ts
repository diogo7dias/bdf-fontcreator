import opentype from 'opentype.js';

export async function convertTtfToBdf(fontBuffer: ArrayBuffer, fontSize: number): Promise<string> {
  const font = opentype.parse(fontBuffer);
  
  const scale = (1 / font.unitsPerEm) * fontSize;
  const ascender = Math.ceil(font.ascender * scale);
  const descender = Math.floor(font.descender * scale); // Usually negative
  const fontHeight = ascender - descender;
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D context");

  const bdfLines: string[] = [];
  
  bdfLines.push(`STARTFONT 2.1`);
  bdfLines.push(`FONT -${font.names.fontFamily?.en || 'Unknown'}-${font.names.fontSubfamily?.en || 'Regular'}-R-Normal--${fontSize}-${fontSize * 10}-75-75-C-0-ISO10646-1`);
  bdfLines.push(`SIZE ${fontSize} 75 75`);
  bdfLines.push(`FONTBOUNDINGBOX ${Math.ceil((font.tables.head.xMax - font.tables.head.xMin) * scale)} ${fontHeight} ${Math.floor(font.tables.head.xMin * scale)} ${descender}`);
  
  bdfLines.push(`STARTPROPERTIES 2`);
  bdfLines.push(`FONT_ASCENT ${ascender}`);
  bdfLines.push(`FONT_DESCENT ${Math.abs(descender)}`);
  bdfLines.push(`ENDPROPERTIES`);
  
  const numGlyphs = font.glyphs.length;
  const generatedGlyphs: { codepoint: number; lines: string[] }[] = [];
  
  for (let i = 0; i < numGlyphs; i++) {
    const glyph = font.glyphs.get(i);
    const unicode = glyph.unicode !== undefined ? glyph.unicode : (glyph.unicodes && glyph.unicodes.length > 0 ? glyph.unicodes[0] : -1);
    
    // We can also export glyphs without unicode, but standard BDF uses ENCODING
    
    const advanceWidth = Math.round((glyph.advanceWidth || 0) * scale);
    const boundingBox = glyph.getBoundingBox();
    
    const bbXMin = Math.floor(boundingBox.x1 * scale);
    const bbYMin = Math.floor(boundingBox.y1 * scale);
    const bbXMax = Math.ceil(boundingBox.x2 * scale);
    const bbYMax = Math.ceil(boundingBox.y2 * scale);
    
    const bbWidth = Math.max(0, bbXMax - bbXMin);
    const bbHeight = Math.max(0, bbYMax - bbYMin);

    const glyphLines: string[] = [];
    glyphLines.push(`STARTCHAR ${glyph.name || 'char' + i}`);
    glyphLines.push(`ENCODING ${unicode}`);
    glyphLines.push(`SWIDTH ${Math.round((advanceWidth / fontSize) * 1000)} 0`);
    glyphLines.push(`DWIDTH ${advanceWidth} 0`);
    glyphLines.push(`BBX ${bbWidth} ${bbHeight} ${bbXMin} ${bbYMin}`);
    glyphLines.push(`BITMAP`);

    if (bbWidth > 0 && bbHeight > 0) {
      canvas.width = bbWidth;
      canvas.height = bbHeight;
      
      // Clear canvas
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      // Draw glyph
      // We need to offset the drawing so the bounding box fits exactly in the canvas
      // The path coordinates are such that origin (0,0) is baseline start.
      // So drawing at x = -bbXMin, y = bbYMax (since canvas y goes down, path y goes up, opentype.js draw handles y inversion)
      
      const drawPath = glyph.getPath(-bbXMin, bbYMax, fontSize);
      drawPath.fill = 'black';
      drawPath.draw(ctx);
      
      const imgData = ctx.getImageData(0, 0, bbWidth, bbHeight).data;
      
      for (let y = 0; y < bbHeight; y++) {
        let hexRow = '';
        // BDF bitmaps are padded to byte boundaries (8 pixels)
        const bytesPerRow = Math.ceil(bbWidth / 8);
        for (let b = 0; b < bytesPerRow; b++) {
          let byteValue = 0;
          for (let bit = 0; bit < 8; bit++) {
            const x = b * 8 + bit;
            if (x < bbWidth) {
              const idx = (y * bbWidth + x) * 4;
              const r = imgData[idx];
              // If pixel is black (or dark), set bit
              if (r < 128) {
                byteValue |= (1 << (7 - bit));
              }
            }
          }
          hexRow += byteValue.toString(16).padStart(2, '0').toUpperCase();
        }
        glyphLines.push(hexRow);
      }
    }
    
    glyphLines.push(`ENDCHAR`);
    generatedGlyphs.push({ codepoint: unicode, lines: glyphLines });
  }

  // Sort by codepoint ascending
  generatedGlyphs.sort((a, b) => a.codepoint - b.codepoint);

  // Deduplicate
  const seen = new Set<number>();
  const finalGlyphs: { codepoint: number; lines: string[] }[] = [];
  for (const g of generatedGlyphs) {
    if (!seen.has(g.codepoint)) {
      seen.add(g.codepoint);
      finalGlyphs.push(g);
    }
  }

  bdfLines.push(`CHARS ${finalGlyphs.length}`);
  for (const g of finalGlyphs) {
    bdfLines.push(...g.lines);
  }
  
  bdfLines.push(`ENDFONT`);
  
  // Validation
  const encodings: number[] = [];
  for (const line of bdfLines) {
    if (line.startsWith('ENCODING ')) {
      encodings.push(parseInt(line.split(' ')[1]));
    }
  }
  const isSortedAndUnique = encodings.every((val, i, arr) => !i || (val > arr[i - 1]));
  if (!isSortedAndUnique) {
    throw new Error("BDF output not strictly ascending by codepoint");
  }
  
  return bdfLines.join('\n');
}
