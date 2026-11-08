// The Unix socket the C++ program connects to (CONTRACTS.md "Robot bridge local protocol").
// One client at a time: a new client replaces the old one. Newline-delimited JSON, UTF-8.

import { mkdirSync, rmSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { dirname } from 'node:path';
import type { LocalMessage } from './mapping.ts';

export interface LocalSocketHandlers {
  onMessage: (msg: LocalMessage) => void;
  onClientConnected: () => void;
  onClientDisconnected: () => void;
  log: (line: string) => void;
}

const MAX_LINE_BYTES = 1024 * 1024;

/** Split a chunk stream into lines; returns the complete lines and keeps the rest. */
export class LineSplitter {
  private buffer = '';

  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    let index = this.buffer.indexOf('\n');
    while (index >= 0) {
      lines.push(this.buffer.slice(0, index));
      this.buffer = this.buffer.slice(index + 1);
      index = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE_BYTES) throw new Error(`line longer than ${MAX_LINE_BYTES} bytes`);
    return lines;
  }
}

/** Parse one NDJSON line into a local message, or say why not. */
export function parseLine(line: string): { msg: LocalMessage } | { error: string } {
  const text = line.trim();
  if (text === '') return { error: 'empty line' };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'not JSON' };
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'not a JSON object' };
  if (typeof (value as { type?: unknown }).type !== 'string') return { error: 'no type field' };
  return { msg: value as LocalMessage };
}

export class LocalSocket {
  private server: Server | undefined;
  private client: Socket | undefined;

  constructor(private readonly path: string, private readonly handlers: LocalSocketHandlers) {}

  get clientConnected(): boolean { return this.client !== undefined && !this.client.destroyed; }

  async listen(): Promise<void> {
    mkdirSync(dirname(this.path), { recursive: true });
    rmSync(this.path, { force: true }); // a stale socket file from a previous run blocks listen()
    const server = createServer((socket) => this.accept(socket));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.path, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', (error) => this.handlers.log(`socket: server error: ${error.message}`));
    this.handlers.log(`socket: listening on ${this.path}`);
  }

  /** Write one message to the C++ client. Returns false when no client is connected. */
  send(message: object): boolean {
    const client = this.client;
    if (!client || client.destroyed) return false;
    client.write(`${JSON.stringify(message)}\n`);
    return true;
  }

  async close(): Promise<void> {
    this.client?.destroy();
    this.client = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    rmSync(this.path, { force: true });
  }

  private accept(socket: Socket): void {
    if (this.client) {
      this.handlers.log('socket: a new robot client replaces the old one');
      const old = this.client;
      this.client = undefined;
      old.destroy();
    }
    this.client = socket;
    socket.setEncoding('utf8');
    const splitter = new LineSplitter();
    this.handlers.log('socket: robot client connected');
    socket.on('data', (chunk: string) => {
      let lines: string[];
      try {
        lines = splitter.push(chunk);
      } catch (error) {
        this.handlers.log(`socket: ${String(error)}; dropping the client`);
        socket.destroy();
        return;
      }
      for (const line of lines) {
        const parsed = parseLine(line);
        if ('error' in parsed) {
          if (parsed.error !== 'empty line') this.handlers.log(`socket: skipped a line (${parsed.error}): ${line.slice(0, 120)}`);
          continue;
        }
        try {
          this.handlers.onMessage(parsed.msg);
        } catch (error) {
          this.handlers.log(`socket: handler failed for ${parsed.msg.type}: ${String(error)}`);
        }
      }
    });
    socket.on('error', (error) => this.handlers.log(`socket: client error: ${error.message}`));
    socket.on('close', () => {
      if (this.client !== socket) return; // replaced by a newer client
      this.client = undefined;
      this.handlers.log('socket: robot client disconnected');
      this.handlers.onClientDisconnected();
    });
    this.handlers.onClientConnected();
  }
}
