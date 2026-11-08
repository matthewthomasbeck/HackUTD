// Text metrics of the G2 firmware font, as budgeted in glasses.md section 4.1.
// UNCONFIRMED until checked on real glasses: change the numbers here only, and keep them
// equal to CHARS_PER_PX in the glasses service, so the page and the service agree.
// This file has no imports, so the dev mock (Node) can import it too.

/** Width of one character in display pixels. */
export const CHAR_W = 13;
/** Distance between lines in display pixels. */
export const LINE_H = 27;
/** Visible height of one line of glyphs; a last line fits when this much of it is inside. */
export const GLYPH_H = 22;

export interface WrapResult {
  lines: string[];
  /** Characters that fit on one line. */
  perLine: number;
  /** Lines that fit in the container height. */
  capacity: number;
  /** More lines than fit: the bottom lines are clipped. */
  overflow: boolean;
  /** A single word was longer than a line and had to be broken. */
  cutWord: boolean;
}

export function charsPerLine(width: number, padding = 0): number {
  return Math.max(1, Math.floor((width - 2 * padding) / CHAR_W));
}

export function lineCapacity(height: number, padding = 0): number {
  return Math.max(0, Math.floor((height - 2 * padding + (LINE_H - GLYPH_H)) / LINE_H));
}

/** Word-wraps `content` to the container, keeping explicit newlines. */
export function wrapText(content: string, width: number, height: number, padding = 0): WrapResult {
  const perLine = charsPerLine(width, padding);
  const capacity = lineCapacity(height, padding);
  const lines: string[] = [];
  let cutWord = false;

  for (const para of content.split('\n')) {
    let line = '';
    for (const word of para.split(' ').filter((w) => w.length > 0)) {
      let rest = word;
      while (rest.length > perLine) {
        cutWord = true;
        if (line) {
          lines.push(line);
          line = '';
        }
        lines.push(rest.slice(0, perLine));
        rest = rest.slice(perLine);
      }
      if (!line) line = rest;
      else if (line.length + 1 + rest.length <= perLine) line += ` ${rest}`;
      else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }

  // Trailing blank lines take no room; a whitespace-only container (the capture layer) has none.
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const visible = lines;
  return { lines: visible, perLine, capacity, overflow: visible.length > capacity, cutWord };
}
