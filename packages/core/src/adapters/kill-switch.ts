import { uIOhook, UiohookKey } from 'uiohook-napi';

export interface KillSwitchHandle {
  stop(): void;
}

function resolveKeycode(hotkey: string): number | undefined {
  const keys = UiohookKey as unknown as Record<string, number>;
  const normalized = hotkey.charAt(0).toUpperCase() + hotkey.slice(1).toLowerCase();
  return keys[hotkey] ?? keys[normalized] ?? keys[hotkey.toUpperCase()];
}

/**
 * Global keyboard hook that fires on the configured hotkey regardless of window focus.
 * Falls back to Escape when the configured key name is unknown.
 */
export function startKillSwitch(hotkey: string, onTrigger: () => void): KillSwitchHandle {
  const keycode = resolveKeycode(hotkey) ?? UiohookKey.Escape;
  const listener = (event: { keycode: number }) => {
    if (event.keycode === keycode) onTrigger();
  };
  uIOhook.on('keydown', listener);
  uIOhook.start();
  return {
    stop() {
      uIOhook.removeListener('keydown', listener);
      uIOhook.stop();
    },
  };
}
