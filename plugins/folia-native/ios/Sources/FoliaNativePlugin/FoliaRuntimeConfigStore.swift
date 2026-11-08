import Foundation

/// Where the native shell keeps the addresses the web build talks to.
///
/// The web build reads its API addresses from Vite's build-time variables, and a
/// bundle that has been built cannot change them afterwards. The native shell
/// keeps them in its own settings instead, and hands them to the web build at
/// startup, so one build of the app can be pointed at a different backend.
final class FoliaRuntimeConfigStore {
    static let shared = FoliaRuntimeConfigStore()

    private enum Key {
        static let apiBase = "top.izuna.foliamajor.ios.apiBase"
        static let neteaseApiBase = "top.izuna.foliamajor.ios.neteaseApiBase"
        static let kugouApiBase = "top.izuna.foliamajor.ios.kugouApiBase"
        static let qqApiBase = "top.izuna.foliamajor.ios.qqApiBase"
        static let aiProvider = "top.izuna.foliamajor.ios.aiProvider"
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
    }

    /// The addresses, as the web build expects them.
    func configuration() -> [String: Any] {
        var result: [String: Any] = [:]
        if let value = defaults.string(forKey: Key.apiBase), !value.isEmpty {
            result["apiBase"] = value
        }
        if let value = defaults.string(forKey: Key.neteaseApiBase), !value.isEmpty {
            result["neteaseApiBase"] = value
        }
        if let value = defaults.string(forKey: Key.kugouApiBase), !value.isEmpty {
            result["kugouApiBase"] = value
        }
        if let value = defaults.string(forKey: Key.qqApiBase), !value.isEmpty {
            result["qqApiBase"] = value
        }
        if let value = defaults.string(forKey: Key.aiProvider), !value.isEmpty {
            result["aiProvider"] = value
        }
        return result
    }

    /// Writes one address. An empty value clears it.
    func set(_ value: String?, for key: String) {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if trimmed.isEmpty {
            defaults.removeObject(forKey: key)
        } else {
            defaults.set(trimmed, forKey: key)
        }
    }

    /// The key one of the configuration fields is stored under.
    static func key(for field: String) -> String? {
        switch field {
        case "apiBase": return Key.apiBase
        case "neteaseApiBase": return Key.neteaseApiBase
        case "kugouApiBase": return Key.kugouApiBase
        case "qqApiBase": return Key.qqApiBase
        case "aiProvider": return Key.aiProvider
        default: return nil
        }
    }

    /// The script that hands the addresses to the page before it runs.
    ///
    /// The page's runtime-config.js keeps whatever is already on `window`, so the
    /// two do not have to know about each other.
    func pageScript() -> String? {
        let configuration = self.configuration()
        guard !configuration.isEmpty else { return nil }
        guard let data = try? JSONSerialization.data(withJSONObject: configuration),
              let json = String(data: data, encoding: .utf8) else {
            return nil
        }
        return "window.__FOLIA_RUNTIME_CONFIG__ = Object.assign(window.__FOLIA_RUNTIME_CONFIG__ || {}, \(json));"
    }
}
