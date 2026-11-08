import Foundation
import UIKit
import WebKit

/// The window chrome the player asks for.
///
/// The lyrics stage is meant to run edge to edge: no status bar, no home indicator.
/// iOS asks the view controller for both, so the state lives here and the view
/// controller reads it.
final class FoliaWindowChrome {
    static let shared = FoliaWindowChrome()

    /// Whether the status bar and the home indicator are hidden.
    private(set) var immersive = false

    private let lock = NSLock()

    private init() {}

    func setImmersive(_ enabled: Bool) {
        lock.lock()
        immersive = enabled
        lock.unlock()

        DispatchQueue.main.async {
            // The view controller caches what it told the system last time, so it has
            // to be asked again.
            if let controller = UIApplication.shared.windows
                .compactMap({ $0.rootViewController })
                .first(where: { $0 is FoliaBridgeViewController }) as? FoliaBridgeViewController {
                controller.setNeedsStatusBarAppearanceUpdate()
                controller.setNeedsUpdateOfHomeIndicatorAutoHidden()
            }
        }
    }

    var isImmersive: Bool {
        lock.lock()
        defer { lock.unlock() }
        return immersive
    }
}

/// The bridge view controller, with Folia's own web view configuration.
///
/// Capacitor's own view controller builds the web view from a configuration it
/// creates. Folia needs one more thing on that configuration: the scheme handler
/// that serves the picked libraries' files, which has to be in place before the web
/// view exists.
open class FoliaBridgeViewController: CAPBridgeViewController {
    /// The handler that serves the local library's files.
    private let localSchemeHandler = FoliaLocalSchemeHandler()

    open override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.setURLSchemeHandler(localSchemeHandler, forURLScheme: FoliaLocalSchemeHandler.scheme)

        // The addresses the web build should talk to are decided by the app, not by
        // the build, so they are handed to the page before it runs. The page's own
        // runtime-config.js keeps what is already there, so the two do not fight.
        if let script = FoliaRuntimeConfigStore.shared.pageScript() {
            configuration.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            )
        }

        return configuration
    }

    /// The status bar is hidden either because the player asked for the immersive
    /// stage, or because the StatusBar plugin hid it.
    open override var prefersStatusBarHidden: Bool {
        FoliaWindowChrome.shared.isImmersive || !isStatusBarVisible
    }

    /// The home indicator is hidden together with the status bar: the lyrics stage
    /// runs edge to edge, and an indicator sitting on top of it is in the way.
    open override var prefersHomeIndicatorAutoHidden: Bool {
        FoliaWindowChrome.shared.isImmersive
    }
}
