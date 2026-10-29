import { deflateSync } from 'node:zlib';
import type { ChallengerPoint } from '../forecast/challenger';
import { CAROLINA_BEACH_THRESHOLDS, FloodThresholdSet } from './operationalAlerts';

// Precompute IEEE 802.3 CRC32 lookup table
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(typeAndData), 0);
  return Buffer.concat([lenBuf, typeAndData, crcBuf]);
}

function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    rawScanlines.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = deflateSync(rawScanlines, { level: 6 });
  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Crisp 5x7 pixel bitmap glyphs for axis labels & peak badge
const GLYPHS_5X7: Record<string, string[]> = {
  '0': ['01110', '10001', '10011', '10101', '11001', '10001', '01110'],
  '1': ['00100', '01100', '00100', '00100', '00100', '00100', '01110'],
  '2': ['01110', '10001', '00001', '00110', '01000', '10000', '11111'],
  '3': ['11110', '00001', '00001', '01110', '00001', '00001', '11110'],
  '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
  '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
  '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
  '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
  '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
  '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
  '.': ['00000', '00000', '00000', '00000', '00000', '01100', '01100'],
  '+': ['00000', '00100', '00100', '11111', '00100', '00100', '00000'],
  '-': ['00000', '00000', '00000', '11111', '00000', '00000', '00000'],
  ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
  'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
  'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  'I': ['01110', '00100', '00100', '00100', '00100', '00100', '01110'],
  'N': ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
  'D': ['11110', '10001', '10001', '10001', '10001', '10001', '11110'],
  'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  'J': ['00111', '00010', '00010', '00010', '10010', '10010', '01100'],
  'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
  'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
  'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
  'W': ['10001', '10001', '10001', '10101', '10101', '11011', '10001'],
  'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
  'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
};

type Rgba = [number, number, number, number];

class PixelCanvas {
  readonly rgba: Uint8Array;
  constructor(
    readonly width: number,
    readonly height: number,
    bg: Rgba
  ) {
    this.rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      this.rgba[i * 4] = bg[0];
      this.rgba[i * 4 + 1] = bg[1];
      this.rgba[i * 4 + 2] = bg[2];
      this.rgba[i * 4 + 3] = bg[3];
    }
  }

  blendPixel(x: number, y: number, color: Rgba): void {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || ix >= this.width || iy < 0 || iy >= this.height) return;
    const idx = (iy * this.width + ix) * 4;
    const a = color[3] / 255;
    const inv = 1 - a;
    this.rgba[idx] = Math.round(color[0] * a + this.rgba[idx] * inv);
    this.rgba[idx + 1] = Math.round(color[1] * a + this.rgba[idx + 1] * inv);
    this.rgba[idx + 2] = Math.round(color[2] * a + this.rgba[idx + 2] * inv);
    this.rgba[idx + 3] = 255;
  }

  fillRect(x0: number, y0: number, w: number, h: number, color: Rgba): void {
    const sx = Math.max(0, Math.floor(x0));
    const sy = Math.max(0, Math.floor(y0));
    const ex = Math.min(this.width, Math.ceil(x0 + w));
    const ey = Math.min(this.height, Math.ceil(y0 + h));
    for (let y = sy; y < ey; y++) {
      for (let x = sx; x < ex; x++) {
        this.blendPixel(x, y, color);
      }
    }
  }

  drawLine(x0: number, y0: number, x1: number, y1: number, color: Rgba, thickness = 1, dashed = false): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) * 2));
    const half = (thickness - 1) / 2;
    for (let s = 0; s <= steps; s++) {
      if (dashed && Math.floor(s / 10) % 2 === 1) continue;
      const px = x0 + (dx * s) / steps;
      const py = y0 + (dy * s) / steps;
      if (thickness <= 1.1) {
        this.blendPixel(px, py, color);
      } else {
        const rCeil = Math.ceil(half);
        for (let oy = -rCeil; oy <= rCeil; oy++) {
          for (let ox = -rCeil; ox <= rCeil; ox++) {
            if (ox * ox + oy * oy <= (half + 0.45) * (half + 0.45)) {
              this.blendPixel(px + ox, py + oy, color);
            }
          }
        }
      }
    }
  }

  fillCircle(cx: number, cy: number, radius: number, color: Rgba): void {
    const r = Math.ceil(radius);
    for (let oy = -r; oy <= r; oy++) {
      for (let ox = -r; ox <= r; ox++) {
        if (ox * ox + oy * oy <= radius * radius) {
          this.blendPixel(cx + ox, cy + oy, color);
        }
      }
    }
  }

  drawText(text: string, x: number, y: number, color: Rgba, scale = 1): void {
    const upper = text.toUpperCase();
    let cursorX = Math.round(x);
    for (const ch of upper) {
      const glyph = GLYPHS_5X7[ch] ?? GLYPHS_5X7[' '];
      for (let gy = 0; gy < 7; gy++) {
        for (let gx = 0; gx < 5; gx++) {
          if (glyph[gy][gx] === '1') {
            this.fillRect(cursorX + gx * scale, y + gy * scale, scale, scale, color);
          }
        }
      }
      cursorX += 6 * scale;
    }
  }
}

