import opentype from 'opentype.js';

export interface FontProfile {
  family: string;
  subfamily: string;
  weight: number;
  italic: boolean;
  serif: boolean;
  monospace: boolean;
}

export interface TunedSettings {
  threshold: number;
  supersample: number;
  embolden: number;
}

interface Os2Table {
  usWeightClass?: number;
  sFamilyClass?: number;
}

interface PostTable {
  isFixedPitch?: number;
  italicAngle?: number;
}

interface HeadTable {
  macStyle?: number;
}

export function analyzeFont(buffer: ArrayBuffer): FontProfile {
  const font = opentype.parse(buffer);
  const tables = font.tables as {
    os2?: Os2Table;
    post?: PostTable;
    head?: HeadTable;
  };

  const os2 = tables.os2 ?? {};
  const post = tables.post ?? {};
  const head = tables.head ?? {};

  const family = font.names.fontFamily?.en ?? 'Unknown';
  const subfamily = font.names.fontSubfamily?.en ?? 'Regular';
  const weight = os2.usWeightClass ?? 400;

  const italicByMacStyle = ((head.macStyle ?? 0) & 0x02) !== 0;
  const italicByAngle = (post.italicAngle ?? 0) !== 0;
  const italicByName = /italic|oblique/i.test(subfamily);
  const italic = italicByMacStyle || italicByAngle || italicByName;

  const monospace = (post.isFixedPitch ?? 0) !== 0;

  const serif = classifyAsSerif(os2.sFamilyClass, family, subfamily);

  return { family, subfamily, weight, italic, serif, monospace };
}

function classifyAsSerif(sFamilyClass: number | undefined, family: string, subfamily: string): boolean {
  if (sFamilyClass !== undefined && sFamilyClass !== 0) {
    // High byte of sFamilyClass: 1-7 and 10 = serif families; 8 = sans-serif; 9 = ornamental; 12 = symbolic.
    const cls = (sFamilyClass >> 8) & 0xff;
    if (cls === 8) return false;
    if ((cls >= 1 && cls <= 7) || cls === 10) return true;
  }
  // Fall back to name heuristics when OS/2 is missing or unclassified.
  const combined = `${family} ${subfamily}`.toLowerCase();
  if (/\bsans\b|grotesk|grotesque|gothic/.test(combined)) return false;
  if (/serif|roman|antiqua|garamond|times|georgia|book|vollkorn|bookerly/.test(combined)) return true;
  return true; // Serif is the safer default for e-reader long-form use.
}

export function suggestSizes(profile: FontProfile): number[] {
  // DX34 firmware's built-in reader uses 12-17; mono fonts read better a notch larger.
  if (profile.monospace) return [13, 15, 17];
  return [12, 14, 16];
}

export function pickSettings(profile: FontProfile, size: number): TunedSettings {
  const threshold = pickThreshold(profile, size);
  const supersample = pickSupersample(profile, size);
  const embolden = pickEmbolden(profile, size);
  return { threshold, supersample, embolden };
}

function pickThreshold(profile: FontProfile, size: number): number {
  let t = 128 + Math.round((profile.weight - 400) / 12);
  if (size <= 14) t -= 8;
  if (profile.serif && size <= 14) t -= 4;
  return clamp(t, 96, 168);
}

function pickSupersample(profile: FontProfile, size: number): number {
  let s: number;
  if (size <= 14) s = 4;
  else if (size <= 18) s = 3;
  else s = 2;
  if (profile.serif && size < 22 && s < 3) s = 3;
  return clamp(s, 1, 4);
}

function pickEmbolden(profile: FontProfile, size: number): number {
  if (profile.weight <= 300 && size <= 13) return 1;
  return 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function describeProfile(profile: FontProfile): string {
  const weightName = weightClassName(profile.weight);
  const parts = [weightName];
  if (profile.italic) parts.push('italic');
  parts.push(profile.serif ? 'serif' : 'sans');
  if (profile.monospace) parts.push('mono');
  return parts.join(', ');
}

function weightClassName(w: number): string {
  if (w <= 250) return 'Thin';
  if (w <= 350) return 'Light';
  if (w <= 450) return 'Regular';
  if (w <= 550) return 'Medium';
  if (w <= 650) return 'SemiBold';
  if (w <= 750) return 'Bold';
  if (w <= 850) return 'ExtraBold';
  return 'Black';
}
