import Carbon
import Foundation

/// Keeps the OS input source on a QWERTY layout (ABC) while autohan0 is active, remembers the
/// user's Korean input source to give it back when autohan0 steps aside, and reports when
/// something else (Caps Lock, the 🌐 key, a shortcut, the input menu) switched away from ABC.
final class InputSources: NSObject {
    /// Called on the main thread when the selected keyboard source changed to a non-ASCII one,
    /// with the time (ms, system uptime) the change was announced.
    var onSwitchedAway: ((Double) -> Void)?

    private static let changedNotification = Notification.Name("com.apple.Carbon.TISNotifySelectedKeyboardInputSourceChanged")
    private(set) var asciiSource: TISInputSource?
    private(set) var koreanSource: TISInputSource?

    override init() {
        super.init()
        asciiSource = Self.findASCII()
        let cur = Self.current()
        if let cur, !isASCII(cur), Self.isKeyboardSource(cur) { koreanSource = cur }
        if koreanSource == nil { koreanSource = Self.findKorean() }
        // .deliverImmediately: an accessory app is never "active", default delivery would be held back.
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(changed), name: Self.changedNotification, object: nil,
            suspensionBehavior: .deliverImmediately)
    }

    deinit { DistributedNotificationCenter.default().removeObserver(self) }

    @objc private func changed() {
        let at = ProcessInfo.processInfo.systemUptime * 1000
        if let cur = Self.current(), !isASCII(cur) { return report(cur, at) }
        // Right after the notification the selected source can still read as the old one: look again.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.04) { [weak self] in
            guard let self, let cur = Self.current(), !self.isASCII(cur) else { return }
            self.report(cur, at)
        }
    }

    private func report(_ cur: TISInputSource, _ at: Double) {
        if Self.isKeyboardSource(cur) { koreanSource = cur }
        onSwitchedAway?(at)
    }

    var currentID: String {
        Self.current().flatMap { Self.string($0, kTISPropertyInputSourceID) } ?? "?"
    }

    /// The current OS source is the QWERTY layout autohan0 relies on.
    var isOnASCII: Bool {
        guard let cur = Self.current() else { return false }
        return isASCII(cur)
    }

    /// The user was typing Korean when autohan0 took over.
    var isOnKorean: Bool {
        guard let cur = Self.current() else { return false }
        return !isASCII(cur) && Self.languages(cur).contains { $0.hasPrefix("ko") }
    }

    func selectASCII() {
        guard let src = asciiSource, !isOnASCII else { return }
        TISSelectInputSource(src)
    }

    func selectKorean() {
        guard let src = koreanSource else { return }
        TISSelectInputSource(src)
    }

    var asciiName: String { asciiSource.map { Self.string($0, kTISPropertyLocalizedName) ?? "ABC" } ?? "ABC" }

    private func isASCII(_ src: TISInputSource) -> Bool {
        guard let id = Self.string(src, kTISPropertyInputSourceID) else { return false }
        if let ascii = asciiSource, let aid = Self.string(ascii, kTISPropertyInputSourceID) { return id == aid }
        return id == "com.apple.keylayout.ABC" || id == "com.apple.keylayout.US"
    }

    // MARK: TIS helpers

    static func current() -> TISInputSource? {
        TISCopyCurrentKeyboardInputSource()?.takeRetainedValue()
    }

    static func string(_ src: TISInputSource, _ key: CFString) -> String? {
        guard let p = TISGetInputSourceProperty(src, key) else { return nil }
        return Unmanaged<CFString>.fromOpaque(p).takeUnretainedValue() as String
    }

    static func languages(_ src: TISInputSource) -> [String] {
        guard let p = TISGetInputSourceProperty(src, kTISPropertyInputSourceLanguages) else { return [] }
        return (Unmanaged<CFArray>.fromOpaque(p).takeUnretainedValue() as? [String]) ?? []
    }

    static func isKeyboardSource(_ src: TISInputSource) -> Bool {
        guard let cat = string(src, kTISPropertyInputSourceCategory) else { return false }
        return cat == (kTISCategoryKeyboardInputSource as String)
    }

    static func enabledSources(_ filter: [String: Any] = [:]) -> [TISInputSource] {
        let list = TISCreateInputSourceList(filter as CFDictionary, false)?.takeRetainedValue()
        return (list as? [TISInputSource]) ?? []
    }

    /// ABC, else U.S., else whatever ASCII layout the system offers.
    static func findASCII() -> TISInputSource? {
        for id in ["com.apple.keylayout.ABC", "com.apple.keylayout.US"] {
            if let s = enabledSources([kTISPropertyInputSourceID as String: id]).first { return s }
        }
        return TISCopyCurrentASCIICapableKeyboardLayoutInputSource()?.takeRetainedValue()
    }

    static func findKorean() -> TISInputSource? {
        enabledSources().first { src in
            isKeyboardSource(src) && languages(src).contains { $0.hasPrefix("ko") }
                && (TISGetInputSourceProperty(src, kTISPropertyInputSourceIsSelectCapable)
                    .map { CFBooleanGetValue(Unmanaged<CFBoolean>.fromOpaque($0).takeUnretainedValue()) } ?? false)
        }
    }
}
