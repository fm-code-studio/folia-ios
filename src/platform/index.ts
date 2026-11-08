// src/platform/index.ts
// The three shapes Folia runs in: the Electron desktop app, a Capacitor native shell
// (iOS / Android), and a plain web page.
//
// Deciding which one used to be a single question - is `window.electron` there - and
// the answer was spread over ~40 call sites, each sniffing on its own. That still works
// inside Capacitor: a native shell has no Electron bridge, so every desktop branch
// falls through to its web fallback on its own.
//
// Two things it cannot answer, both of which only the native shell has to care about:
//
//   - The iOS build needs to know it is in a native shell, so it can swap the browser
//     APIs it does not have (the lyric relay, the local-library folder picker) for the
//     native plugins that do the same job.
//   - An iOS user agent contains "iPhone"/"iPad", so the Mac sniff in
//     src/utils/platform.ts answers "mac" for a phone. That one is fixed there.
//
// So this is the one place that answers "which runtime am I in", and everything else
// asks it instead of sniffing again.

export type FoliaRuntime = 'electron' | 'native' | 'web';

/** The Electron bridge, if this renderer has one. */
export const getElectronBridge = (): (Window['electron'] & object) | null => {
    if (typeof window === 'undefined') return null;
    const bridge = (window as Window & { electron?: Window['electron'] }).electron;
    return bridge && typeof bridge === 'object' ? bridge : null;
};

/**
 * Capacitor injects `window.Capacitor` into the web view before the page loads, and
 * leaves it undefined in a plain browser. Reading it directly keeps the web build free
 * of the Capacitor runtime - no import, no bundle weight, no plugin registration.
 */
export const getCapacitorBridge = (): (Window['Capacitor'] & object) | null => {
    if (typeof window === 'undefined') return null;
    const bridge = (window as Window & { Capacitor?: Window['Capacitor'] }).Capacitor;
    return bridge && typeof bridge === 'object' ? bridge : null;
};

/** True in the Electron desktop app. */
export const isElectronRuntime = (): boolean => getElectronBridge() !== null;

/** True inside a Capacitor native shell (iOS / Android). */
export const isNativeRuntime = (): boolean => {
    const bridge = getCapacitorBridge();
    if (!bridge) return false;
    const isNative = (bridge as { isNativePlatform?: () => boolean }).isNativePlatform;
    if (typeof isNative === 'function') {
        try {
            return isNative.call(bridge);
        } catch {
            return false;
        }
    }
    // Older cores without isNativePlatform: the platform string is the fallback.
    const platform = (bridge as { getPlatform?: () => string }).getPlatform;
    if (typeof platform === 'function') {
        try {
            const name = String(platform.call(bridge) ?? '').toLowerCase();
            return name === 'ios' || name === 'android';
        } catch {
            return false;
        }
    }
    return false;
};

/** True in a plain browser tab, with neither shell around it. */
export const isWebRuntime = (): boolean => !isElectronRuntime() && !isNativeRuntime();

/** Which of the three runtimes this is. */
export const getRuntime = (): FoliaRuntime => {
    if (isElectronRuntime()) return 'electron';
    if (isNativeRuntime()) return 'native';
    return 'web';
};

/** The native platform name ('ios' / 'android'), or null off the native shell. */
export const getNativePlatform = (): 'ios' | 'android' | null => {
    const bridge = getCapacitorBridge();
    if (!bridge) return null;
    const platform = (bridge as { getPlatform?: () => string }).getPlatform;
    if (typeof platform !== 'function') return null;
    try {
        const name = String(platform.call(bridge) ?? '').toLowerCase();
        return name === 'ios' || name === 'android' ? name : null;
    } catch {
        return null;
    }
};

/**
 * True on a phone or tablet screen. Used to pick the phone layout and to keep the
 * desktop-only affordances (title bar drag zones, window controls) out of the way.
 */
export const isMobileViewport = (): boolean => {
    if (typeof window === 'undefined') return false;
    const nativePlatform = getNativePlatform();
    if (nativePlatform === 'ios') return true;
    if (nativePlatform === 'android') return true;
    const coarse = window.matchMedia?.('(pointer: coarse)')?.matches;
    return Boolean(coarse);
};
