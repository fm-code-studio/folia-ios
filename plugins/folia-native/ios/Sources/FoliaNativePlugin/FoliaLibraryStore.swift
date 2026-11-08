import Foundation
import UniformTypeIdentifiers

/// One file or folder inside a picked library.
struct FoliaLibraryEntry {
    let path: String
    let name: String
    let size: Int
    let isDirectory: Bool
    let modifiedAt: Double
}

/// The library the user picked: the folder that was copied into the sandbox, and
/// everything below it.
///
/// The document picker hands the folder over in a temporary location; it is copied
/// into the app's own storage so it stays readable after the picker is gone, and so
/// the web build can address it by a stable id.
final class FoliaLibraryStore {
    /// The folders that were picked, one directory each.
    static let shared = FoliaLibraryStore()

    /// Where the copied folders live.
    private let rootDirectory: URL

    /// libraryId -> the folder's own name, which is the key the web build files it under.
    private var libraryNames: [String: String] = [:]

    private let fileManager = FileManager.default

    private init() {
        let documents = fileManager.urls(for: .documentDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        rootDirectory = documents.appendingPathComponent("FoliaLibrary", isDirectory: true)

        if !fileManager.fileExists(atPath: rootDirectory.path) {
            try? fileManager.createDirectory(at: rootDirectory, withIntermediateDirectories: true)
        }

        if let stored = UserDefaults.standard.dictionary(forKey: Self.namesKey) as? [String: String] {
            libraryNames = stored
        }
    }

    private static let namesKey = "top.izuna.foliamajor.ios.libraryNames"

    /// The directory a library's files live in.
    func directory(for libraryId: String) -> URL {
        rootDirectory.appendingPathComponent(libraryId, isDirectory: true)
    }

    /// The name a library is filed under in the web build.
    func name(for libraryId: String) -> String? {
        libraryNames[libraryId]
    }

    /// Whether a library is still on disk.
    func exists(libraryId: String) -> Bool {
        fileManager.fileExists(atPath: directory(for: libraryId).path)
    }

    /// Copies a picked folder into the sandbox and returns its id.
    ///
    /// The id is derived from the folder's name and the moment it was picked, so
    /// picking the same folder twice gives two libraries rather than overwriting one.
    @discardableResult
    func adopt(folderURL: URL, name: String) throws -> String {
        let libraryId = Self.makeLibraryId(name: name)
        let destination = directory(for: libraryId)

        if fileManager.fileExists(atPath: destination.path) {
            try? fileManager.removeItem(at: destination)
        }
        try fileManager.createDirectory(at: destination, withIntermediateDirectories: true)

        // A picked folder arrives as a directory that may itself contain a single
        // wrapper folder (the picker hands back the folder that was tapped, but some
        // providers wrap it). The contents are copied rather than the folder itself,
        // so the library's root is the folder the user chose.
        let source = folderURL.hasDirectoryPath ? folderURL : folderURL.deletingLastPathComponent()
        try fileManager.copyItem(at: source, to: destination)

        libraryNames[libraryId] = name
        persistNames()
        return libraryId
    }

    /// Removes a library and everything copied into it.
    func remove(libraryId: String) {
        try? fileManager.removeItem(at: directory(for: libraryId))
        libraryNames.removeValue(forKey: libraryId)
        persistNames()
    }

    /// Every entry below a library's root, recursively.
    func entries(libraryId: String, relativePath: String = "") -> [FoliaLibraryEntry] {
        let base = relativePath.isEmpty
            ? directory(for: libraryId)
            : directory(for: libraryId).appendingPathComponent(relativePath)

        guard fileManager.fileExists(atPath: base.path) else { return [] }

        var result: [FoliaLibraryEntry] = []
        let keys: [URLResourceKey] = [.isDirectoryKey, .fileSizeKey, .contentModificationDateKey]
        guard let contents = try? fileManager.contentsOfDirectory(
            at: base,
            includingPropertiesForKeys: keys,
            options: [.skipsHiddenFiles]
        ) else {
            return []
        }

        for child in contents {
            let values = try? child.resourceValues(forKeys: Set(keys))
            let isDirectory = values?.isDirectory ?? false
            let size = values?.fileSize ?? 0
            let modifiedAt = values?.contentModificationDate?.timeIntervalSince1970 ?? 0
            let childPath = relativePath.isEmpty ? child.lastPathComponent : "\(relativePath)/\(child.lastPathComponent)"

            result.append(FoliaLibraryEntry(
                path: childPath,
                name: child.lastPathComponent,
                size: isDirectory ? 0 : size,
                isDirectory: isDirectory,
                modifiedAt: modifiedAt * 1000
            ))

            if isDirectory {
                result.append(contentsOf: entries(libraryId: libraryId, relativePath: childPath))
            }
        }

        return result
    }

    /// The URL of one file inside a library.
    func fileURL(libraryId: String, relativePath: String) -> URL {
        directory(for: libraryId).appendingPathComponent(relativePath)
    }

    /// The folder the picker should open at.
    func existingLibraryIds() -> [String] {
        libraryNames.keys.filter { exists(libraryId: $0) }
    }

    private func persistNames() {
        UserDefaults.standard.set(libraryNames, forKey: Self.namesKey)
    }

    private static func makeLibraryId(name: String) -> String {
        let stamp = Int(Date().timeIntervalSince1970 * 1000)
        let slug = name.replacingOccurrences(
            of: "[^A-Za-z0-9_-]",
            with: "_",
            options: .regularExpression
        )
        return "\(slug.isEmpty ? "library" : slug)-\(stamp)"
    }
}
