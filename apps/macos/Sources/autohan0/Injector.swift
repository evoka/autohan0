import AppKit
import ApplicationServices
import Carbon

/// `open -g -n autohan0.app --args --inject`: an end-to-end check of the running app.
/// A second instance (same signature, so same Accessibility permission) types a fixed key
/// sequence into the frontmost app as if it came from the keyboard, presses the Han/Yeong key
/// both the way Caps Lock / 🌐 do (selecting the Korean input source) and as the input-source
/// shortcut from System Settings, and reads the focused text back through Accessibility. It never presses Return, so a terminal runs nothing.
/// The report goes to ~/Library/Application Support/autohan0/inject-report.txt.
enum Injector {
    static var reportURL: URL { Store.directory.appendingPathComponent("inject-report.txt") }

    private enum HanYeong {
        case none
        /// select the Korean input source, as Caps Lock / 🌐 make macOS do
        case inputSource
        /// press the input-source shortcut from System Settings this many times, 150 ms apart
        case shortcut(Int)
    }

    private struct Step {
        let label: String
        let keys: String
        var hanYeong = HanYeong.none
        /// expected end of the current line after this step
        let expect: String
    }

    // Expected endings are checked per word and ignoring case: Notes capitalizes the first word and
    // autocorrects finished words (e.g. a reverted "jfshea" → "joshes"), which is not autohan0's doing.
    private static let steps: [Step] = [
        Step(label: "영어 단어로 A 상태 만들기", keys: "echo ", expect: "echo"),
        Step(label: "A 상태 jfshea → 치는 도중 한글", keys: "jfshea", expect: "echo 안녕"),
        Step(label: "A 상태 jfsheamfncj4 → 안녕하세요", keys: "mfncj4", expect: "echo 안녕하세요"),
        Step(label: "가 상태 git push origin main → 영어", keys: " git push origin main", expect: "안녕하세요 git push origin main"),
        Step(label: "jfshea 치는 중 → 안녕", keys: " jfshea", expect: "main 안녕"),
        Step(label: "한/영 키(입력 소스 전환) 한 번 → 친 그대로", keys: "", hanYeong: .inputSource, expect: "main jfshea"),
        Step(label: "o/jfs 치는 중 → 초안", keys: " o/jfs", expect: " 초안"),
        Step(label: "한/영 키(단축키) 한 번 → 친 그대로", keys: "", hanYeong: .shortcut(1), expect: " o/jfs"),
        Step(label: "yda0g 띄어쓰기 → 링크", keys: " yda0g ", expect: " 링크"),
        Step(label: "한/영 키(단축키) 빠르게 두 번 → 친 그대로", keys: "", hanYeong: .shortcut(2), expect: " yda0g"),
        Step(label: "jfshea 치는 중 → 안녕", keys: "jfshea", expect: " yda0g 안녕"),
        Step(label: "백스페이스 한 번 → 글자(음절) 하나 지움", keys: "\u{8}", expect: " yda0g 안"),
        Step(label: "이어 치기 heamfncj4 → 안녕하세요", keys: "heamfncj4", expect: " yda0g 안녕하세요"),
    ]

