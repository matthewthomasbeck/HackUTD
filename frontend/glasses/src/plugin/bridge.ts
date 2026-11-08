// Thin wrapper over the Even Hub SDK (glasses.md 3.2, 3.3, 3.8).
// Every SDK name used here was checked against node_modules/@evenrealities/even_hub_sdk/dist/index.d.ts (0.0.16).
import {
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  ImageRawDataUpdate,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  formatEvenHubPageContainerValidationError,
  validateEvenHubPageContainer,
} from '@evenrealities/even_hub_sdk';
import type { ContainerMsg, PageMsg } from './protocol';
import { STATUS_ID, STATUS_NAME } from './protocol';

/** What the write queue needs from the glasses. The real one wraps the SDK; tests use a fake. */
export interface DisplayBridge {
  rebuild(page: PageMsg): Promise<boolean>;
  text(id: number, name: string, content: string, textColor?: number): Promise<boolean>;
  /** Returns the SDK result string; anything but 'success' is a failure. */
  image(id: number, name: string, bytes: Uint8Array): Promise<string>;
  shutdown(exitMode: 0 | 1): Promise<boolean>;
}

/** Startup page: full-screen capture layer (id 1) and the status line (id 8), nothing else. */
export const STARTUP_CONTAINERS: ContainerMsg[] = [
  { kind: 'text', id: 1, name: 'capture', x: 0, y: 0, w: 576, h: 288, z: 1, content: ' ', capture: true, border_width: 0, padding: 0 },
  { kind: 'text', id: STATUS_ID, name: STATUS_NAME, x: 8, y: 130, w: 560, h: 56, z: 2, content: 'RUBBLE SEARCH\nconnecting...', text_color: 3 },
];

/** Display off (tap, then long press): only the full-screen capture layer, blank, so the G2 shows nothing but
 *  still delivers ring and temple events to wake it. */
export const BLANK_PAGE: PageMsg = {
  type: 'page',
  layout: 'blank',
  containers: [{ kind: 'text', id: 1, name: 'capture', x: 0, y: 0, w: 576, h: 288, z: 1, content: ' ', capture: true, border_width: 0, padding: 0 }],
};

function toText(c: Extract<ContainerMsg, { kind: 'text' }>): TextContainerProperty {
  const p: Partial<TextContainerProperty> = {
    xPosition: c.x,
    yPosition: c.y,
    width: c.w,
    height: c.h,
    containerID: c.id,
    containerName: c.name,
    zOrderIndex: c.z,
    isEventCapture: c.capture ? 1 : 0,
    content: c.content ?? '',
    borderWidth: c.border_width ?? 0,
    borderColor: c.border_color ?? 0,
    borderRadius: c.border_radius ?? 0,
    paddingLength: c.padding ?? 0,
  };
  if (c.text_color !== undefined) p.textColor = c.text_color;
  return new TextContainerProperty(p);
}

function toImage(c: Extract<ContainerMsg, { kind: 'image' }>): ImageContainerProperty {
  return new ImageContainerProperty({
    xPosition: c.x,
    yPosition: c.y,
    width: c.w,
    height: c.h,
    containerID: c.id,
    containerName: c.name,
    zOrderIndex: c.z,
  });
}

export function toSdkContainers(containers: ContainerMsg[]) {
  const textObject: TextContainerProperty[] = [];
  const imageObject: ImageContainerProperty[] = [];
  for (const c of containers) {
    if (c.kind === 'text') textObject.push(toText(c));
    else if (c.kind === 'image') imageObject.push(toImage(c));
  }
  return { containerTotalNum: textObject.length + imageObject.length, textObject, imageObject };
}

function logValidation(where: string, container: ReturnType<typeof toSdkContainers>): void {
  const result = validateEvenHubPageContainer(container);
  if (!result.valid) console.warn(`[bridge] ${where} invalid: ${formatEvenHubPageContainerValidationError(result)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Boot step 2: create the startup page once, retry once after 500 ms if it fails. */
export async function createStartupPage(sdk: EvenAppBridge): Promise<boolean> {
  const fields = toSdkContainers(STARTUP_CONTAINERS);
  logValidation('startup page', fields);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await sdk.createStartUpPageContainer(new CreateStartUpPageContainer(fields));
      const result = StartUpPageCreateResult.normalize(raw);
      if (result === StartUpPageCreateResult.success) return true;
      console.warn(`[bridge] createStartUpPageContainer returned ${result} (attempt ${attempt + 1})`);
    } catch (err) {
      console.warn('[bridge] createStartUpPageContainer threw', err);
    }
    if (attempt === 0) await sleep(500);
  }
  return false;
}

export function sdkDisplayBridge(sdk: EvenAppBridge): DisplayBridge {
  return {
    async rebuild(page) {
      const fields = toSdkContainers(page.containers);
      const ok = await sdk.rebuildPageContainer(new RebuildPageContainer(fields));
      if (!ok) logValidation(`page ${page.layout ?? ''}`, fields);
      return ok;
    },
    async text(id, name, content, textColor) {
      const data: Partial<TextContainerUpgrade> = { containerID: id, containerName: name, content };
      if (textColor !== undefined) data.textColor = textColor;
      return sdk.textContainerUpgrade(new TextContainerUpgrade(data));
    },
    async image(id, name, bytes) {
      const raw = await sdk.updateImageRawData(new ImageRawDataUpdate({ containerID: id, containerName: name, imageData: bytes }));
      return String(raw);
    },
    shutdown(exitMode) {
      return sdk.shutDownPageContainer(exitMode);
    },
  };
}

/** Decode a base64 PNG into the bytes the SDK expects (it decodes and converts to 4-bit grey itself). */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
