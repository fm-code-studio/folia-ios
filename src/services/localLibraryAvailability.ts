// src/services/localLibraryAvailability.ts
// Centralizes the secure-context requirement for browser local-library access.

import { isNativeRuntime } from '../platform';
import { nativeBridgeAvailable } from '../platform/nativeBridge';

export interface LocalLibraryAvailability {
    supported: boolean;
    reason: 'insecure-http' | 'file-system-api-unavailable' | null;
}

export const getLocalLibraryAvailability = (): LocalLibraryAvailability => {
    if (typeof window === 'undefined') return { supported: false, reason: 'file-system-api-unavailable' };
    if (window.electron) return { supported: true, reason: null };
    // The native shell picks the folder with the iOS document picker and serves it
    // over its own scheme, so it needs neither a secure context nor the File System
    // Access API - but only when the build carries Folia's own plugin. A build made
    // from the official plugins alone has no picker, so the feature is reported as
    // unavailable instead of failing when it is used.
    if (isNativeRuntime()) {
        return nativeBridgeAvailable
            ? { supported: true, reason: null }
            : { supported: false, reason: 'file-system-api-unavailable' };
    }
    const currentLocation = window.location;
    if (!currentLocation) return { supported: false, reason: 'file-system-api-unavailable' };
    const isLocalhost = ['localhost', '127.0.0.1', '[::1]'].includes(currentLocation.hostname);
    if (!(currentLocation.protocol === 'https:' || isLocalhost) || !window.isSecureContext) {
        return { supported: false, reason: 'insecure-http' };
    }
    if (!('showDirectoryPicker' in window) || typeof navigator.storage?.getDirectory !== 'function') {
        return { supported: false, reason: 'file-system-api-unavailable' };
    }
    return { supported: true, reason: null };
};
