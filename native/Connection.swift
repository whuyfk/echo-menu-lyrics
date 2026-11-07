import Foundation

final class BridgeConnection: NSObject, URLSessionWebSocketDelegate {
    private let endpoint: URL
    private let protocolName: String
    private var session: URLSession!
    private var task: URLSessionWebSocketTask?
    private var stopped = false
    private var retry = 0
    private var generation = 0
    private var reconnect: DispatchWorkItem?
    private var watchdog: Timer?
    private var lastMessage = Date()
    var onMessage: (([String: Any]) -> Void)?
    var onStatus: ((Bool, String) -> Void)?

    init(endpoint: URL, protocolName: String) {
        self.endpoint = endpoint; self.protocolName = protocolName
        super.init()
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 10
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: OperationQueue.main)
    }
    func start() {
        guard !stopped else { return }
        generation += 1
        let attempt = generation
        task = session.webSocketTask(with: endpoint, protocols: [protocolName])
        lastMessage = Date(); task?.resume(); receive(attempt)
        watchdog?.invalidate()
        watchdog = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            guard let self, Date().timeIntervalSince(self.lastMessage) > 14 else { return }
            self.failed(attempt)
        }
    }
    func send(_ message: [String: Any]) {
        guard !stopped, let data = try? JSONSerialization.data(withJSONObject: message),
              let text = String(data: data, encoding: .utf8) else { return }
        let attempt = generation
        task?.send(.string(text)) { [weak self] error in
            if error != nil { DispatchQueue.main.async { self?.failed(attempt) } }
        }
    }
    private func receive(_ attempt: Int) {
        task?.receive { [weak self] result in
            DispatchQueue.main.async {
                guard let self, !self.stopped, attempt == self.generation else { return }
                switch result {
                case .failure: self.failed(attempt)
                case .success(let value):
                    self.lastMessage = Date()
                    let data: Data?
                    switch value { case .string(let text): data = text.data(using: .utf8); case .data(let bytes): data = bytes; @unknown default: data = nil }
                    if let data, data.count <= 1_048_576,
                       let message = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] { self.onMessage?(message) }
                    self.receive(attempt)
                }
            }
        }
    }
    private func failed(_ attempt: Int) {
        guard !stopped, attempt == generation else { return }
        generation += 1; task?.cancel(with: .goingAway, reason: nil); task = nil
        watchdog?.invalidate(); watchdog = nil
        onStatus?(false, "与 EchoMusic 的连接已断开，正在重连…")
        retry += 1
        if retry > 8 { onStatus?(false, "EchoMusic 已退出或插件已停用。"); stop(); return }
        let work = DispatchWorkItem { [weak self] in self?.start() }
        reconnect = work
        DispatchQueue.main.asyncAfter(deadline: .now() + min(8, pow(1.5, Double(retry))), execute: work)
    }
    func stop() {
        stopped = true; generation += 1; reconnect?.cancel(); watchdog?.invalidate()
        task?.cancel(with: .goingAway, reason: nil); task = nil; session.invalidateAndCancel()
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        guard webSocketTask === task else { return }
        retry = 0; onStatus?(true, "已连接 EchoMusic")
    }
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        guard webSocketTask === task else { return }; failed(generation)
    }
}
