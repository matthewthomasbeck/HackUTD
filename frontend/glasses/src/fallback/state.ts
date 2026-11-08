// Container map for the fallback page, built from service messages
// (CONTRACTS.md "Glasses protocol", glasses.md sections 3.8 and 6).
// The page keeps no state of its own across connections: the service resends a full
// `page`, every text, and every image on each new socket.

import type { ContainerMsg, ServiceMsg } from '../plugin/protocol.js';

export type Container = ContainerMsg;

export interface Snapshot {
  layout: string;
  containers: Container[];
  images: Map<number, CanvasImageSource>;
  ackAssignmentId: number | string | null;
  exited: boolean;
}

export type TintFn = (bitmap: ImageBitmap) => CanvasImageSource;

export class GlassesState {
  layout = '';
  containers = new Map<number, Container>();
  images = new Map<number, CanvasImageSource>();
  ackAssignmentId: number | string | null = null;
  exited = false;
  lastMessageAt = 0;
  private generation = 0;

  constructor(private readonly tint: TintFn) {}

  /** Applies one message. Resolves once the change is ready to draw (images decode first). */
  async apply(msg: ServiceMsg): Promise<boolean> {
    this.lastMessageAt = Date.now();
    switch (msg.type) {
      case 'page': {
        this.generation++;
        this.layout = msg.layout ?? '';
        this.containers = new Map(msg.containers.map((c) => [c.id, { ...c }]));
        this.images = new Map();
        this.ackAssignmentId = msg.ack_assignment_id ?? null;
        this.exited = false;
        return true;
      }
      case 'text': {
        const c = this.containers.get(msg.id);
        if (!c || c.kind !== 'text') {
          console.warn(`[fallback] text for unknown text container ${msg.id}`);
          return false;
        }
        c.content = msg.content;
        if (msg.text_color !== undefined) c.text_color = msg.text_color;
        return true;
      }
      case 'image': {
        const gen = this.generation;
        const c = this.containers.get(msg.id);
        if (!c || c.kind !== 'image') {
          console.warn(`[fallback] image for unknown image container ${msg.id}`);
          return false;
        }
        const bitmap = await decodePng(msg.png_b64);
        if (gen !== this.generation) return false; // a newer page replaced this layout
        this.images.set(msg.id, this.tint(bitmap));
        return true;
      }
      case 'exit': {
        this.exited = true;
        return true;
      }
      case 'mic':
        // Microphone messages go only to the plugin (glasses.md 5.5); ignore if one arrives.
        return false;
      default: {
        console.warn('[fallback] unknown message type', (msg as { type?: unknown }).type);
        return false;
      }
    }
  }

  /** Writes a status line locally (id 8), as the plugin does when the link drops (glasses.md 3.6). */
  setStatus(text: string): void {
    const c = this.containers.get(8);
    if (c && c.kind === 'text') c.content = text;
  }

  snapshot(): Snapshot {
    return {
      layout: this.layout,
      containers: [...this.containers.values()].sort((a, b) => a.z - b.z),
      images: this.images,
      ackAssignmentId: this.ackAssignmentId,
      exited: this.exited,
    };
  }
}

async function decodePng(b64: string): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
  return createImageBitmap(new Blob([bytes], { type: 'image/png' }));
}