export interface RenderHydrographPngOptions {
  points: ChallengerPoint[];
  originMs?: number;
  horizonHours?: number;
  thresholds?: FloodThresholdSet;
  highlightPeakIso?: string | null;
  width?: number;
  height?: number;
}

/**
 * Renders a 680x260 48-hour operational hydrograph chart as a universal PNG buffer
 * suitable for HTML email `<img>` embedding and social/advisory previews.
 */
export function renderHydrographPng(options: RenderHydrographPngOptions): Buffer {
  const width = Math.max(320, Math.min(1200, options.width ?? 680));
  const height = Math.max(180, Math.min(600, options.height ?? 260));
  const thresholds = options.thresholds ?? CAROLINA_BEACH_THRESHOLDS;
  const horizonMs = (options.horizonHours ?? 48) * 3600_000;

  const canvas = new PixelCanvas(width, height, [11, 22, 40, 255]); // #0b1628 coastal slate-navy

  // Subtle card border
  canvas.fillRect(0, 0, width, 2, [30, 58, 95, 255]);
  canvas.fillRect(0, height - 2, width, 2, [30, 58, 95, 255]);
  canvas.fillRect(0, 0, 2, height, [30, 58, 95, 255]);
  canvas.fillRect(width - 2, 0, 2, height, [30, 58, 95, 255]);

  const padLeft = 46;
  const padRight = 22;
  const padTop = 34;
  const padBottom = 30;
  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  // Header legend strip
  canvas.drawText('48H WATER LEVEL FORECAST FT MLLW', padLeft, 12, [191, 219, 254, 255], 1);
  canvas.fillRect(width - 190, 14, 12, 3, [56, 189, 248, 255]);
  canvas.drawText('FORECAST', width - 172, 12, [186, 230, 253, 255], 1);
  canvas.fillRect(width - 102, 14, 12, 2, [148, 163, 184, 200]);
  canvas.drawText('TIDE', width - 84, 12, [148, 163, 184, 255], 1);

  const valid = (options.points || [])
    .filter(p => p && Number.isFinite(Date.parse(p.t)) && Number.isFinite(p.totalFt))
    .sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  const startMs = options.originMs ?? (valid.length ? Date.parse(valid[0].t) : Date.now());
  const endMs = startMs + horizonMs;
  const windowed = valid.filter(p => {
    const ms = Date.parse(p.t);
    return ms >= startMs - 1800_000 && ms <= endMs + 1800_000;
  });

  if (windowed.length < 2) {
    canvas.drawText('NO FORECAST DATA AVAILABLE', padLeft + 80, padTop + Math.floor(plotH / 2), [148, 163, 184, 255], 2);
    return encodeRgbaToPng(width, height, canvas.rgba);
  }

  let minFt = 0;
  let maxFt = Math.max(thresholds.major + 0.5, 8.2);
  for (const p of windowed) {
    if (p.totalFt < minFt) minFt = Math.floor(p.totalFt - 0.5);
    if (p.tideFt < minFt) minFt = Math.floor(p.tideFt - 0.5);
    if (p.totalFt + 0.6 > maxFt) maxFt = Math.ceil((p.totalFt + 0.6) * 2) / 2;
  }
  const ySpan = Math.max(4, maxFt - minFt);

  const xOf = (ms: number) => padLeft + ((ms - startMs) / horizonMs) * plotW;
  const yOf = (ft: number) => padTop + (1 - (ft - minFt) / ySpan) * plotH;

  // Shade minor/moderate/major flood zones softly
  const yMinor = yOf(thresholds.minor);
  const yModerate = yOf(thresholds.moderate);
  const yMajor = yOf(thresholds.major);

  if (yMinor > padTop) {
    const topMinor = Math.max(padTop, yModerate);
    canvas.fillRect(padLeft, topMinor, plotW, Math.max(0, Math.min(padTop + plotH, yMinor) - topMinor), [245, 158, 11, 22]);
  }
  if (yModerate > padTop) {
    const topMod = Math.max(padTop, yMajor);
    canvas.fillRect(padLeft, topMod, plotW, Math.max(0, yModerate - topMod), [249, 115, 22, 28]);
  }
  if (yMajor > padTop) {
    canvas.fillRect(padLeft, padTop, plotW, Math.max(0, yMajor - padTop), [239, 68, 68, 34]);
  }

  // Horizontal integer gridlines
  for (let ft = Math.ceil(minFt); ft <= Math.floor(maxFt); ft += 2) {
    const gy = yOf(ft);
    canvas.drawLine(padLeft, gy, padLeft + plotW, gy, [51, 65, 85, 130], 1);
    canvas.drawText(`${ft}FT`, 8, Math.round(gy - 3), [148, 163, 184, 220], 1);
  }

  // Vertical 12h gridlines
  for (let h = 0; h <= 48; h += 12) {
    const gx = xOf(startMs + h * 3600_000);
    canvas.drawLine(gx, padTop, gx, padTop + plotH, [51, 65, 85, 130], 1);
    const label = h === 0 ? 'NOW' : `+${h}H`;
    canvas.drawText(label, Math.round(gx - 10), padTop + plotH + 10, [148, 163, 184, 230], 1);
  }

  // Threshold dashed lines (Minor 5.6, Moderate 7.0, Major 7.7)
  const thresholdSpecs: Array<{ ft: number; label: string; color: Rgba }> = [
    { ft: thresholds.minor, label: `${thresholds.minor.toFixed(1)} MIN`, color: [251, 191, 36, 220] },
    { ft: thresholds.moderate, label: `${thresholds.moderate.toFixed(1)} MOD`, color: [251, 146, 60, 220] },
    { ft: thresholds.major, label: `${thresholds.major.toFixed(1)} MAJ`, color: [248, 113, 113, 230] },
  ];
  for (const ts of thresholdSpecs) {
    if (ts.ft >= minFt && ts.ft <= maxFt) {
      const ty = yOf(ts.ft);
      canvas.drawLine(padLeft, ty, padLeft + plotW, ty, ts.color, 1, true);
      canvas.drawText(ts.label, padLeft + 6, Math.max(padTop + 2, Math.round(ty - 9)), ts.color, 1);
    }
  }

  // Astronomical tide curve
  for (let i = 1; i < windowed.length; i++) {
    const a = windowed[i - 1];
    const b = windowed[i];
    const x0 = Math.max(padLeft, Math.min(padLeft + plotW, xOf(Date.parse(a.t))));
    const x1 = Math.max(padLeft, Math.min(padLeft + plotW, xOf(Date.parse(b.t))));
    canvas.drawLine(x0, yOf(a.tideFt), x1, yOf(b.tideFt), [148, 163, 184, 175], 1.4, true);
  }

  // Uncertainty ribbon (lowerFt .. upperFt)
  for (let i = 0; i < windowed.length; i++) {
    const p = windowed[i];
    if (typeof p.lowerFt === 'number' && typeof p.upperFt === 'number') {
      const px = Math.round(xOf(Date.parse(p.t)));
      if (px >= padLeft && px <= padLeft + plotW) {
        const yTop = Math.max(padTop, Math.round(yOf(p.upperFt)));
        const yBot = Math.min(padTop + plotH, Math.round(yOf(p.lowerFt)));
        canvas.fillRect(px, yTop, 3, Math.max(1, yBot - yTop), [56, 189, 248, 28]);
      }
    }
  }

  // Primary Operational Forecast Water Level curve (amber/coral above 5.6 ft!)
  let peakPt = windowed[0];
  for (let i = 1; i < windowed.length; i++) {
    const a = windowed[i - 1];
    const b = windowed[i];
    if (b.totalFt > peakPt.totalFt) peakPt = b;
    const x0 = Math.max(padLeft, Math.min(padLeft + plotW, xOf(Date.parse(a.t))));
    const x1 = Math.max(padLeft, Math.min(padLeft + plotW, xOf(Date.parse(b.t))));
    const above = Math.max(a.totalFt, b.totalFt) >= thresholds.minor;
    const aboveMod = Math.max(a.totalFt, b.totalFt) >= thresholds.moderate;
    const lineColor: Rgba = aboveMod
      ? [249, 115, 22, 255]
      : above
        ? [251, 191, 36, 255]
        : [56, 189, 248, 255];
    canvas.drawLine(x0, yOf(a.totalFt), x1, yOf(b.totalFt), lineColor, 2.6, false);
  }

  // Highlight requested peak or 48h maximum crest
  if (options.highlightPeakIso) {
    const targetMs = Date.parse(options.highlightPeakIso);
    let closest = peakPt;
    let bestDist = Infinity;
    for (const p of windowed) {
      const d = Math.abs(Date.parse(p.t) - targetMs);
      if (d < bestDist) {
        bestDist = d;
        closest = p;
      }
    }
    if (bestDist <= 2 * 3600_000) peakPt = closest;
  }

  const px = Math.max(padLeft + 6, Math.min(padLeft + plotW - 6, xOf(Date.parse(peakPt.t))));
  const py = Math.max(padTop + 6, Math.min(padTop + plotH - 6, yOf(peakPt.totalFt)));
  const crestColor: Rgba =
    peakPt.totalFt >= thresholds.moderate
      ? [249, 115, 22, 255]
      : peakPt.totalFt >= thresholds.minor
        ? [251, 191, 36, 255]
        : [56, 189, 248, 255];

  canvas.fillCircle(px, py, 7, [255, 255, 255, 70]);
  canvas.fillCircle(px, py, 4.5, crestColor);

  const badgeText = `PEAK ${peakPt.totalFt.toFixed(2)}FT`;
  const badgeW = badgeText.length * 6 + 10;
  const badgeX = Math.min(padLeft + plotW - badgeW - 2, Math.max(padLeft + 4, Math.round(px - badgeW / 2)));
  const badgeY = py > padTop + 26 ? Math.round(py - 20) : Math.round(py + 10);
  canvas.fillRect(badgeX, badgeY, badgeW, 13, [15, 23, 42, 230]);
  canvas.drawText(badgeText, badgeX + 5, badgeY + 3, crestColor, 1);

  return encodeRgbaToPng(width, height, canvas.rgba);
}

