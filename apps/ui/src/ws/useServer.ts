import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  decodeServerMessage,
  encodeMessage,
  type ClientMessage,
  type EngineState,
  type LlmDecisionRecord,
  type LlmProbeResult,
  type MonitorInfo,
  type Profile,
  type RegionRunState,
  type ServerMessage,
  type Strategy,
} from '@autopoker/shared';

export interface UiEvent {
  at: number;
  kind: 'triggered' | 'log' | 'killSwitch' | 'error' | 'decision';
  level: 'info' | 'warn' | 'error';
  text: string;
}

export interface FrameInfo {
  seq: number;
  jpegBase64: string;
  capturedAt: number;
}

export interface BaselineInfo {
  baselineId: string;
  width: number;
  height: number;
  pngBase64: string;
  at: number;
}

export interface RegionStatusInfo {
  matched: boolean;
  state: RegionRunState;
  value?: number;
}

export interface ServerConnectionState {
  connected: boolean;
  serverVersion: string | null;
  monitors: MonitorInfo[];
  profiles: Profile[];
  strategies: Strategy[];
  engineState: EngineState;
  frames: Record<string, FrameInfo>;
  regionStatus: Record<string, RegionStatusInfo>;
  lastBaseline: BaselineInfo | null;
  llmProbe: LlmProbeResult | null;
  decisions: LlmDecisionRecord[];
  events: UiEvent[];
}

const initialState: ServerConnectionState = {
  connected: false,
  serverVersion: null,
  monitors: [],
  profiles: [],
  strategies: [],
  engineState: {
    running: false,
    dryRun: true,
    profileId: null,
    intervalMs: null,
    killSwitchArmed: false,
  },
  frames: {},
  regionStatus: {},
  lastBaseline: null,
  llmProbe: null,
  decisions: [],
  events: [],
};

type InternalAction =
  { type: 'connected' } | { type: 'disconnected' } | { type: 'message'; message: ServerMessage };

function pushEvent(events: UiEvent[], event: UiEvent): UiEvent[] {
  return [...events.slice(-199), event];
}

function reducer(state: ServerConnectionState, action: InternalAction): ServerConnectionState {
  switch (action.type) {
    case 'connected':
      return { ...state, connected: true };
    case 'disconnected':
      return { ...state, connected: false, frames: {} };
    case 'message': {
      const message = action.message;
      switch (message.type) {
        case 'hello':
          return {
            ...state,
            serverVersion: message.serverVersion,
            engineState: message.engineState,
          };
        case 'monitors':
          return { ...state, monitors: message.list };
        case 'profiles':
          return { ...state, profiles: message.list };
        case 'strategies':
          return { ...state, strategies: message.list };
        case 'attachmentSaved':
          return state; // the follow-up `strategies` broadcast carries the new list
        case 'llmProbe':
          // Stored, not logged: probes fire automatically for Ollama now, and an
          // event per probe would flood the log. The model panel's pill shows it.
          return { ...state, llmProbe: message.result };
        case 'llmDecision': {
          const { record } = message;
          const verdict = record.executed
            ? `executed ${record.steps.length} step${record.steps.length === 1 ? '' : 's'}`
            : `skipped (${record.skippedReason ?? 'no reason given'})`;
          return {
            ...state,
            // Only the newest decision keeps its screenshots: they are large, and the
            // decision card only ever shows the latest record.
            decisions: [
              ...state.decisions
                .slice(-49)
                .map((entry) =>
                  entry.screenshots.length > 0 ? { ...entry, screenshots: [] } : entry,
                ),
              record,
            ],
            events: pushEvent(state.events, {
              at: record.at,
              kind: 'decision',
              level: record.executed ? 'info' : 'warn',
              text: `${record.model} (${(record.decision.confidence * 100).toFixed(0)}%, ${record.latencyMs}ms): ${record.decision.observation} — ${verdict}`,
            }),
          };
        }
        case 'engineState':
          return { ...state, engineState: message.state };
        case 'previewFrame':
          return {
            ...state,
            frames: {
              ...state.frames,
              [message.monitorKey]: {
                seq: message.seq,
                jpegBase64: message.jpegBase64,
                capturedAt: message.capturedAt,
              },
            },
          };
        case 'regionStatus':
          return {
            ...state,
            regionStatus: {
              ...state.regionStatus,
              [message.regionId]: {
                matched: message.matched,
                state: message.state,
                value: message.value,
              },
            },
          };
        case 'baselineCaptured':
          return {
            ...state,
            lastBaseline: {
              baselineId: message.baselineId,
              width: message.width,
              height: message.height,
              pngBase64: message.pngBase64,
              at: Date.now(),
            },
          };
        case 'triggered':
          return {
            ...state,
            events: pushEvent(state.events, {
              at: message.at,
              kind: 'triggered',
              level: 'info',
              text: `${message.dryRun ? '[dry-run] ' : ''}"${message.regionName}" triggered (${message.steps.length} step${message.steps.length === 1 ? '' : 's'})`,
            }),
          };
        case 'killSwitch':
          return {
            ...state,
            events: pushEvent(state.events, {
              at: Date.now(),
              kind: 'killSwitch',
              level: 'warn',
              text: `engine halted by ${message.reason === 'hotkey' ? 'kill-switch hotkey' : 'corner failsafe'}`,
            }),
          };
        case 'log':
          return {
            ...state,
            events: pushEvent(state.events, {
              at: message.at,
              kind: 'log',
              level: message.level,
              text: message.message,
            }),
          };
        case 'error':
          return {
            ...state,
            events: pushEvent(state.events, {
              at: Date.now(),
              kind: 'error',
              level: 'error',
              text: message.message,
            }),
          };
        case 'ack':
          return state;
      }
    }
  }
}

export function useServer(url = 'ws://localhost:8787') {
  const [state, dispatch] = useReducer(reducer, initialState);
  const socketRef = useRef<WebSocket | null>(null);
  const nextIdRef = useRef(0);
  const listenersRef = useRef(new Set<(message: ServerMessage) => void>());

  /** Sends a message and returns its request id (for matching the ack), or null if dropped. */
  const send = useCallback((message: ClientMessage): string | null => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn('autopoker: dropped message, socket not open:', message.type);
      return null;
    }
    nextIdRef.current += 1;
    const id = `c${nextIdRef.current}`;
    socket.send(encodeMessage({ ...message, id }));
    return id;
  }, []);

  /** Subscribe to raw server messages (for one-shot flows like baseline capture). */
  const subscribe = useCallback((listener: (message: ServerMessage) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let activeSocket: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(url);
      activeSocket = socket;
      socketRef.current = socket;
      // StrictMode mounts this effect twice in dev: the first socket closes late,
      // and its events must never touch state owned by its replacement.
      const isCurrent = () => socketRef.current === socket;
      socket.onopen = () => {
        if (!isCurrent()) return;
        dispatch({ type: 'connected' });
        socket.send(encodeMessage({ type: 'listMonitors' }));
        socket.send(encodeMessage({ type: 'listProfiles' }));
      };
      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        try {
          const message = decodeServerMessage(String(event.data));
          dispatch({ type: 'message', message });
          for (const listener of listenersRef.current) listener(message);
        } catch {
          // Ignore malformed frames; the server also reports protocol errors explicitly.
        }
      };
      socket.onclose = () => {
        if (!isCurrent()) return;
        socketRef.current = null;
        dispatch({ type: 'disconnected' });
        if (!disposed) retry = setTimeout(connect, 2000);
      };
      socket.onerror = () => socket.close();
    };

    connect();
    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      activeSocket?.close();
    };
  }, [url]);

  return { state, send, subscribe };
}
