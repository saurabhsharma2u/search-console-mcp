import { describe, it, expect } from 'vitest';
import { canOpenBrowser } from '../src/google/client.js';

describe('canOpenBrowser', () => {
    it('macOS and Windows always have a UI', () => {
        expect(canOpenBrowser({}, 'darwin')).toBe(true);
        expect(canOpenBrowser({}, 'win32')).toBe(true);
    });

    it('Linux/BSD requires DISPLAY or WAYLAND_DISPLAY', () => {
        expect(canOpenBrowser({}, 'linux')).toBe(false);
        expect(canOpenBrowser({ DISPLAY: ':0' }, 'linux')).toBe(true);
        expect(canOpenBrowser({ WAYLAND_DISPLAY: 'wayland-0' }, 'linux')).toBe(true);
        // SSH session without a display is headless
        expect(canOpenBrowser({ SSH_CONNECTION: '1 2 3 4' }, 'linux')).toBe(false);
        expect(canOpenBrowser({ SSH_CONNECTION: '1 2 3 4', DISPLAY: ':0' }, 'linux')).toBe(true);
    });

    it('NO_BROWSER=1 forces headless mode on any platform', () => {
        expect(canOpenBrowser({ NO_BROWSER: '1' }, 'darwin')).toBe(false);
        expect(canOpenBrowser({ NO_BROWSER: 'true' }, 'win32')).toBe(false);
        expect(canOpenBrowser({ NO_BROWSER: '1', DISPLAY: ':0' }, 'linux')).toBe(false);
    });

    it('CI environments are treated as headless', () => {
        expect(canOpenBrowser({ CI: 'true' }, 'darwin')).toBe(false);
        expect(canOpenBrowser({ CI: '1' }, 'linux')).toBe(false);
    });
});
