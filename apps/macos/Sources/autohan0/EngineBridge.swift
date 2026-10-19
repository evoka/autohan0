import Foundation
import JavaScriptCore

enum Mode: String {
    case ko, en

    var toggled: Mode { self == .ko ? .en : .ko }
}

/// What to do with one key, as decided by the engine's HostAdapter.
struct HostAction {
    /// drop the original key event and apply the edit instead
    var consume = false
    /// after the edit, re-send the original key (Return)
    var thenOriginal = false
    /// the learned-word list changed and should be saved
    var learnedChanged = false
    var mode = Mode.en
    /// backspaces to send (code points before the caret)
    var deleteCount = 0
    var insert = ""

    var hasEdit: Bool { deleteCount > 0 || !insert.isEmpty }

    /// Parses `<consume><thenOriginal><learnedChanged><mode k|e><deleteCount>:<insert>` (see host-jsc.ts).
    init(packed s: String) {
        let u = s.utf8
        guard u.count >= 6 else { return }
        var i = u.startIndex
        consume = u[i] == UInt8(ascii: "1"); i = u.index(after: i)
        thenOriginal = u[i] == UInt8(ascii: "1"); i = u.index(after: i)
        learnedChanged = u[i] == UInt8(ascii: "1"); i = u.index(after: i)
        mode = u[i] == UInt8(ascii: "k") ? .ko : .en; i = u.index(after: i)
        var n = 0
        while i < u.endIndex, u[i] != UInt8(ascii: ":") {
            n = n * 10 + Int(u[i] - UInt8(ascii: "0"))
            i = u.index(after: i)
        }
        deleteCount = n
        if i < u.endIndex { insert = String(s[u.index(after: i)...]) }
    }

    init() {}
}

struct LearnedEntry: Codable, Equatable {
    var keys: String
    var mode: String
    var text: String
    var count: Int
}

enum EngineError: Error, CustomStringConvertible {
    case missingScript(String)
    case script(String)

    var description: String {
        switch self {
        case .missingScript(let p): return "engine script not found: \(p)"
        case .script(let m): return "engine script error: \(m)"
        }
    }
}

/// The TypeScript engine (packages/engine, bundled by `npm run build:jsc`) running in JavaScriptCore.
/// Create it on any thread, then use it from one thread at a time (the app uses the main thread).
final class EngineBridge {
    private final class ErrorBox { var message: String? }

    let context: JSContext
    private let api: JSValue
    private let errors = ErrorBox()
    // Hot-path functions are called through the C API to skip Objective-C argument boxing.
    private let ctxRef: JSGlobalContextRef
    private let keyDownValue: JSValue
    private let toggleValue: JSValue
    private let keyDownRef: JSObjectRef
    private let toggleRef: JSObjectRef
    /// milliseconds spent building the models in init()
    let initMs: Double

    static func defaultScriptURL() -> URL? {
        if let p = ProcessInfo.processInfo.environment["AUTOHAN0_ENGINE_JS"] { return URL(fileURLWithPath: p) }
        return Bundle.main.url(forResource: "autohan0-engine", withExtension: "js")
    }

    /// options: HostOptions of host.ts (layout, mode, learned, shiftSpaceToggle).
    init(scriptURL: URL, options: [String: Any]) throws {
        guard let source = try? String(contentsOf: scriptURL, encoding: .utf8) else {
            throw EngineError.missingScript(scriptURL.path)
        }
        guard let ctx = JSContext() else { throw EngineError.script("no JSContext") }
        let box = errors
        ctx.exceptionHandler = { _, exc in box.message = exc?.toString() ?? "unknown" }
        ctx.evaluateScript(source, withSourceURL: scriptURL)
        if let m = box.message { throw EngineError.script(m) }
        guard let api = ctx.objectForKeyedSubscript("autohan0Host"), api.isObject else {
            throw EngineError.script("autohan0Host is not defined")
        }
        context = ctx
        self.api = api
        ctxRef = ctx.jsGlobalContextRef
        keyDownValue = api.forProperty("keyDown")
        toggleValue = api.forProperty("toggle")
        keyDownRef = JSValueToObject(ctxRef, keyDownValue.jsValueRef, nil)
        toggleRef = JSValueToObject(ctxRef, toggleValue.jsValueRef, nil)
        let json = String(data: try JSONSerialization.data(withJSONObject: options), encoding: .utf8) ?? "{}"
        initMs = api.invokeMethod("init", withArguments: [json]).toDouble()
        if let m = box.message { throw EngineError.script(m) }
    }

