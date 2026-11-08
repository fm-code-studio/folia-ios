/**
 * FoliaNative: the iOS side of Folia.
 *
 * The web build leans on three browser APIs the iOS web view does not have:
 *
 *   - `/api/lyric-proxy`, the relay for QQ / KuGou lyric and cover hosts a page may
 *     not fetch itself. On the native shell the same relay is answered by the
 *     `folia-proxy://` scheme handler instead of a server, so the web build's relay
 *     URLs keep working unchanged.
 *   - `showDirectoryPicker()`, for the local music library. On the native shell the
 *     folder comes from the iOS document picker and is copied into the app sandbox.
 *   - `navigator.storage.getDirectory()`, the OPFS cover cache. On the native shell
 *     the same cache lives in the sandbox and is reached over `folia-local://`.
 *
 * What is left in this interface is the stateful half: the immersive window chrome,
 * the lock screen metadata, and the audio session that keeps playback alive when the
 * app is not on screen.
 */

import type { Plugin } from '@capacitor/core';

/** One entry of a picked folder, as the native side saw it. */
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

/** The result of picking a folder: its name and everything inside it. */
export interface PickDirectoryResult {
    /** The folder's own name, used as the library root's key. */
    rootName: string;
    /** Every entry below the folder, recursively. */
    entries: NativeFileEntry[];
    /** The identifier the native side uses to address this folder later. */
    libraryId: string;
}

/** Options for picking a folder. */
export interface PickDirectoryOptions {
    /** Human-readable reason shown in the document picker's prompt. */
    prompt?: string;
    /** Copy the picked folder into the sandbox. Defaults to true. */
    copy?: boolean;
}

/** Options for reading one file out of the sandbox. */
export interface ReadFileOptions {
    /** The library identifier returned by {@link FoliaNativePlugin.pickDirectory}. */
    libraryId: string;
    /** The file's path relative to that library's root. */
    path: string;
}

/** The bytes of one file, base64 encoded. */
export interface ReadFileResult {
    /** Base64 of the file's contents. */
    base64: string;
    /** The file's size in bytes. */
    size: number;
}

/** Options for listing one directory in the sandbox. */
export interface ListDirectoryOptions {
    /** The library identifier returned by {@link FoliaNativePlugin.pickDirectory}. */
    libraryId: string;
    /** The directory's path relative to that library's root; `''` for the root. */
    path: string;
}

/** Options for the immersive window chrome. */
export interface SetImmersiveOptions {
    /** Hide the status bar and the home indicator. */
    enabled: boolean;
}

/** What the lock screen should show. */
export interface NowPlayingOptions {
    title?: string;
    artist?: string;
    album?: string;
    /** Track length in seconds. */
    duration?: number;
    /** Playback position in seconds. */
    position?: number;
    /** Playback rate; 1 is normal. */
    rate?: number;
    isPlaying?: boolean;
    /** Base64 artwork bytes. */
    artwork?: string;
}

/**
 * The runtime configuration the native shell hands to the web build.
 *
 * The web build reads its API addresses from Vite's build-time variables, which an
 * app bundle cannot change after it is built. The native side keeps them in its own
 * settings instead, and the web build asks for them at startup.
 */
export interface NativeRuntimeConfig {
    /** Base address of a Folia backend, e.g. `https://folia.example.com`. */
    apiBase?: string;
    /** Address of the Netease API, if it is not under {@link apiBase}. */
    neteaseApiBase?: string;
    /** Address of the KuGou API, if it is not under {@link apiBase}. */
    kugouApiBase?: string;
    /** Address of the QQ Music API, if it is not under {@link apiBase}. */
    qqApiBase?: string;
    /** Which AI provider the backend speaks: `gemini` or `openai`. */
    aiProvider?: 'gemini' | 'openai';
}

export interface FoliaNativePlugin extends Plugin {
    /**
     * Read a folder the user picked, recursively.
     *
     * Resolves with null when the user dismisses the picker.
     */
    pickDirectory(options?: PickDirectoryOptions): Promise<PickDirectoryResult | null>;

    /** Read one file out of a picked folder. */
    readFile(options: ReadFileOptions): Promise<ReadFileResult>;

    /** List one directory of a picked folder. */
    listDirectory(options: ListDirectoryOptions): Promise<NativeFileEntry[]>;

    /** Remove a picked folder and everything copied out of it. */
    removeLibrary(options: { libraryId: string }): Promise<void>;

    /** Hide or show the status bar and the home indicator. */
    setImmersive(options: SetImmersiveOptions): Promise<void>;

    /** Put the current track on the lock screen. */
    updateNowPlaying(options: NowPlayingOptions): Promise<void>;

    /** Configure the audio session so playback survives the app leaving the screen. */
    configureAudioSession(): Promise<void>;

    /** The backend addresses this app build should talk to. */
    getRuntimeConfig(): Promise<NativeRuntimeConfig>;
}
