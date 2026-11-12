import { useEffect, useRef } from 'react';
import { buildSilentWav } from '../components/hifi/useHifiMediaSessionKeepAlive';
import { isNativeRuntime } from '../platform';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { PlayerState } from '../types';

// src/hooks/useNativeBackgroundAudio.ts
// The silent element that keeps iOS playing once the app leaves the screen.
//
// Everything Folia plays goes through Web Audio: a deck's <audio> is routed into a
// MediaElementAudioSourceNode and the audible output is the AudioContext's. iOS suspends that
// context as soon as the app is no longer on screen, and the music stops - the declared audio
// background mode and the playback session are not enough on their own. A media element that is
// playing does keep the web content process alive, and with it the context, so while a song plays
// this runs a six-second loop of zero samples beside it. Nothing is audible: every sample is 0.
//
// It also fixes the other half of that problem - a suspension in the middle of the pause fade,
// which leaves the deck sounding after the button said paused.
//
// Nothing happens on the web or the desktop, and nothing happens while paused.

/** Marks the keep-alive element, so it is never mistaken for a playback deck. */
export const NATIVE_KEEP_ALIVE_ATTRIBUTE = 'data-native-background-keep-alive';

/** How often a stalled keep-alive is nudged back into play. */
const KEEP_ALIVE_RETRY_MS = 2000;

export const useNativeBackgroundAudio = (): void => {
    const playing = usePlaybackStore(state => state.playerState === PlayerState.PLAYING);
    const elementRef = useRef<HTMLAudioElement | null>(null);
    const urlRef = useRef<string | null>(null);
    const retryRef = useRef<number | null>(null);

    useEffect(() => {
        if (!isNativeRuntime()) return undefined;

        if (!elementRef.current) {
            const wav = buildSilentWav();
            const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
            const element = new Audio(url);
            element.loop = true;
            element.preload = 'auto';
            // The silent loop is a keep-alive, not a track: it must not appear in the media session.
            element.volume = 1;
            element.setAttribute(NATIVE_KEEP_ALIVE_ATTRIBUTE, '');
            elementRef.current = element;
            urlRef.current = url;
        }

        const element = elementRef.current;
        if (!element) return undefined;

        const stopRetry = () => {
            if (retryRef.current !== null) {
                window.clearInterval(retryRef.current);
                retryRef.current = null;
            }
        };

        if (!playing) {
            stopRetry();
            element.pause();
            return undefined;
        }

        const start = () => {
            void element.play().catch((error) => {
                // Autoplay policy refuses until the page has had a gesture; the user's next tap
                // starts the song, and this element follows it a moment later.
                console.warn('[Native] background keep-alive did not start', error);
            });
        };
        start();
        // iOS occasionally pauses the element on its own when the session is interrupted; a paused
        // keep-alive means the next suspension takes the music with it, so it is put back.
        retryRef.current = window.setInterval(() => {
            if (element.paused) start();
        }, KEEP_ALIVE_RETRY_MS);

        return stopRetry;
    }, [playing]);

    useEffect(() => () => {
        const element = elementRef.current;
        if (retryRef.current !== null) window.clearInterval(retryRef.current);
        retryRef.current = null;
        if (element) {
            element.pause();
            element.removeAttribute('src');
            element.load();
        }
        elementRef.current = null;
        if (urlRef.current) {
            URL.revokeObjectURL(urlRef.current);
            urlRef.current = null;
        }
    }, []);
};
