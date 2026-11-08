import { WebPlugin } from '@capacitor/core';

import type {
    FoliaNativePlugin,
    ListDirectoryOptions,
    ListDirectoryResult,
    NativeRuntimeConfig,
    NowPlayingOptions,
    PickDirectoryOptions,
    PickDirectoryResult,
    ReadFileOptions,
    ReadFileResult,
    SetImmersiveOptions,
} from './definitions';

/**
 * The web build's stand-in for the native plugin.
 *
 * Every method here refuses, because on the web the equivalents are already there:
 * the relay is a server route, the local library is the File System Access API, and
 * the cover cache is OPFS. The native plugin exists only to cover the gaps the web
 * view leaves open, so a web build has nothing to call.
 */
export class FoliaNativeWeb extends WebPlugin implements FoliaNativePlugin {
    async pickDirectory(_options?: PickDirectoryOptions): Promise<PickDirectoryResult | null> {
        throw this.notAvailable('pickDirectory');
    }

    async readFile(_options: ReadFileOptions): Promise<ReadFileResult> {
        throw this.notAvailable('readFile');
    }

    async listDirectory(_options: ListDirectoryOptions): Promise<ListDirectoryResult> {
        throw this.notAvailable('listDirectory');
    }

    async removeLibrary(_options: { libraryId: string }): Promise<void> {
        throw this.notAvailable('removeLibrary');
    }

    async setImmersive(_options: SetImmersiveOptions): Promise<void> {
        throw this.notAvailable('setImmersive');
    }

    async updateNowPlaying(_options: NowPlayingOptions): Promise<void> {
        throw this.notAvailable('updateNowPlaying');
    }

    async configureAudioSession(): Promise<void> {
        throw this.notAvailable('configureAudioSession');
    }

    async getRuntimeConfig(): Promise<NativeRuntimeConfig> {
        return {};
    }

    private notAvailable(method: string): Error {
        return new Error(`FoliaNative.${method} is only available in the native app.`);
    }
}
