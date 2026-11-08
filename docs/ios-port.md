# Folia on iOS

This is how Folia runs on iOS, and what had to change to get it there.

The short version: **the web build is the app**. The eight lyrics animations, the
lyric engine, the local music library, the AI theme generator and the mod-less
everything else are the same React bundle the web and desktop builds run. What iOS
adds is a native shell around it, plus the four things the iOS web view cannot do
on its own.

---

## 1. What runs where

| Piece | Where it lives | Why |
|---|---|---|
| The player | `src/`, unchanged | The desktop app and the web build already share it. |
| The native bridge | `plugins/folia-native/` | The iOS-only half: the library, the chrome, the lock screen, the audio session. |
| The shell | `ios/` | Capacitor's Xcode project. |
| The platform question | `src/platform/index.ts` | One place that answers "which runtime am I in". |

The renderer decides what it is by looking for `window.electron`, in about forty
places. Inside Capacitor that is still `undefined`, so every desktop branch falls
through to its web fallback on its own - the web build's code paths are the ones that
run. What those branches cannot cover is the list below.

---

## 2. The four gaps

### 2.1 The lyric relay has no server

QQ and KuGou lyrics and covers live on hosts a web page may not fetch itself. The
web build reaches them through `/api/lyric-proxy`, a route its own deployment serves;
the desktop app reaches them through its main process.

An iOS app has neither. `src/services/lyricProxy.ts` grew a third route: the request
goes out through Capacitor's native HTTP bridge, which is not the web view and so is
not bound by its cross-origin rules.

The allow-list of hosts is the same one the relay servers keep (`api-ts/lyric-proxy.ts`,
`worker/lyric-proxy.ts`), with the cover hosts added, and it is checked before the
request leaves.

`fetchThroughLyricProxy()` is the one entry point now. The five call sites -
`qqLyricProvider.ts`, `qqTransport.ts`, `kugouLyricProvider.ts`, `kugouTransport.ts`
and `coverCache.ts` - go through it, so no caller has to know which platform it is on.

### 2.2 The local music library has no folder picker

`showDirectoryPicker()` does not exist on iOS, and neither does the
`FileSystemDirectoryHandle` the library's traversal walks over.

`src/platform/nativeLibrary.ts` provides a directory handle that behaves like one: it
lists its children, hands out file handles, and names itself. The traversal in
`localMusicService.ts` runs unchanged over it.

The folder itself comes from the iOS document picker, and is copied into the app's
sandbox so it stays readable after the picker is gone. Between runs the library is
stored as a small reference - a library id and a name - because a handle is not
something the browser's storage can keep; the handle is rebuilt from the reference
the next time.

### 2.3 The bytes have to come from somewhere

A song is tens of megabytes. Handing it over as base64 across the plugin bridge
would cost a third more on the wire and copy it twice in memory - and the `<audio>`
element needs byte ranges to seek.

So the files are served over `folia-local://`, a scheme the native side answers with
an HTTP-shaped response, `Range` and all. The web view's own resource loader does the
reading, which is the path it is good at, and it is the same path the audio element
plays from.

### 2.4 The phone has furniture the desktop does not

- **The status bar and the home indicator.** Hidden while the lyrics stage is up.
  `ios/App/App/FoliaBridgeViewController.swift` reads the state the plugin keeps.
- **The safe area.** The bottom inset and the landscape side insets are given to the
  app shell, so the player bar is not under the home indicator. The top is left
  alone: the lyrics stage is meant to reach into it, the way Apple Music does.
- **The lock screen.** `MPNowPlayingInfoCenter` shows the track, and
  `MPRemoteCommandCenter` sends the transport buttons back to the app, where they
  drive the same transport refs the media session and the remote control window
  already drive.
- **Background playback.** The music is played by the web view, so all it needs is an
  `AVAudioSession` in the playback category and the `audio` background mode.

---

## 3. The runtime addresses

