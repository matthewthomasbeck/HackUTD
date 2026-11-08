// Draws the 576x288 glasses display on a canvas, green on black (glasses.md section 6).
// Every color and the font come from frontend/design-tokens/tokens.css.

import type { Container, Snapshot } from './state.js';
import { CHAR_W, GLYPH_H, LINE_H, wrapText } from './text.js';

export const DISPLAY_W = 576;
export const DISPLAY_H = 288;

export interface GlassesTheme {
  bg: string;
  green: [number, number, number];
  /** Alpha for text brightness levels 0 to 4. */
  levels: number[];
  fontMono: string;
}

export interface FitIssue {
  id: number;
  name: string;
  problem: string;
}

export function readTheme(root: Element = document.documentElement): GlassesTheme {
  const css = getComputedStyle(root);
  const token = (name: string): string => {
    const v = css.getPropertyValue(name).trim();
    if (!v) throw new Error(`design token ${name} is missing (is tokens.css loaded?)`);
    return v;
  };
  return {
    bg: token('--glasses-bg'),
    green: toRgb(token('--glasses-green')),
    levels: [0, 1, 2, 3, 4].map((i) => Number(token(`--glasses-level-${i}`))),
    fontMono: token('--font-mono'),
  };
}

/** Resolves any CSS color to [r, g, b] by letting the canvas normalize it. */
function toRgb(color: string): [number, number, number] {
  const ctx = document.createElement('canvas').getContext('2d')!;
  ctx.fillStyle = color;
  const hex = ctx.fillStyle; // "#rrggbb" for opaque colors
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) throw new Error(`cannot read color ${color}`);
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

/** Greyscale value v becomes green * v / 255, as the lens shows it. */
export function makeTint(theme: GlassesTheme) {
  return (bitmap: ImageBitmap): CanvasImageSource => {
    const off = document.createElement('canvas');
    off.width = bitmap.width;
    off.height = bitmap.height;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, off.width, off.height);
    const d = img.data;
    const [gr, gg, gb] = theme.green;
    for (let i = 0; i < d.length; i += 4) {
      const v = ((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * d[i + 3]) / 255 / 255;
      d[i] = gr * v;
      d[i + 1] = gg * v;
      d[i + 2] = gb * v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    bitmap.close();
    return off;
  };
}

export class GlassesRenderer {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly theme: GlassesTheme,
    private readonly res: number,
  ) {
    canvas.width = DISPLAY_W * res;
    canvas.height = DISPLAY_H * res;
    this.ctx = canvas.getContext('2d')!;
  }

  /** Draws the snapshot and returns any text that does not fit its container. */
  draw(s: Snapshot): FitIssue[] {
    const { ctx, theme } = this;
    ctx.setTransform(this.res, 0, 0, this.res, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, DISPLAY_W, DISPLAY_H);
    if (s.exited) return [];

    const issues: FitIssue[] = [];
    for (const c of s.containers) {
      if (c.kind === 'image') this.drawImage(c, s.images.get(c.id));
      else issues.push(...this.drawText(c));
    }
    issues.push(...checkLayout(s.containers));
    return issues;
  }

  private drawImage(c: Container, img: CanvasImageSource | undefined): void {
    if (!img) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 1;
    ctx.drawImage(img, c.x, c.y);
    ctx.restore();
  }

  private drawText(c: Extract<Container, { kind: 'text' }>): FitIssue[] {
    const { ctx, theme } = this;
    const pad = c.padding ?? 0;
    const issues: FitIssue[] = [];

    if ((c.border_width ?? 0) > 0) {
      ctx.save();
      ctx.globalAlpha = levelAlpha(theme, c.border_color ?? 4);
      ctx.strokeStyle = rgbCss(theme.green);
      ctx.lineWidth = c.border_width!;
      const half = c.border_width! / 2;
      ctx.beginPath();
      ctx.roundRect(c.x + half, c.y + half, c.w - c.border_width!, c.h - c.border_width!, c.border_radius ?? 0);
      ctx.stroke();
      ctx.restore();
    }

    const wrap = wrapText(c.content ?? '', c.w, c.h, pad);
    if (wrap.lines.length === 0) return issues;
    if (wrap.overflow) {
      issues.push({ id: c.id, name: c.name, problem: `${wrap.lines.length} lines, room for ${wrap.capacity}` });
    }
    if (wrap.cutWord) issues.push({ id: c.id, name: c.name, problem: `a word is longer than ${wrap.perLine} chars` });

    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    ctx.globalAlpha = levelAlpha(theme, c.text_color ?? 4);
    ctx.fillStyle = rgbCss(theme.green);
    ctx.font = `${GLYPH_H}px ${theme.fontMono}`;
    ctx.textBaseline = 'top';
    // One character per 13 px cell, so the drawn text matches the service's character budget exactly.
    const top = (LINE_H - GLYPH_H) / 2;
    wrap.lines.forEach((line, i) => {
      const y = c.y + pad + i * LINE_H + top;
      for (let k = 0; k < line.length; k++) {
        const ch = line[k];
        if (ch === ' ') continue;
        const w = ctx.measureText(ch).width;
        const x = c.x + pad + k * CHAR_W + (CHAR_W - w) / 2;
        ctx.fillText(ch, x, y, CHAR_W + 1);
      }
    });
    ctx.restore();
    return issues;
  }
}

function levelAlpha(theme: GlassesTheme, level: number): number {
  const i = Math.max(0, Math.min(theme.levels.length - 1, Math.round(level)));
  return theme.levels[i];
}

function rgbCss([r, g, b]: [number, number, number]): string {
  return `rgb(${r} ${g} ${b})`;
}

/** Bounds and overlap checks from glasses.md 4.1 (the service validates too; this makes mistakes visible). */
function checkLayout(cs: Container[]): FitIssue[] {
  const issues: FitIssue[] = [];
  if (cs.length === 0) return issues;
  for (const c of cs) {
    if (c.x < 0 || c.y < 0 || c.x + c.w > DISPLAY_W || c.y + c.h > DISPLAY_H) {
      issues.push({ id: c.id, name: c.name, problem: 'outside 576x288' });
    }
  }
  const texts = cs.filter((c) => c.kind === 'text' && (c.content ?? '').trim() !== '');
  const images = cs.filter((c) => c.kind === 'image');
  for (const t of texts) {
    for (const im of images) {
      if (t.x < im.x + im.w && im.x < t.x + t.w && t.y < im.y + im.h && im.y < t.y + t.h) {
        issues.push({ id: t.id, name: t.name, problem: `overlaps image ${im.id}` });
      }
    }
  }
  if (!cs.some((c) => c.id === 8 && c.kind === 'text')) {
    issues.push({ id: 8, name: 'status', problem: 'layout has no status line (id 8)' });
  }
  return issues;
}
