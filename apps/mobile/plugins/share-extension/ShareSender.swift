import UIKit
import WebKit

/// Sends one share through the page `share-sender.html`, which holds the app's Team client
/// (`src/features/share/extension/share-sender.ts`). WebRTC runs in a web view, as in the app.
///
/// The page asks this side for two things only: a request to the account service of the session,
/// and the bytes of one shared file. A request to any other address is refused.
@MainActor
final class ShareSender: NSObject, WKNavigationDelegate, WKScriptMessageHandlerWithReply {
  struct File {
    let url: URL
    let name: String
    let mimeType: String
  }

  enum Outcome {
    case sent
    /// `unconfirmed`: the message went to the server and no answer came. It can be in the chat.
    case failed(unconfirmed: Bool, detail: String)
  }

  private static let handlerName = "openbot"
  private let webView: WKWebView
  private let pageURL: URL?
  private let apiOrigin: URLComponents?
  private let files: [File]
  private let session: URLSession
  private var loaded: CheckedContinuation<Void, Error>?

  init(container: UIView, apiUrl: String, files: [File]) {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    pageURL = Bundle.main.url(forResource: "share-sender", withExtension: "html")
    apiOrigin = URLComponents(string: apiUrl)
    self.files = files
    let sessionConfiguration = URLSessionConfiguration.ephemeral
    sessionConfiguration.timeoutIntervalForRequest = 30
    session = URLSession(configuration: sessionConfiguration)
    super.init()
    configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: Self.handlerName)
    webView.navigationDelegate = self
    // A web view outside a window can stop its timers. This one is in the view, and nobody sees it.
    webView.alpha = 0
    webView.isUserInteractionEnabled = false
    container.addSubview(webView)
  }

  func send(_ request: [String: Any]) async -> Outcome {
    defer { close() }
    guard let pageURL else { return .failed(unconfirmed: false, detail: "The share page is missing.") }
    do {
      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        loaded = continuation
        webView.loadFileURL(pageURL, allowingReadAccessTo: pageURL.deletingLastPathComponent())
      }
      let value = try await webView.callAsyncJavaScript(
        "return await window.openbotShareSend(request);",
        arguments: ["request": request],
        contentWorld: .page
      )
      guard let result = value as? [String: Any] else {
        return .failed(unconfirmed: false, detail: "The share page gave no result.")
      }
      if result["ok"] as? Bool == true { return .sent }
      let stage = result["stage"] as? String ?? "unknown"
      let reference = result["reference"] as? String ?? "none"
      return .failed(
        unconfirmed: result["unconfirmed"] as? Bool == true,
        detail: "\(stage): \(result["error"] as? String ?? "") (\(reference))"
      )
    } catch {
      return .failed(unconfirmed: false, detail: error.localizedDescription)
    }
  }

  private func close() {
    webView.configuration.userContentController.removeAllScriptMessageHandlers()
    webView.stopLoading()
    webView.removeFromSuperview()
    session.invalidateAndCancel()
  }

  // MARK: - Navigation

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    loaded?.resume()
    loaded = nil
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    loaded?.resume(throwing: error)
    loaded = nil
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    loaded?.resume(throwing: error)
    loaded = nil
  }

  /// The page opens nothing but itself.
  func webView(
    _ webView: WKWebView,
    decidePolicyFor navigationAction: WKNavigationAction,
    decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
  ) {
    let url = navigationAction.request.url
    decisionHandler(url?.isFileURL == true && url?.path == pageURL?.path ? .allow : .cancel)
  }

  // MARK: - Page requests

  func userContentController(
    _ userContentController: WKUserContentController,
    didReceive message: WKScriptMessage
  ) async -> (Any?, String?) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
      return (nil, "Unknown request")
    }
    switch type {
    case "fetch":
      return await fetch(body)
    case "file":
      guard let index = body["index"] as? Int, files.indices.contains(index) else { return (nil, "Unknown file") }
      do {
        return (try Data(contentsOf: files[index].url).base64EncodedString(), nil)
      } catch {
        return (nil, "The file could not be read")
      }
    default:
      return (nil, "Unknown request")
    }
  }

  private func fetch(_ body: [String: Any]) async -> (Any?, String?) {
    guard
      let address = body["url"] as? String,
      let url = URL(string: address),
      let target = URLComponents(url: url, resolvingAgainstBaseURL: false),
      let apiOrigin,
      target.scheme == apiOrigin.scheme,
      target.host == apiOrigin.host,
      target.port == apiOrigin.port
    else { return (nil, "The address is not the account service") }
    var request = URLRequest(url: url)
    request.httpMethod = body["method"] as? String ?? "GET"
    for (name, value) in body["headers"] as? [String: String] ?? [:] {
      request.setValue(value, forHTTPHeaderField: name)
    }
    if let text = body["body"] as? String { request.httpBody = Data(text.utf8) }
    do {
      let (data, response) = try await session.data(for: request)
      guard let http = response as? HTTPURLResponse else { return (nil, "No HTTP response") }
      var headers: [String: String] = [:]
      for (name, value) in http.allHeaderFields {
        if let name = name as? String, let value = value as? String { headers[name.lowercased()] = value }
      }
      return (["status": http.statusCode, "headers": headers, "body": String(decoding: data, as: UTF8.self)], nil)
    } catch {
      return (nil, error.localizedDescription)
    }
  }
}
