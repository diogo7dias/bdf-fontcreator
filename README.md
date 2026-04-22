# ttf into bdf

A totally free, entirely client-side web application that converts TrueType Font (`.ttf`) files into Bitmap Distribution Format (`.bdf`) files directly in your browser. 

Hosted live at: [https://diogo7dias.github.io/bdf-fontcreator/](https://diogo7dias.github.io/bdf-fontcreator/)

## How it Works

1. **Client-Side Parsing:** We use `opentype.js` to parse the vector math of the TrueType font.
2. **Rasterization:** The app draws each character onto a hidden HTML5 `<canvas>` element at your specified output pixel size.
3. **BDF Generation:** We read the raw pixel data from the canvas, construct the bitmap matrix for each character, and generate a `.bdf` file perfectly formatted to the BDF 2.1 specification.

Since everything runs in the browser, your font files are **never uploaded to any server**.

## Development

Built with Vite, React, and TypeScript.

```bash
# Install dependencies
npm install

# Start local dev server
npm run dev

# Build for production
npm run build
```

## Aesthetic

Features a 90s retro web hacker aesthetic with a pure black & white palette, dashed borders, and a moving CSS-only pixel checkerboard background.
