// Glasses protocol message types (CONTRACTS.md "Glasses protocol", glasses.md 3.8).
// Keep identical to backend/glasses-service/src/protocol.ts once that file exists.

export type ContainerMsg =
  | {
      kind: 'text';
      id: number;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      z: number;
      content?: string;
      capture?: boolean;
      text_color?: number;
      border_width?: number;
      border_color?: number;
      border_radius?: number;
      padding?: number;
    }
  | {
      kind: 'image';
      id: number;
      name: string;
      x: number;
      y: number;
      w: number;
      h: number;
      z: number;
    };

export interface PageMsg {
  type: 'page';
  layout?: string;
  containers: ContainerMsg[];
  ack_assignment_id?: number | string;
}

export interface TextMsg {
  type: 'text';
  id: number;
  content: string;
  text_color?: number;
}

export interface ImageMsg {
  type: 'image';
  id: number;
  png_b64: string;
}

export interface ExitMsg {
  type: 'exit';
}

export interface MicMsg {
  type: 'mic';
  on: boolean;
  max_s?: number;
}

export type ServiceMsg = PageMsg | TextMsg | ImageMsg | ExitMsg | MicMsg;

export type InputSource = 'ring' | 'left' | 'right' | 'unknown';
export type InputEventName = 'tap' | 'double_tap' | 'long_press' | 'scroll_up' | 'scroll_down';

export type PluginMsg =
  | { type: 'hello'; serial: string; rescuer?: string }
  | { type: 'input'; source: InputSource; event: InputEventName }
  | { type: 'position'; lat: number; lon: number; accuracy_m?: number }
  | { type: 'heartbeat' }
  | { type: 'ack'; assignment_id: number | string }
  | { type: 'audio'; seq: number; pcm_b64: string; source: 'glasses' | 'phone' }
  | { type: 'audio_end'; seq: number }
  | { type: 'audio_error'; detail: string };

/** Text container id reserved in every layout for the status line. */
export const STATUS_ID = 8;
export const STATUS_NAME = 'status';
export const LINK_LOST_TEXT = 'LINK LOST - retrying';

export function parseServiceMsg(raw: string): ServiceMsg | null {
  try {
    const msg = JSON.parse(raw);
    if (msg && typeof msg === 'object' && typeof msg.type === 'string') return msg as ServiceMsg;
  } catch {
    // fall through
  }
  return null;
}
