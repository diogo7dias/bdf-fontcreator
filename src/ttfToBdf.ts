import opentype from 'opentype.js';

export async function convertTtfToBdf(fontBuffer: ArrayBuffer, fontSize: number, embolden: number = 0): Promise<string> {
  const font = opentype.parse(fontBuffer);
  
  const scale = (1 / font.unitsPerEm) * fontSize;
  const ascender = Math.ceil(font.ascender * scale);
  const descender = Math.floor(font.descender * scale); // Usually negative
  
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error("Could not get 2D context");

  const numGlyphs = font.glyphs.length;
  const generatedGlyphs: { codepoint: number; lines: string[]; bbx: { w: number, h: number, x: number, y: number } }[] = [];
  
  let globalMinX = Infinity;
  let globalMinY = Infinity;
  let globalMaxX = -Infinity;
  let globalMaxY = -Infinity;

  for (let i = 0; i < numGlyphs; i++) {
    const glyph = font.glyphs.get(i);
    const unicode = glyph.unicode !== undefined ? glyph.unicode : (glyph.unicodes && glyph.unicodes.length > 0 ? glyph.unicodes[0] : -1);
    
    const advanceWidth = Math.round((glyph.advanceWidth || 0) * scale);
    const vBoundingBox = glyph.getBoundingBox();
    
    // Vector BBX with padding for embolden stroke
    const padding = Math.ceil(embolden) + 1; // Extra 1px padding to be safe
    const vXMin = Math.floor(vBoundingBox.x1 * scale) - padding;
    const vYMin = Math.floor(vBoundingBox.y1 * scale) - padding;
    const vXMax = Math.ceil(vBoundingBox.x2 * scale) + padding;
    const vYMax = Math.ceil(vBoundingBox.y2 * scale) + padding;
    
    const vWidth = Math.max(0, vXMax - vXMin);
    const vHeight = Math.max(0, vYMax - vYMin);

    let inkMinX = Infinity;
    let inkMaxX = -Infinity;
    let inkMinY = Infinity;
    let inkMaxY = -Infinity;
    
    let hexRows: string[] = [];

    if (vWidth > 0 && vHeight > 0) {
      canvas.width = vWidth;
      canvas.height = vHeight;
      
      // Clear canvas
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      const drawPath = glyph.getPath(-vXMin, vYMax, fontSize);
      drawPath.fill = 'black';
      if (embolden > 0) {
        drawPath.stroke = 'black';
        drawPath.strokeWidth = embolden;
      }
      drawPath.draw(ctx);
      
      const imgData = ctx.getImageData(0, 0, vWidth, vHeight).data;
      
      // 1. Scan for exact ink boundaries
      for (let y = 0; y < vHeight; y++) {
        for (let x = 0; x < vWidth; x++) {
          const idx = (y * vWidth + x) * 4;
          if (imgData[idx] < 128) {
            if (x < inkMinX) inkMinX = x;
            if (x > inkMaxX) inkMaxX = x;
            if (y < inkMinY) inkMinY = y;
            if (y > inkMaxY) inkMaxY = y;
          }
        }
      }

      if (inkMinX <= inkMaxX && inkMinY <= inkMaxY) {
        const exactWidth = inkMaxX - inkMinX + 1;
        const exactHeight = inkMaxY - inkMinY + 1;
        
        for (let y = inkMinY; y <= inkMaxY; y++) {
          let hexRow = '';
          const bytesPerRow = Math.ceil(exactWidth / 8);
          for (let b = 0; b < bytesPerRow; b++) {
            let byteValue = 0;
            for (let bit = 0; bit < 8; bit++) {
              const x = inkMinX + b * 8 + bit;
              if (x <= inkMaxX) {
                const idx = (y * vWidth + x) * 4;
                if (imgData[idx] < 128) {
                  byteValue |= (1 << (7 - bit));
                }
              }
            }
            hexRow += byteValue.toString(16).padStart(2, '0').toUpperCase();
          }
          hexRows.push(hexRow);
        }
        
        const bbxW = exactWidth;
        const bbxH = exactHeight;
        const bbxXOff = vXMin + inkMinX;
        const bbxYOff = vYMax - inkMaxY - 1; 
        
        // Temporarily store exact offsets for next step
        inkMinX = bbxW;
        inkMaxX = bbxH;
        inkMinY = bbxXOff;
        inkMaxY = bbxYOff;
      }
    }

    let bbxW = 0, bbxH = 0, bbxX = 0, bbxY = 0;
    if (hexRows.length > 0) {
      bbxW = inkMinX; 
      bbxH = inkMaxX;
      bbxX = inkMinY;
      bbxY = inkMaxY;
      
      if (bbxX < globalMinX) globalMinX = bbxX;
      if (bbxY < globalMinY) globalMinY = bbxY;
      if (bbxX + bbxW > globalMaxX) globalMaxX = bbxX + bbxW;
      if (bbxY + bbxH > globalMaxY) globalMaxY = bbxY + bbxH;
    }

    // Skip .notdef logic: zero advance and no ink
    if (advanceWidth === 0 && bbxW === 0 && bbxH === 0) {
      continue;
    }

    const glyphLines: string[] = [];
    glyphLines.push(`STARTCHAR ${glyph.name || 'char' + i}`);
    glyphLines.push(`ENCODING ${unicode}`);
    glyphLines.push(`SWIDTH ${Math.round((advanceWidth / fontSize) * 1000)} 0`);
    glyphLines.push(`DWIDTH ${advanceWidth} 0`);
    glyphLines.push(`BBX ${bbxW} ${bbxH} ${bbxX} ${bbxY}`);
    if (bbxW > 0 && bbxH > 0) {
      glyphLines.push(`BITMAP`);
      glyphLines.push(...hexRows);
    }
    glyphLines.push(`ENDCHAR`);
    
    generatedGlyphs.push({ codepoint: unicode, lines: glyphLines, bbx: { w: bbxW, h: bbxH, x: bbxX, y: bbxY } });
  }

  // Sort by codepoint ascending
  generatedGlyphs.sort((a, b) => a.codepoint - b.codepoint);

  // Deduplicate
  const seen = new Set<number>();
  const finalGlyphs: typeof generatedGlyphs = [];
  for (const g of generatedGlyphs) {
    if (!seen.has(g.codepoint)) {
      seen.add(g.codepoint);
      finalGlyphs.push(g);
    }
  }

  const bdfLines: string[] = [];
  
  bdfLines.push(`STARTFONT 2.1`);
  bdfLines.push(`COMMENT Generated by bdf-fontcreator from ${font.names.fontFamily?.en || 'Unknown'}`);
  bdfLines.push(`COMMENT Render: size=${fontSize}px, embolden=${embolden}px`);
  
  bdfLines.push(`FONT -${(font.names.fontFamily?.en || 'Unknown').replace(/ /g, '')}-${(font.names.fontSubfamily?.en || 'Regular').replace(/ /g, '')}-R-Normal--${fontSize}-${fontSize * 10}-75-75-C-0-ISO10646-1`);
  bdfLines.push(`SIZE ${fontSize} 75 75`);
  
  if (globalMinX === Infinity) {
    bdfLines.push(`FONTBOUNDINGBOX 0 0 0 0`);
  } else {
    bdfLines.push(`FONTBOUNDINGBOX ${globalMaxX - globalMinX} ${globalMaxY - globalMinY} ${globalMinX} ${globalMinY}`);
  }
  
  bdfLines.push(`STARTPROPERTIES 8`);
  bdfLines.push(`FAMILY_NAME "${font.names.fontFamily?.en || 'Unknown'}"`);
  bdfLines.push(`WEIGHT_NAME "${font.names.fontSubfamily?.en || 'Regular'}"`);
  
  let slant = "R";
  const subfam = (font.names.fontSubfamily?.en || "").toLowerCase();
  if (subfam.includes('italic')) slant = "I";
  else if (subfam.includes('oblique')) slant = "O";
  bdfLines.push(`SLANT "${slant}"`);
  
  bdfLines.push(`PIXEL_SIZE ${fontSize}`);
  bdfLines.push(`POINT_SIZE ${fontSize * 10}`);
  bdfLines.push(`RESOLUTION_Y 75`);
  bdfLines.push(`FONT_ASCENT ${ascender}`);
  bdfLines.push(`FONT_DESCENT ${Math.abs(descender)}`);
  bdfLines.push(`ENDPROPERTIES`);
  
  bdfLines.push(`CHARS ${finalGlyphs.length}`);
  for (const g of finalGlyphs) {
    bdfLines.push(...g.lines);
  }
  bdfLines.push(`ENDFONT`);
  
  // Validation
  const encodings: number[] = [];
  let charsLine = 0;
  let startChars = 0;
  for (const line of bdfLines) {
    if (line.startsWith('ENCODING ')) encodings.push(parseInt(line.split(' ')[1]));
    if (line.startsWith('CHARS ')) charsLine = parseInt(line.split(' ')[1]);
    if (line.startsWith('STARTCHAR ')) startChars++;
  }
  const isSortedAndUnique = encodings.every((val, i, arr) => !i || (val > arr[i - 1]));
  if (!isSortedAndUnique) throw new Error("BDF output not strictly ascending by codepoint");
  if (charsLine !== startChars) throw new Error(`CHARS count mismatch: ${charsLine} != ${startChars}`);
  
  return bdfLines.join('\n');
}
