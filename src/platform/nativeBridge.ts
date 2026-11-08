// src/platform/nativeBridge.ts
// What the app calls when Folia's own native plugin is not part of the build.
//
// This build is assembled from Capacitor and its official plugins only: there is no
// FoliaNative pod, so nothing serves `folia-local://`, nothing fills the lock screen
// and nothing injects the backend addresses. The calls below keep the shape the
// callers already use and report that the feature is not here, so a build without the
// plugin degrades to "this build does not have it" instead of crashing.

/** One entry of a local library, as the native side used to report it. */
export interface NativeFileEntry {
    /** Path relative to the picked folder's root, using `/` separators. */
    path: string;
    /** Last path component. */
    name: string;
    /** Size in bytes; 0 for a directory. */
    size: number;
    /** Whether this entry is a directory. */
    isDirectory: boolean;
    /** Modification time, in milliseconds since the epoch. */
    modifiedAt: number;
}

/**
 * What picking a folder used to resolve with.
 *
 * Kept as a type so the callers keep their shape: a build without the plugin
 * resolves null, which reads as "the user picked nothing".
 */
export interface NativePickResult {
    /** The id the native side filed the folder under. */
    libraryId: string;
    /** The folder's own name. */
    rootName: string;
    /** Every entry below the folder, recursively. */
    entries: NativeFileEntry[];
}

/**
 * Whether Folia's native plugin is part of this build.
 *
 * The features behind it - the local library, the lock screen, the immersive chrome,
 * the runtime config - are switched off where this is false, so the interface does not
 * offer something the build cannot do.
 */
export const nativeBridgeAvailable = false;

/** The handle a listener registration returns. */
const noopListener = { remove: (): void => {} };

/** What the lock screen used to be told. */
interface NowPlayingOptions {
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    position?: number;
    rate?: number;
    isPlaying?: boolean;
    artwork?: string;
}

/** The bridge, with every feature reporting that this build does not carry it. */
export const FoliaNative = {
    /** Returns null: the build has no document picker to open. */
    async pickDirectory(
        _options?: { prompt?: string; copy?: boolean },
    ): Promise<NativePickResult | null> {
        return null;
    },

    /** Returns an empty listing so a stored library reads as empty rather than broken. */
    async listDirectory(
        _options: { libraryId: string; path: string },
    ): Promise<{ entries: NativeFileEntry[] }> {
        return { entries: [] };
    },

    /** The bytes are read over `folia-local://`, which this build does not serve. */
    async readFile(_options: { libraryId: string; path: string }): Promise<never> {
        throw new Error('The native plugin is not part of this build.');
    },

    async removeLibrary(_options: { libraryId: string }): Promise<void> {},

    async setImmersive(_options: { enabled: boolean }): Promise<void> {},

    async updateNowPlaying(_options: NowPlayingOptions): Promise<void> {},

    async configureAudioSession(): Promise<void> {},

    async getRuntimeConfig(): Promise<Record<string, string>> {
        return {};
    },

    async addListener(
        _event: string,
        _listener: (payload: unknown) => void,
    ): Promise<typeof noopListener> {
        return noopListener;
    },
};
