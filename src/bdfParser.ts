export interface BdfChar {
  name: string;
  encoding: number;
  width: number;
  height: number;
  xOffset: number;
  yOffset: number;
  bitmap: boolean[][]; // [y][x] where true means pixel is colored
}

export function parseBdf(bdfText: string): BdfChar[] {
  const lines = bdfText.split('\n').map(l => l.trim());
  const chars: BdfChar[] = [];
  
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('STARTCHAR')) {
      const name = lines[i].split(' ')[1] || 'unknown';
      let encoding = -1;
      let width = 0, height = 0, xOffset = 0, yOffset = 0;
      let bitmap: boolean[][] = [];
      
      i++;
      while (i < lines.length && !lines[i].startsWith('ENDCHAR')) {
        if (lines[i].startsWith('ENCODING')) {
          encoding = parseInt(lines[i].split(' ')[1]);
        } else if (lines[i].startsWith('BBX')) {
          const parts = lines[i].split(' ');
          width = parseInt(parts[1]);
          height = parseInt(parts[2]);
          xOffset = parseInt(parts[3]);
          yOffset = parseInt(parts[4]);
        } else if (lines[i].startsWith('BITMAP')) {
          i++;
          for (let y = 0; y < height; y++) {
            if (i >= lines.length || lines[i].startsWith('ENDCHAR')) break;
            
            const hexLine = lines[i];
            const rowBits: boolean[] = [];
            
            for (let b = 0; b < hexLine.length; b += 2) {
              const byteStr = hexLine.substring(b, b + 2);
              if (byteStr.length === 2) {
                const byte = parseInt(byteStr, 16);
                for (let bit = 0; bit < 8; bit++) {
                  if (rowBits.length < width) {
                    rowBits.push((byte & (1 << (7 - bit))) !== 0);
                  }
                }
              }
            }
            bitmap.push(rowBits);
            i++;
          }
          continue; // Already advanced i appropriately for the BITMAP lines
        }
        i++;
      }
      
      // Only add valid characters
      if (width > 0 && height > 0) {
        chars.push({ name, encoding, width, height, xOffset, yOffset, bitmap });
      }
    } else {
      i++;
    }
  }
  
  return chars;
}