    /// Replace the adapter state (models stay cached), e.g. between self-test cases.
    func reset(options: [String: Any]) {
        let json = String(data: (try? JSONSerialization.data(withJSONObject: options)) ?? Data("{}".utf8), encoding: .utf8) ?? "{}"
        _ = api.invokeMethod("init", withArguments: [json])
    }

    /// Run the hot paths on a scratch adapter so the JIT compiles them. Returns milliseconds.
    @discardableResult
    func warmup(rounds: Int = 30) -> Double {
        api.invokeMethod("warmup", withArguments: [rounds]).toDouble()
    }

    // MARK: per key

    /// keyCode: macOS virtual key code, mods: EngineMod bits, now: milliseconds (monotonic).
    func keyDown(_ keyCode: Int, mods: Int, now: Double) -> HostAction {
        call(keyDownRef, Double(keyCode), Double(mods), now)
    }

    /// The Han/Yeong key.
    func toggle(now: Double) -> HostAction {
        call(toggleRef, now)
    }

    private func call(_ fn: JSObjectRef, _ numbers: Double...) -> HostAction {
        let args: [JSValueRef?] = numbers.map { JSValueMakeNumber(ctxRef, $0) }
        var exc: JSValueRef?
        guard let r = JSObjectCallAsFunction(ctxRef, fn, nil, args.count, args, &exc), exc == nil,
              let js = JSValueToStringCopy(ctxRef, r, nil) else {
            if let exc { errors.message = JSValue(jsValueRef: exc, in: context)?.toString() }
            return HostAction()
        }
        defer { JSStringRelease(js) }
        let s = JSStringCopyCFString(kCFAllocatorDefault, js) as String
        return HostAction(packed: s)
    }

    // MARK: state

    /// Mouse click, focus / app change, caret keys: forget the text before the caret.
    func caretMoved() { _ = api.invokeMethod("caretMoved", withArguments: []) }

    var mode: Mode {
        Mode(rawValue: api.invokeMethod("mode", withArguments: []).toString()) ?? .en
    }

    func setMode(_ m: Mode) { _ = api.invokeMethod("setMode", withArguments: [m.rawValue]) }

    func setLayout(_ id: String) { _ = api.invokeMethod("setLayout", withArguments: [id]) }

    func setBypass(_ on: Bool) { _ = api.invokeMethod("setBypass", withArguments: [on]) }

    func setShiftSpaceToggle(_ on: Bool) { _ = api.invokeMethod("setShiftSpaceToggle", withArguments: [on]) }

    func learned() -> [LearnedEntry] {
        let json = api.invokeMethod("learned", withArguments: []).toString() ?? "[]"
        return (try? JSONDecoder().decode([LearnedEntry].self, from: Data(json.utf8))) ?? []
    }

    func forget(keys: String, mode: String) { _ = api.invokeMethod("forget", withArguments: [keys, mode]) }

    func forgetAll() { _ = api.invokeMethod("forgetAll", withArguments: []) }

    /// The engine's text model (self-tests).
    var text: String { api.invokeMethod("text", withArguments: []).toString() ?? "" }

    /// Last script exception, if any (cleared on read).
    func takeError() -> String? {
        defer { errors.message = nil }
        return errors.message
    }
}
