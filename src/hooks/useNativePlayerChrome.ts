// src/hooks/useNativePlayerChrome.ts
// What the native shell needs from the player, and what it gives back.
//
// The web build has no use for any of this: the browser's own media session puts the
// track on the lock screen, the page keeps playing as long as the tab is open, and
// there is no status bar to hide. The native shell has none of those:
//
//   - The lock screen is the system's, and the system wants metadata and transport
//     commands of its own.
//   - Playback has to survive the app leaving the screen, which needs an audio
//     session configured for playback.
//   - The status bar and the home indicator are in the way of the lyrics stage.
//
// The transport commands are the ones the app already has: the same refs the media
// session, the taskbar buttons and the remote control window drive.

import { useEffect, useRef } from 'react';

import { isNativeRuntime } from '../platform';
import { FoliaNative, nativeBridgeAvailable } from '../platform/nativeBridge';
import { useAppViewStore } from '../stores/useAppViewStore';
import { selectDisplayPlayerState, usePlaybackStore } from '../stores/usePlaybackStore';
import { PlayerState } from '../types';

/** The transport handles, as useTransportCommandRefs builds them. */
export interface NativeTransportCommandRefs {
    mediaSessionPlayRef: React.RefObject<() => Promise<void>>;
    mediaSessionPauseRef: React.RefObject<() => void>;
    mediaSessionPrevRef: React.RefObject<() => void>;
    mediaSessionNextRef: React.RefObject<() => Promise<void> | void>;
}

/** How often the lock screen's position is refreshed. */
const NOW_PLAYING_TICK_MS = 1000;

/**
 * Keeps the native shell in step with the player.
 *
 * Nothing here runs on the web or the desktop: the native shell is the only one that
 * has a lock screen, a status bar and a home indicator.
 */
export const useNativePlayerChrome = (refs: NativeTransportCommandRefs): void => {
    const view = useAppViewStore(state => state.view);
    const currentSong = usePlaybackStore(state => state.currentSong);
    const duration = usePlaybackStore(state => state.duration);
    const displayPlayerState = usePlaybackStore(selectDisplayPlayerState);

    // The audio session is set up once: the music is played by the web view, and all
    // it needs is a session that keeps going when the screen locks.
    useEffect(() => {
        if (!isNativeRuntime() || !nativeBridgeAvailable) return;
        void FoliaNative.configureAudioSession().catch((error) => {
            console.warn('[Native] Could not configure the audio session:', error);
        });
    }, []);

    // The lyrics stage is the immersive one: there the status bar and the home
    // indicator are in the way of the lyrics.
    useEffect(() => {
        if (!isNativeRuntime() || !nativeBridgeAvailable) return;
        void FoliaNative.setImmersive({ enabled: view === 'player' }).catch((error) => {
            console.warn('[Native] Could not change the window chrome:', error);
        });
    }, [view]);

    // The lock screen's transport buttons come back as commands.
    useEffect(() => {
        if (!isNativeRuntime() || !nativeBridgeAvailable) return;

        const handle = FoliaNative.addListener('remoteCommand', (event) => {
            const command = String((event as { command?: unknown })?.command ?? '');
            const play = refs.mediaSessionPlayRef.current;
            const pause = refs.mediaSessionPauseRef.current;
            const prev = refs.mediaSessionPrevRef.current;
            const next = refs.mediaSessionNextRef.current;

            if (command === 'play') {
                void play();
                return;
            }
            if (command === 'pause') {
                pause();
                return;
            }
            if (command === 'toggle') {
                if (usePlaybackStore.getState().playerState === PlayerState.PLAYING) {
                    pause();
                } else {
                    void play();
                }
                return;
            }
            if (command === 'previous') {
                prev();
                return;
            }
            if (command === 'next') {
                void next();
                return;
            }
            if (command.startsWith('seek:')) {
                const seconds = Number(command.slice('seek:'.length));
                if (!Number.isFinite(seconds)) return;
                const audio = document.querySelector('audio[data-playback-deck]') as HTMLAudioElement | null;
                if (audio) audio.currentTime = seconds;
            }
        });

        return () => {
            void handle.then((listener) => listener.remove());
        };
    }, [refs]);

    // The lock screen's own metadata. The position moves on its own, so the entry is
    // refreshed once a second while a track is playing.
    const lastReportedSongRef = useRef<string | null>(null);
    const hasTrack = Boolean(currentSong);

    useEffect(() => {
        if (!isNativeRuntime() || !nativeBridgeAvailable) return;

        const report = async (position: number) => {
            if (!currentSong) {
                if (lastReportedSongRef.current !== null) {
                    lastReportedSongRef.current = null;
                    await FoliaNative.updateNowPlaying({ isPlaying: false }).catch(() => {});
                }
                return;
            }

            const isPlaying = displayPlayerState === PlayerState.PLAYING;
            await FoliaNative.updateNowPlaying({
                title: currentSong.name,
                artist: currentSong.artists?.map((artist) => artist.name).join(', '),
                album: currentSong.album?.name,
                duration: duration > 0 ? duration : undefined,
                position,
                isPlaying,
            }).catch(() => {});
        };

        // The song changed: send the new one right away.
        const songKey = currentSong?.id !== undefined && currentSong?.id !== null
            ? String(currentSong.id)
            : null;
        if (songKey !== lastReportedSongRef.current) {
            lastReportedSongRef.current = songKey;
            void report(0);
        }

        if (!hasTrack) return;

        const timer = window.setInterval(() => {
            const audio = document.querySelector('audio[data-playback-deck]') as HTMLAudioElement | null;
            void report(audio?.currentTime ?? 0);
        }, NOW_PLAYING_TICK_MS);

        return () => window.clearInterval(timer);
    }, [currentSong, duration, displayPlayerState, hasTrack]);
};
