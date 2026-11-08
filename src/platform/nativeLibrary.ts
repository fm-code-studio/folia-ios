// src/platform/nativeLibrary.ts
// The local music library on a platform that has no File System Access API.
//
// The web build picks a folder with `showDirectoryPicker()` and works on the
// `FileSystemDirectoryHandle` it gets back. The iOS web view has neither the picker
// nor the handle type, so this file provides the two things the rest of the library
// code needs:
//
//   - A directory handle that behaves like a `FileSystemDirectoryHandle` - it lists
//     its children, hands out file handles, and names itself - so the traversal in
//     localMusicService.ts runs unchanged.
//   - A way to reach the bytes. The file handle answers `getFile()` by reading over
//     `folia-local://`, the native scheme that serves the folder out of the app's
//     own storage, so a song never has to cross the plugin bridge as base64.
//
// Between runs the library is stored as a small reference - a library id and a name -
// rather than as a handle, because a handle is not something the browser's storage
// can keep.

import { FoliaNative, type NativeFileEntry } from 'folia-native';

import { isNativeRuntime } from './index';

/** The scheme the native side serves the picked folders over. */
export const FOLIA_LOCAL_SCHEME = 'folia-local';

/** How a picked library is remembered between runs. */
export interface NativeLibraryRef {
    /** Marks the shape, so a stored reference is told apart from a stored handle. */
    readonly foliaNativeLibrary: true;
    /** The id the native side filed the folder under. */
    readonly libraryId: string;
    /** The folder's own name, which is the key the library is filed under. */
    readonly rootName: string;
}

/** Whether a stored value is a native library reference. */
export const isNativeLibraryRef = (value: unknown): value is NativeLibraryRef => {
    if (!value || typeof value !== 'object') return false;
    const candidate = value as Partial<NativeLibraryRef>;
    return candidate.foliaNativeLibrary === true
        && typeof candidate.libraryId === 'string'
        && typeof candidate.rootName === 'string';
};

/** The address of one file of a library, over the native scheme. */
export const foliaLocalUrl = (libraryId: string, path: string): string => {
    const encodedPath = path
        .split('/')
        .filter((segment) => segment.length > 0)
        .map((segment) => encodeURIComponent(segment))
        .join('/');
    return `${FOLIA_LOCAL_SCHEME}://${encodeURIComponent(libraryId)}/${encodedPath}`;
};

/**
 * A file inside a picked library.
 *
 * `getFile()` reads the bytes over `folia-local://` rather than asking the plugin
 * for them: the web view's own resource loader is far better at moving a few tens of
 * megabytes than the plugin bridge, and it is the same path the audio element plays
 * from.
 */
export class NativeFileHandle {
    readonly kind = 'file';

    constructor(
        readonly name: string,
        private readonly libraryId: string,
        private readonly relativePath: string,
    ) {}

    /** The address the file's bytes are served at. */
    get foliaLocalUrl(): string {
        return foliaLocalUrl(this.libraryId, this.relativePath);
    }

    async getFile(): Promise<File> {
        const response = await fetch(this.foliaLocalUrl);
        if (!response.ok) {
            throw new Error(`Could not read "${this.name}": ${response.status}`);
        }
        const blob = await response.blob();
        return new File([blob], this.name);
    }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return other === (this as unknown as FileSystemHandle);
    }
}

/**
 * A directory inside a picked library.
 *
 * It holds the whole listing of the library and hands out the part of it that
 * belongs to one directory, which is what the traversal walks over.
 */
export class NativeDirectoryHandle {
    readonly kind = 'directory';

    constructor(
        readonly name: string,
        readonly libraryId: string,
        private readonly relativePath: string,
        private readonly allEntries: readonly NativeFileEntry[],
    ) {}

    /** How this directory is remembered between runs. */
    toRef(): NativeLibraryRef {
        return {
            foliaNativeLibrary: true,
            libraryId: this.libraryId,
            rootName: this.name,
        };
    }

    /** The direct children of this directory. */
    private children(): NativeFileEntry[] {
        const prefix = this.relativePath ? `${this.relativePath}/` : '';
        return this.allEntries.filter((entry) => {
            const parent = entry.path.includes('/')
                ? entry.path.slice(0, entry.path.lastIndexOf('/'))
                : '';
            return parent === this.relativePath && entry.path.startsWith(prefix);
        });
    }

    async *values(): AsyncIterableIterator<FileSystemHandle> {
        for (const entry of this.children()) {
            yield entry.isDirectory
                ? this.handleForDirectory(entry)
                : this.handleForFile(entry);
        }
    }

    async *entries(): AsyncIterableIterator<[string, FileSystemHandle]> {
        for await (const handle of this.values()) {
            yield [handle.name, handle];
        }
    }

    async *keys(): AsyncIterableIterator<string> {
        for (const entry of this.children()) {
            yield entry.name;
        }
    }

    async getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeDirectoryHandle> {
        const entry = this.children().find((candidate) => candidate.name === name && candidate.isDirectory);
        if (!entry) {
            if (options?.create) {
                throw new Error('The native library cannot create folders.');
            }
            throw new DOMException(`No folder named "${name}".`, 'NotFoundError');
        }
        return this.handleForDirectory(entry);
    }

    async getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle> {
        const entry = this.children().find((candidate) => candidate.name === name && !candidate.isDirectory);
        if (!entry) {
            if (options?.create) {
                throw new Error('The native library cannot create files.');
            }
            throw new DOMException(`No file named "${name}".`, 'NotFoundError');
        }
        return this.handleForFile(entry);
    }

    private handleForDirectory(entry: NativeFileEntry): NativeDirectoryHandle {
        const path = this.relativePath ? `${this.relativePath}/${entry.name}` : entry.name;
        return new NativeDirectoryHandle(entry.name, this.libraryId, path, this.allEntries);
    }

    private handleForFile(entry: NativeFileEntry): NativeFileHandle {
        const path = this.relativePath ? `${this.relativePath}/${entry.name}` : entry.name;
        return new NativeFileHandle(entry.name, this.libraryId, path);
    }

    // The native side has already given the web build the folder's contents, so
    // there is no permission left to ask for.
    async queryPermission(): Promise<PermissionState> {
        return 'granted';
    }

    async requestPermission(): Promise<PermissionState> {
        return 'granted';
    }

    async isSameEntry(other: FileSystemHandle): Promise<boolean> {
        return other === (this as unknown as FileSystemHandle);
    }
}

/** Asks the user for a folder and brings it into the app's own storage. */
export const pickNativeDirectory = async (): Promise<{
    handle: NativeDirectoryHandle;
    ref: NativeLibraryRef;
} | null> => {
    if (!isNativeRuntime()) return null;

    const picked = await FoliaNative.pickDirectory();
    if (!picked) return null;

    const ref: NativeLibraryRef = {
        foliaNativeLibrary: true,
        libraryId: picked.libraryId,
        rootName: picked.rootName,
    };

    const handle = new NativeDirectoryHandle(
        picked.rootName,
        picked.libraryId,
        '',
        picked.entries ?? [],
    );

    return { handle, ref };
};

/** Rebuilds the handle of a library that was picked in an earlier run. */
export const rebuildNativeDirectoryHandle = async (
    ref: NativeLibraryRef,
): Promise<NativeDirectoryHandle | null> => {
    if (!isNativeRuntime()) return null;

    try {
        const entries = await FoliaNative.listDirectory({
            libraryId: ref.libraryId,
            path: '',
        });
        return new NativeDirectoryHandle(ref.rootName, ref.libraryId, '', entries ?? []);
    } catch {
        return null;
    }
};
