import CoreGraphics
import Foundation

/// The keyboard shortcuts macOS uses to switch input sources (System Settings > Keyboard >
/// Keyboard Shortcuts > Input Sources: "Select the previous / next input source", ⌃Space and
/// ⌃⌥Space by default). autohan0 swallows these and treats them as the Han/Yeong key.
/// Caps Lock and 🌐 switching are not shortcuts; they are caught as input-source changes.
struct SwitchShortcut: Equatable {
    let keyCode: Int
    /// shift / control / option / command bits only (CGEventFlags layout)
    let modifiers: UInt64

    static let relevant: UInt64 = CGEventFlags.maskShift.rawValue | CGEventFlags.maskControl.rawValue
        | CGEventFlags.maskAlternate.rawValue | CGEventFlags.maskCommand.rawValue

    func matches(keyCode: Int, flags: CGEventFlags) -> Bool {
        keyCode == self.keyCode && (flags.rawValue & Self.relevant) == modifiers
    }

    /// Reads symbolic hot keys 60 (previous source) and 61 (next source) if enabled.
    static func load() -> [SwitchShortcut] {
        let domain = "com.apple.symbolichotkeys" as CFString
        CFPreferencesAppSynchronize(domain)
        guard let all = CFPreferencesCopyAppValue("AppleSymbolicHotKeys" as CFString, domain) as? [String: Any] else {
            return [SwitchShortcut(keyCode: KeyCode.space, modifiers: CGEventFlags.maskControl.rawValue)]
        }
        var out: [SwitchShortcut] = []
        for id in ["60", "61"] {
            guard let entry = all[id] as? [String: Any],
                  (entry["enabled"] as? NSNumber)?.boolValue ?? false,
                  let value = entry["value"] as? [String: Any],
                  let params = value["parameters"] as? [NSNumber], params.count == 3 else { continue }
            let code = params[1].intValue
            guard code != 0xFFFF else { continue }
            out.append(SwitchShortcut(keyCode: code, modifiers: params[2].uint64Value & relevant))
        }
        return out
    }
}
