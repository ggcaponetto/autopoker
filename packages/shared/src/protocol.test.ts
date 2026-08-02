import { describe, expect, it } from 'vitest';
import { createDefaultSettings } from './config';
import {
  decodeClientMessage,
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type ServerMessage,
} from './protocol';

describe('client messages', () => {
  it('round-trips a saveProfile message', () => {
    const message: ClientMessage = {
      id: 'req-1',
      type: 'saveProfile',
      profile: {
        id: 'p1',
        name: 'Profile',
        regions: [],
        settings: createDefaultSettings(),
      },
    };
    expect(decodeClientMessage(encodeMessage(message))).toEqual(message);
  });

  it('round-trips messages without an id', () => {
    const message: ClientMessage = { type: 'stop' };
    expect(decodeClientMessage(encodeMessage(message))).toEqual(message);
  });

  it('rejects unknown message types', () => {
    expect(() => decodeClientMessage(JSON.stringify({ type: 'reboot' }))).toThrow();
  });

  it('rejects invalid payloads for known types', () => {
    expect(() => decodeClientMessage(JSON.stringify({ type: 'start' }))).toThrow();
  });
});

describe('server messages', () => {
  it('round-trips a triggered event', () => {
    const message: ServerMessage = {
      type: 'triggered',
      regionId: 'r1',
      regionName: 'Call button',
      at: 1_700_000_000_000,
      dryRun: true,
      steps: [{ type: 'click', button: 'left', double: false, target: 'regionCenter' }],
    };
    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it('round-trips a previewFrame event', () => {
    const message: ServerMessage = {
      type: 'previewFrame',
      monitorKey: 'DISPLAY1',
      seq: 42,
      capturedAt: 1_700_000_000_000,
      jpegBase64: 'aGVsbG8=',
    };
    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });

  it('preserves the request id on responses', () => {
    const message: ServerMessage = { id: 'req-9', type: 'ack' };
    expect(decodeServerMessage(encodeMessage(message))).toEqual(message);
  });
});
