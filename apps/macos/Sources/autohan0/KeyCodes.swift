import Foundation

/// macOS virtual key codes the app handles itself (Carbon kVK_*).
enum KeyCode {
    static let returnKey = 0x24
    static let tab = 0x30
    static let space = 0x31
    static let delete = 0x33
    static let escape = 0x35
    static let w = 0x0D
    static let keypadEnter = 0x4C
}

/// Modifier bits understood by the engine's HostAdapter (packages/engine/src/host.ts MOD).
enum EngineMod {
    static let shift = 1
    static let capsLock = 2
    static let control = 4
    static let option = 8
    static let command = 16
}

/// US QWERTY characters for macOS virtual key codes: (unshifted, shifted).
/// Mirrors MAC_KEYS in packages/engine/src/keymap.ts; used by the self-test and the key injector.
enum QwertyKeys {
    static let pairs: [(Int, Character, Character)] = [
        (0x00, "a", "A"), (0x01, "s", "S"), (0x02, "d", "D"), (0x03, "f", "F"), (0x04, "h", "H"),
        (0x05, "g", "G"), (0x06, "z", "Z"), (0x07, "x", "X"), (0x08, "c", "C"), (0x09, "v", "V"),
        (0x0B, "b", "B"), (0x0C, "q", "Q"), (0x0D, "w", "W"), (0x0E, "e", "E"), (0x0F, "r", "R"),
        (0x10, "y", "Y"), (0x11, "t", "T"), (0x12, "1", "!"), (0x13, "2", "@"), (0x14, "3", "#"),
        (0x15, "4", "$"), (0x16, "6", "^"), (0x17, "5", "%"), (0x18, "=", "+"), (0x19, "9", "("),
        (0x1A, "7", "&"), (0x1B, "-", "_"), (0x1C, "8", "*"), (0x1D, "0", ")"), (0x1E, "]", "}"),
        (0x1F, "o", "O"), (0x20, "u", "U"), (0x21, "[", "{"), (0x22, "i", "I"), (0x23, "p", "P"),
        (0x25, "l", "L"), (0x26, "j", "J"), (0x27, "'", "\""), (0x28, "k", "K"), (0x29, ";", ":"),
        (0x2A, "\\", "|"), (0x2B, ",", "<"), (0x2C, "/", "?"), (0x2D, "n", "N"), (0x2E, "m", "M"),
        (0x2F, ".", ">"), (0x32, "`", "~"),
    ]

    private static let byChar: [Character: (code: Int, shift: Bool)] = {
        var m: [Character: (code: Int, shift: Bool)] = [" ": (KeyCode.space, false), "\n": (KeyCode.returnKey, false)]
        for (code, lower, upper) in pairs {
            m[lower] = (code, false)
            m[upper] = (code, true)
        }
        return m
    }()

    /// QWERTY character (' ' = space, '\n' = return) -> key code + Shift.
    static func key(for ch: Character) -> (code: Int, shift: Bool)? {
        byChar[ch]
    }
}
