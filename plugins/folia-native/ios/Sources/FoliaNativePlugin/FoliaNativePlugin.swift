import Capacitor
import Foundation
import UIKit
import UniformTypeIdentifiers
import AVFoundation

/// Folia's native side.
///
/// The plugin answers for the three things the iOS web view cannot do on its own -
/// the local music library, the immersive chrome and the audio session - and keeps
/// the backend addresses the web build should talk to.
@objc(FoliaNativePlugin)
public class FoliaNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "FoliaNativePlugin"
    public let jsName = "FoliaNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "pickDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readFile", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "listDirectory", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "removeLibrary", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setImmersive", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateNowPlaying", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "configureAudioSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getRuntimeConfig", returnType: CAPPluginReturnPromise),
    ]

    /// The call waiting for the document picker to come back.
    private var pendingPickerCall: CAPPluginCall?

    public override func load() {
        FoliaNowPlayingCenter.shared.installRemoteCommands()
        FoliaNowPlayingCenter.shared.onRemoteCommand = { [weak self] command in
            self?.notifyListeners("remoteCommand", data: ["command": command])
        }
    }

    // MARK: - The local music library

    /// Asks the user for a folder and copies it into the app's own storage.
    @objc func pickDirectory(_ call: CAPPluginCall) {
        guard pendingPickerCall == nil else {
            call.reject("A folder is already being picked.")
            return
        }

        DispatchQueue.main.async {
            guard let presenter = self.bridge?.viewController else {
                call.reject("No view controller to present the picker from.")
                return
            }

            let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.folder], asCopy: true)
            picker.allowsMultipleSelection = false
            picker.delegate = self
            self.pendingPickerCall = call
            presenter.present(picker, animated: true)
        }
    }

    /// Reads one file of a picked folder.
    @objc func readFile(_ call: CAPPluginCall) {
        guard let libraryId = call.getString("libraryId"),
              let path = call.getString("path") else {
            call.reject("readFile needs a libraryId and a path.")
            return
        }

        let fileURL = FoliaLibraryStore.shared.fileURL(libraryId: libraryId, relativePath: path)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            call.reject("No such file in the library.")
            return
        }

        do {
            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            call.resolve([
                "base64": data.base64EncodedString(),
                "size": data.count,
            ])
        } catch {
            call.reject("Could not read the file: \(error.localizedDescription)")
        }
    }

    /// Lists one directory of a picked folder.
    @objc func listDirectory(_ call: CAPPluginCall) {
        guard let libraryId = call.getString("libraryId") else {
            call.reject("listDirectory needs a libraryId.")
            return
        }

        let relativePath = call.getString("path") ?? ""
        let entries = FoliaLibraryStore.shared.entries(libraryId: libraryId, relativePath: relativePath)
        call.resolve(entries.map { entry in
            [
                "path": entry.path,
                "name": entry.name,
                "size": entry.size,
                "isDirectory": entry.isDirectory,
                "modifiedAt": entry.modifiedAt,
            ]
        })
    }

    /// Removes a picked folder and everything copied out of it.
    @objc func removeLibrary(_ call: CAPPluginCall) {
        guard let libraryId = call.getString("libraryId") else {
            call.reject("removeLibrary needs a libraryId.")
            return
        }

        FoliaLibraryStore.shared.remove(libraryId: libraryId)
        call.resolve()
    }

    // MARK: - The window chrome

    /// Hides or shows the status bar and the home indicator.
    @objc func setImmersive(_ call: CAPPluginCall) {
        let enabled = call.getBool("enabled") ?? false
        FoliaWindowChrome.shared.setImmersive(enabled)
        call.resolve()
    }

    // MARK: - The lock screen

    /// Puts the current track on the lock screen.
    @objc func updateNowPlaying(_ call: CAPPluginCall) {
        FoliaNowPlayingCenter.shared.update(
            title: call.getString("title"),
            artist: call.getString("artist"),
            album: call.getString("album"),
            duration: call.getDouble("duration") ?? 0,
            position: call.getDouble("position") ?? 0,
            rate: call.getDouble("rate") ?? 1,
            isPlaying: call.getBool("isPlaying") ?? false,
            artworkBase64: call.getString("artwork")
        )
        call.resolve()
    }

    // MARK: - The audio session

    /// Configures the audio session so playback survives the app leaving the screen.
    ///
    /// The music is played by the web view, so this is all that is needed for it to
    /// keep playing with the screen locked: the session has to be a playback one, and
    /// the app has to declare the background audio mode.
    @objc func configureAudioSession(_ call: CAPPluginCall) {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playback, mode: .default, options: [])
            try session.setActive(true)
            call.resolve()
        } catch {
            call.reject("Could not configure the audio session: \(error.localizedDescription)")
        }
    }

    // MARK: - The backend addresses

    /// The addresses this build should talk to.
    @objc func getRuntimeConfig(_ call: CAPPluginCall) {
        call.resolve(FoliaRuntimeConfigStore.shared.configuration())
    }
}

// MARK: - The document picker

extension FoliaNativePlugin: UIDocumentPickerDelegate {
    public func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let call = pendingPickerCall else { return }
        pendingPickerCall = nil

        guard let picked = urls.first else {
            call.resolve(nil)
            return
        }

        // The picker hands the folder over in a temporary location that is only
        // readable while the app is running; it is copied into the app's own storage
        // so the library survives the app being closed.
        let needsAccess = picked.startAccessingSecurityScopedResource()
        defer {
            if needsAccess { picked.stopAccessingSecurityScopedResource() }
        }

        do {
            let libraryId = try FoliaLibraryStore.shared.adopt(folderURL: picked, name: picked.lastPathComponent)
            let entries = FoliaLibraryStore.shared.entries(libraryId: libraryId)
            call.resolve([
                "libraryId": libraryId,
                "rootName": picked.lastPathComponent,
                "entries": entries.map { entry in
                    [
                        "path": entry.path,
                        "name": entry.name,
                        "size": entry.size,
                        "isDirectory": entry.isDirectory,
                        "modifiedAt": entry.modifiedAt,
                    ]
                },
            ])
        } catch {
            call.reject("Could not import the folder: \(error.localizedDescription)")
        }
    }

    public func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        guard let call = pendingPickerCall else { return }
        pendingPickerCall = nil
        call.resolve(nil)
    }
}