The web build reads its API addresses from Vite's build-time variables, and a bundle
that has been built cannot change them afterwards. An app that has been shipped
cannot either.

So the native shell keeps them in its own settings and hands them to the page before
it runs, as `window.__FOLIA_RUNTIME_CONFIG__`. The page's own `runtime-config.js`
keeps whatever is already there, so the two do not have to know about each other.

`src/services/runtimeConfig.ts` reads the runtime address first and the build
variable second. The three music sources (`netease.ts`, `qqTransport.ts`,
`kugouTransport.ts`) ask it rather than reading `import.meta.env` themselves.

The addresses live in `UserDefaults` under `top.izuna.foliamajor.ios.*`. They are
meant to be set by the app's own settings screen; the keys are listed in
`FoliaRuntimeConfigStore.swift`.

---

## 4. Workers

The lyric parser and the metadata parser run in workers, and a worker that never
answers leaves the promise it was given waiting forever - the lyrics would simply
never arrive, with no error anywhere.

The parsing itself now lives in `src/utils/localMetadataParser.ts`, and both the
worker and the client use it. When a worker cannot be built, the client parses on the
main thread instead. The lyric client does the same with `parserCore.ts`.

---

## 5. Building it

Requires a Mac with Xcode 15 or newer, and Node 24 (the repo's `.nvmrc`).

```bash
npm install
npm run build            # the web build; dist/ is what the app ships
npx cap sync ios        # copies dist/ into the Xcode project
cd ios/App && pod install
open App.xcworkspace
```

`cap sync ios` has to run before every build that changes the web code: it copies
`dist/` into `ios/App/public/`.

The project is a workspace, not a project: open `App.xcworkspace`, or the
`FoliaNative` pod will not be found.

Then, in Xcode: set your team on the `App` target, choose a signing identity, pick a
device, and run.

### Building without a Mac

`npx cap add ios` and `npx cap sync ios` both run on Linux and Windows; only the
Xcode build and `pod install` need a Mac.

---

## 6. Before it ships

A few things the app needs that the web build does not.

**The backend.** The music sources need a Folia backend: the one the project
deploys to Vercel or Cloudflare. Point the app at it in the settings, or set the
addresses in `UserDefaults` directly. The lyric relay does not need one - that part
is native.

**App Transport Security.** `Info.plist` turns `NSAllowsArbitraryLoads` on, because
the music APIs are reached over plain HTTP from several hosts whose addresses change.
A build that only talks to one backend can narrow it down:

```xml
<key>NSAppTransportSecurity</key>
<dict>
    <key>NSExceptionDomains</key>
    <dict>
        <key>your-backend.example.com</dict>
        <dict>
            <key>NSExceptionAllowsInsecureHTTPLoads</key>
            <true/>
        </dict>
    </dict>
</dict>
```

**The name.** `CFBundleDisplayName` is `Folia`; `CFBundleIdentifier` is
`top.izuna.foliamajor.ios`. Both are yours to change - the identifier has to be
unique on the store, and it is also the prefix the app's `UserDefaults` keys use.

**Export compliance.** `ITSAppUsesNonExemptEncryption` is `false`, which is correct
as long as the app keeps talking to plain HTTPS and does not add its own
encryption.

**The mod system.** Folium, the mod platform, is a desktop feature and is not
available in the app. The web build already refuses it.

---

## 7. What is still worth checking on a device

These are the parts that cannot be judged from a desktop browser:

- Whether the lyrics stage holds 60 fps on the device that matters most. The
  DOM-based animations (`Cad`, `Pat`, `Tilt`, `群唱`, `镜台`) are the safe ones;
  `Lumi` and `时计` lean on WebGL, and `Fume` redraws the whole screen every frame.
- Whether the web view's Media Session is complete enough on the iOS version in
  question - the native lock screen entry is there either way, but a duplicate can
  show up.
- Whether a large local library scans in a reasonable time. The scan reads every
  file to read its tags, over `folia-local://`.
