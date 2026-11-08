import Foundation
import MediaPlayer
import UIKit

/// The lock screen and the control centre's now playing entry.
///
/// The music itself is played by the web view, so the native side owns no player:
/// it shows what the web build reports and sends the user's taps back the other way.
final class FoliaNowPlayingCenter {
    static let shared = FoliaNowPlayingCenter()

    /// Called when the user taps a transport control on the lock screen.
    var onRemoteCommand: ((String) -> Void)?

    private var artworkCache: [String: MPMediaItemArtwork] = [:]

    private init() {}

    /// Sets up the transport controls. Safe to call more than once.
    func installRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()

        center.playCommand.addTarget { [weak self] _ in
            self?.onRemoteCommand?("play")
            return .success
        }
        center.pauseCommand.addTarget { [weak self] _ in
            self?.onRemoteCommand?("pause")
            return .success
        }
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            self?.onRemoteCommand?("toggle")
            return .success
        }
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.onRemoteCommand?("next")
            return .success
        }
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.onRemoteCommand?("previous")
            return .success
        }
        center.changePlaybackPositionCommand.addTarget { [weak self] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.onRemoteCommand?("seek:\(event.positionTime)")
            return .success
        }
    }

    /// What the lock screen shows.
    func update(
        title: String?,
        artist: String?,
        album: String?,
        duration: Double,
        position: Double,
        rate: Double,
        isPlaying: Bool,
        artworkBase64: String?
    ) {
        var info: [String: Any] = [:]

        if let title, !title.isEmpty { info[MPMediaItemPropertyTitle] = title }
        if let artist, !artist.isEmpty { info[MPMediaItemPropertyArtist] = artist }
        if let album, !album.isEmpty { info[MPMediaItemPropertyAlbumTitle] = album }
        if duration > 0 { info[MPMediaItemPropertyPlaybackDuration] = duration }

        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        info[MPNowPlayingInfoPropertyPlaybackRate] = isPlaying ? rate : 0.0
        info[MPNowPlayingInfoPropertyDefaultPlaybackRate] = rate > 0 ? rate : 1.0
        info[MPNowPlayingInfoPropertyMediaType] = MPNowPlayingInfoMediaType.audio.rawValue

        if let artworkBase64, let artwork = artwork(for: artworkBase64) {
            info[MPMediaItemPropertyArtwork] = artwork
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        MPNowPlayingInfoCenter.default().playbackState = isPlaying ? .playing : .paused
    }

    /// Turns the artwork bytes the web build sent into an artwork item.
    private func artwork(for base64: String) -> MPMediaItemArtwork? {
        if let cached = artworkCache[base64] { return cached }

        guard let data = Data(base64Encoded: base64), let image = UIImage(data: data) else { return nil }
        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        artworkCache[base64] = artwork
        return artwork
    }
}
