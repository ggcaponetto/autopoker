import { decodeClientMessage, encodeMessage, type ServerMessage } from '@autopoker/shared';
import { WebSocket, WebSocketServer } from 'ws';
import type { ClientConnection } from './handlers';

export interface WsServerOptions {
  port: number;
  onMessage(client: ClientConnection, raw: string): void;
  onConnect(client: ClientConnection): void;
  onDisconnect(client: ClientConnection): void;
}

export interface WsServerHandle {
  broadcast(message: ServerMessage): void;
  close(): void;
}

export function startWsServer(options: WsServerOptions): WsServerHandle {
  const wss = new WebSocketServer({ port: options.port });
  const clients = new Map<ClientConnection, WebSocket>();

  wss.on('connection', (socket) => {
    const client: ClientConnection = {
      send(message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encodeMessage(message));
      },
    };
    clients.set(client, socket);
    socket.on('message', (data) => options.onMessage(client, String(data)));
    socket.on('close', () => {
      clients.delete(client);
      options.onDisconnect(client);
    });
    socket.on('error', () => socket.close());
    options.onConnect(client);
  });

  return {
    broadcast(message) {
      const encoded = encodeMessage(message);
      for (const socket of clients.values()) {
        if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
      }
    },
    close() {
      wss.close();
      for (const socket of clients.values()) socket.terminate();
    },
  };
}

/** Decode a raw client frame, sending a protocol error back on failure. */
export function safeDecode(client: ClientConnection, raw: string) {
  try {
    return decodeClientMessage(raw);
  } catch (error) {
    client.send({ type: 'error', message: `invalid message: ${String(error)}` });
    return undefined;
  }
}
