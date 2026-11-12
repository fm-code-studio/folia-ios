import Foundation
import WebKit
import UniformTypeIdentifiers

/// Serves the files of the picked libraries to the web build over `folia-local://`.
///
/// The web build's local library works on `FileSystemFileHandle`s, which the iOS web
/// view does not have. The files themselves are read through this handler instead of
/// through the plugin's bridge, for two reasons:
///
///   - A song is tens of megabytes. Handing it over as base64 across the plugin
///     bridge would cost a third more on the wire and copy it twice in memory.
///   - The web view's own resource loader is what `<audio>` needs: it asks for byte
///     ranges when the user seeks, and it will only do that for something that
///     answers like an HTTP server.
///
/// The URL is `folia-local://<libraryId>/<path inside the library>`.
final class FoliaLocalSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "folia-local"

    /// The tasks in flight, so a stopped task can cancel its read.
    private let lock = NSLock()
    private var tasks: [ObjectIdentifier: URLSessionDataTask] = [:]

    /// The headers that let the page read a `folia-local://` URL with `fetch`.
    ///
    /// The page runs on `capacitor://localhost`, so every read of a library file is a
    /// cross-origin request. Without these the web view answers the page with a CORS
    /// error instead of the bytes, and the library ends up with no songs in it.
    private static let corsHeaders: [String: String] = [
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
        "Access-Control-Allow-Headers": "Range, Content-Type",
        "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(FoliaLocalSchemeHandler.makeError(400, "Malformed URL"))
            return
        }

        // A ranged read or a plain fetch both send a preflight first; it has no file
        // behind it, only the permission to ask.
        if urlSchemeTask.request.httpMethod == "OPTIONS" {
            let response = HTTPURLResponse(
                url: url,
                statusCode: 204,
                httpVersion: "HTTP/1.1",
                headerFields: FoliaLocalSchemeHandler.corsHeaders
            )!
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didFinish()
            return
        }

        // folia-local://<libraryId>/<path...> - the host is the library, the path is
        // the file inside it.
        guard let libraryId = url.host, !libraryId.isEmpty else {
            urlSchemeTask.didFailWithError(FoliaLocalSchemeHandler.makeError(400, "No library in the URL"))
            return
        }

        let relativePath = FoliaLocalSchemeHandler.normalizePath(String(url.path))
        guard !relativePath.isEmpty else {
            urlSchemeTask.didFailWithError(FoliaLocalSchemeHandler.makeError(400, "No file in the URL"))
            return
        }

        let fileURL = FoliaLibraryStore.shared.fileURL(libraryId: libraryId, relativePath: relativePath)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            urlSchemeTask.didFailWithError(FoliaLocalSchemeHandler.makeError(404, "No such file in the library"))
            return
        }

        do {
            let size = try FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int ?? 0
            let contentType = FoliaLocalSchemeHandler.contentType(for: fileURL)
            let range = FoliaLocalSchemeHandler.parseRange(urlSchemeTask.request)

            if urlSchemeTask.request.httpMethod == "HEAD" {
                let response = HTTPURLResponse(
                    url: url,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: FoliaLocalSchemeHandler.corsHeaders.merging([
                        "Content-Type": contentType,
                        "Content-Length": String(size),
                        "Accept-Ranges": "bytes",
                    ]) { _, new in new }
                )!
                urlSchemeTask.didReceive(response)
                urlSchemeTask.didFinish()
                return
            }

            let offset: Int
            let length: Int
            let statusCode: Int
            var headers: [String: String] = FoliaLocalSchemeHandler.corsHeaders.merging([
                "Content-Type": contentType,
                "Accept-Ranges": "bytes",
            ]) { _, new in new }

            if let range = FoliaLocalSchemeHandler.parseRange(urlSchemeTask.request) {
                // An open-ended range runs to the end of the file, and a range that
                // starts past the end has nothing to answer with.
                guard range.start < size else {
                    urlSchemeTask.didFailWithError(FoliaLocalSchemeHandler.makeError(416, "Range starts past the end of the file"))
                    return
                }
                let lastByte = min(range.end ?? (size - 1), size - 1)
                offset = range.start
                length = lastByte - range.start + 1
                statusCode = 206
                headers["Content-Range"] = "bytes \(offset)-\(lastByte)/\(size)"
            } else {
                offset = 0
                length = size
                statusCode = 200
            }

            headers["Content-Length"] = String(length)

            let response = HTTPURLResponse(
                url: url,
                statusCode: statusCode,
                httpVersion: "HTTP/1.1",
                headerFields: headers
            )!
            urlSchemeTask.didReceive(response)

            let data = try Data(contentsOf: fileURL, options: .mappedIfSafe)
            let upperBound = min(offset + length, data.count)
            let slice = (offset == 0 && upperBound == data.count) ? data : data.subdata(in: offset..<upperBound)
            urlSchemeTask.didReceive(slice)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // The read happens synchronously above, so there is nothing to cancel; the
        // method is here because the protocol requires it.
    }

    /// Strips the leading slash and refuses anything that tries to climb out of the
    /// library's own directory.
    private static func normalizePath(_ rawPath: String) -> String {
        let trimmed = rawPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let segments = trimmed.split(separator: "/").map(String.init)
        guard !segments.isEmpty else { return "" }
        guard !segments.contains("..") else { return "" }
        return segments.joined(separator: "/")
    }

    /// Reads a `Range: bytes=...` header.
    ///
    /// The end is optional: `bytes=500-` means "from here to the end of the file".
    private static func parseRange(_ request: URLRequest) -> (start: Int, end: Int?)? {
        guard let header = request.value(forHTTPHeaderField: "Range") else { return nil }
        guard header.lowercased().hasPrefix("bytes=") else { return nil }

        let spec = header.dropFirst("bytes=".count)
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard let first = parts.first, !first.isEmpty else { return nil }

        guard let start = Int(first), start >= 0 else { return nil }
        if parts.count < 2 || parts[1].isEmpty {
            return (start, nil)
        }
        guard let end = Int(parts[1]), end >= start else { return nil }
        return (start, end)
    }

    /// The type a file is served as, from its extension.
    private static func contentType(for url: URL) -> String {
        if let type = UTType(filenameExtension: url.pathExtension), let mime = type.preferredMIMEType {
            return mime
        }
        return "application/octet-stream"
    }

    private static func makeError(_ code: Int, _ message: String) -> NSError {
        NSError(
            domain: "FoliaNative.localScheme",
            code: code,
            userInfo: [NSLocalizedDescriptionKey: message]
        )
    }
}