    /// freshLine: press Return first (for editors such as Notes; never used for a terminal).
    static func run(freshLine: Bool = false) -> Bool {
        var lines: [String] = []
        func say(_ s: String) {
            lines.append(s)
            print(s)
        }
        defer {
            try? FileManager.default.createDirectory(at: Store.directory, withIntermediateDirectories: true)
            try? (lines.joined(separator: "\n") + "\n").write(to: reportURL, atomically: true, encoding: .utf8)
        }
        let stamp = ISO8601DateFormatter().string(from: Date())
        say("autohan0 입력 점검 \(stamp)")
        guard AXIsProcessTrusted() else {
            say("실패: 손쉬운 사용 권한이 없어요 (open -n 으로 앱 번들을 띄워야 같은 권한을 씀)")
            return false
        }
        let me = ProcessInfo.processInfo.processIdentifier
        let id = Bundle.main.bundleIdentifier ?? ""
        guard NSRunningApplication.runningApplications(withBundleIdentifier: id).contains(where: { $0.processIdentifier != me }) else {
            say("실패: autohan0 본 앱이 실행 중이 아니에요")
            return false
        }
        guard let front = NSWorkspace.shared.frontmostApplication else {
            say("실패: 앞에 있는 앱이 없어요")
            return false
        }
        let shortcut = SwitchShortcut.load().first
        say("대상 앱: \(front.localizedName ?? "?") (\(front.bundleIdentifier ?? "?")), 입력 소스: \(currentSourceID()), 단축키: \(shortcut.map(AppDelegate.describe) ?? "없음")")

        let source = CGEventSource(stateID: .hidSystemState)
        func press(_ code: Int, shift: Bool) { press(code, flags: shift ? .maskShift : []) }
        func press(_ code: Int, flags: CGEventFlags) {
            for down in [true, false] {
                guard let e = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(code), keyDown: down) else { continue }
                e.flags = flags
                e.post(tap: .cghidEventTap)
                usleep(10_000)
            }
            usleep(50_000)
        }

        press(0x7C, shift: false) // → : harmless caret key, makes autohan0 forget earlier text
        if freshLine { press(KeyCode.returnKey, shift: false) }
        usleep(200_000)
        var ok = true
        var last: String?
        for step in steps {
            for ch in step.keys {
                if ch == "\u{8}" {
                    press(KeyCode.delete, shift: false)
                } else if let k = QwertyKeys.key(for: ch) {
                    press(k.code, shift: k.shift)
                }
            }
            switch step.hanYeong {
            case .none:
                break
            case .inputSource:
                if let ko = InputSources.findKorean() { TISSelectInputSource(ko) }
            case .shortcut(let times):
                guard let sc = shortcut else {
                    say("건너뜀 \(step.label): 시스템 설정에 입력 소스 단축키가 없어요")
                    return ok
                }
                for i in 0..<times {
                    if i > 0 { usleep(150_000) }
                    press(sc.keyCode, flags: CGEventFlags(rawValue: sc.modifiers))
                }
            }
            usleep(500_000)
            let line = lastLine(of: front.processIdentifier)
            let pass = line.map { $0.lowercased().hasSuffix(step.expect.lowercased()) } ?? false
            last = line
            ok = ok && pass
            say("\(pass ? "통과" : "실패") \(step.label): 기대 …\(step.expect) / 실제 \(line.map { "…" + String($0.suffix(60)) } ?? "(읽지 못함)")")
        }
        usleep(300_000)
        say("마지막 줄: \(last ?? "(읽지 못함)")")
        DistributedNotificationCenter.default().postNotificationName(
            Controller.statusRequest, object: nil, userInfo: nil, deliverImmediately: true)
        usleep(400_000)
        if let status = try? String(contentsOf: Controller.statusURL, encoding: .utf8) { say("본 앱 상태: \(status)") }
        say(ok ? "결과: 모두 통과" : "결과: 실패 있음")
        return ok
    }

    private static func currentSourceID() -> String {
        InputSources.current().flatMap { InputSources.string($0, kTISPropertyInputSourceID) } ?? "?"
    }

    /// Last non-empty line of the focused text element, trailing spaces removed.
    private static func lastLine(of pid: pid_t) -> String? {
        let app = AXUIElementCreateApplication(pid)
        AXUIElementSetMessagingTimeout(app, 1)
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(app, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
        var value: CFTypeRef?
        guard AXUIElementCopyAttributeValue(focused as! AXUIElement, kAXValueAttribute as CFString, &value) == .success,
              let text = value as? String else { return nil }
        let rows = text.split(whereSeparator: { $0 == "\n" || $0 == "\r" || $0 == "\u{2028}" })
            .map { String($0).replacingOccurrences(of: "\u{00A0}", with: " ") }
            .map { $0.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression) }
            .filter { !$0.isEmpty }
        return rows.last
    }
}
