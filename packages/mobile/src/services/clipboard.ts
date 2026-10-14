import Clipboard from '@react-native-clipboard/clipboard';

/** Auto-clear timeout per decision #4, configurable isn't required by spec (only idle-timeout #6 is). */
export const CLIPBOARD_AUTO_CLEAR_MS = 30 * 1000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Copies `value` to the clipboard and schedules clearing it after
 * CLIPBOARD_AUTO_CLEAR_MS, per decision #4. Only clears if the
 * clipboard still holds exactly what we copied -- avoids wiping
 * something the user copied from elsewhere in the meantime.
 */
export function copyWithAutoClear(value: string): void {
  if (clearTimer) {
    clearTimeout(clearTimer);
  }
  Clipboard.setString(value);
  clearTimer = setTimeout(() => {
    Clipboard.getString().then((current: string) => {
      if (current === value) {
        Clipboard.setString('');
      }
    });
    clearTimer = null;
  }, CLIPBOARD_AUTO_CLEAR_MS);
}
