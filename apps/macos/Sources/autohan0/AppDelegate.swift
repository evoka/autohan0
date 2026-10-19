import AppKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let controller = Controller()
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()

    private static let layouts: [(id: String, label: String)] = [("3f", "세벌식 최종"), ("39", "세벌식 390")]
    private static let conflictingApps: [(id: String, name: String)] = [("io.gksdud.inputswitch", "gksdud")]

    func applicationDidFinishLaunching(_ notification: Notification) {
        let me = ProcessInfo.processInfo.processIdentifier
        if let id = Bundle.main.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: id).contains(where: { $0.processIdentifier != me }) {
            NSApp.terminate(nil) // already running
            return
        }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength) // 22pt, same as other menu bar icons
        statusItem.button?.imagePosition = .imageOnly
        menu.delegate = self
        menu.autoenablesItems = false
        statusItem.menu = menu
        controller.onChange = { [weak self] in self?.updateIcon() }
        controller.start()
        updateIcon()
    }

    func applicationWillTerminate(_ notification: Notification) {
        controller.shutdown()
    }

    // MARK: menu bar icon

    private func updateIcon() {
        guard let button = statusItem?.button else { return }
        let font = NSFont.systemFont(ofSize: 14, weight: .semibold)
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        func title(_ s: String, dim: Bool) -> NSAttributedString {
            NSAttributedString(string: s, attributes: [
                .font: dim ? NSFont.systemFont(ofSize: 11, weight: .medium) : font, // 가A must fit in 22pt
                .foregroundColor: dim ? NSColor.labelColor.withAlphaComponent(0.35) : NSColor.labelColor,
                .paragraphStyle: para,
                .baselineOffset: dim ? 0.5 : 0,
            ])
        }
        let state = controller.state
        if state == .bypass {
            button.attributedTitle = NSAttributedString(string: "")
            button.image = NSImage(systemSymbolName: "lock.fill", accessibilityDescription: "비밀번호 칸")
            button.imagePosition = .imageOnly
        } else {
            button.image = nil
            button.imagePosition = .noImage
            if state == .active {
                button.attributedTitle = title(controller.mode == .ko ? "가" : "A", dim: false)
            } else {
                button.attributedTitle = title("가A", dim: true)
            }
        }
        button.toolTip = "autohan0 — \(statusText(state))"
    }

    private func statusText(_ state: Controller.State) -> String {
        switch state {
        case .loading: return "엔진을 불러오는 중이에요"
        case .failed: return "엔진을 불러오지 못했어요: \(controller.loadError ?? "")"
        case .needsPermission: return "손쉬운 사용 권한이 필요해요"
        case .off: return "자동 한/영 변환 꺼짐"
        case .excluded: return "\(frontAppName ?? "이 앱")에서는 꺼 두었어요"
        case .bypass: return "비밀번호 칸: 친 그대로 입력해요"
        case .active:
            let layout = Self.layouts.first { $0.id == controller.settings.layout }?.label ?? controller.settings.layout
            return "자동 변환 중 · \(controller.mode == .ko ? "가" : "A") · \(layout)"
        }
    }

    private var frontAppName: String? { controller.frontApp?.localizedName }

    // MARK: menu

    func menuNeedsUpdate(_ menu: NSMenu) {
        menu.removeAllItems()
        let state = controller.state
        let s = controller.settings

        menu.addItem(info(statusText(state)))
        let toggle = item(s.enabled ? "자동 한/영 변환 끄기" : "자동 한/영 변환 켜기", #selector(toggleEnabled))
        toggle.keyEquivalent = "w"
        toggle.keyEquivalentModifierMask = [.control, .option]
        menu.addItem(toggle)
        menu.addItem(.separator())

        let layoutMenu = NSMenu()
        for l in Self.layouts {
            let it = item(l.label, #selector(selectLayout(_:)))
            it.representedObject = l.id
            it.state = s.layout == l.id ? .on : .off
            layoutMenu.addItem(it)
        }
        menu.addItem(submenu("자판", layoutMenu))

        menu.addItem(submenu("한/영 키", hanYeongMenu()))

        if let app = controller.frontApp, let id = app.bundleIdentifier {
            let it = item("\(app.localizedName ?? id)에서 끄기", #selector(toggleExcluded(_:)))
            it.representedObject = id
            it.state = s.excludedApps.contains(id) ? .on : .off
            menu.addItem(it)
        }

        menu.addItem(submenu("배운 말", learnedMenu()))
        menu.addItem(.separator())

        if let line = controller.stats.summary { menu.addItem(info(line)) }
        for app in Self.conflictingApps where !NSRunningApplication.runningApplications(withBundleIdentifier: app.id).isEmpty {
            menu.addItem(info("⚠︎ \(app.name)도 실행 중이에요. 키 입력이 겹칠 수 있어요"))
        }
        let perm = item(state == .needsPermission ? "손쉬운 사용 권한 켜기…" : "손쉬운 사용 권한 설정 열기…", #selector(openAccessibility))
        menu.addItem(perm)
        let login = item("로그인할 때 열기", #selector(toggleLogin))
        login.state = controller.opensAtLogin ? .on : .off
        menu.addItem(login)
        menu.addItem(.separator())
        let quit = item("autohan0 종료", #selector(quit))
        quit.keyEquivalent = "q"
        menu.addItem(quit)
    }

    private func hanYeongMenu() -> NSMenu {
        let m = NSMenu()
        m.autoenablesItems = false
        m.addItem(info("평소 입력 소스를 바꾸는 키를 한/영 키로 써요"))
        m.addItem(info("· Caps Lock, 🌐 (입력 소스가 바뀌면 감지)"))
        for sc in controller.shortcuts {
            m.addItem(info("· \(Self.describe(sc)) (입력 소스 단축키)"))
        }
        m.addItem(.separator())
        let ss = item("Shift+Space도 한/영 키로 쓰기", #selector(toggleShiftSpace))
        ss.state = controller.settings.shiftSpaceToggle ? .on : .off
        m.addItem(ss)
        return m
    }

    private func learnedMenu() -> NSMenu {
        let m = NSMenu()
        m.autoenablesItems = false
        let learned = controller.learned
        if learned.isEmpty {
            m.addItem(info("아직 없어요. 같은 말을 한/영 키로 세 번 되돌리면 배워요"))
            return m
        }
        m.addItem(info("눌러서 지우기 — 지우면 다시 자동으로 바꿔요"))
        for e in learned.sorted(by: { $0.keys < $1.keys }) {
            let it = item("\(e.text)  (\(e.mode == "ko" ? "가" : "A") 상태에서 \(e.keys))", #selector(forgetLearned(_:)))
            it.representedObject = [e.keys, e.mode]
            m.addItem(it)
        }
        m.addItem(.separator())
        m.addItem(item("모두 지우기", #selector(forgetAllLearned)))
        return m
    }

    private func item(_ title: String, _ action: Selector) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: action, keyEquivalent: "")
        it.target = self
        return it
    }

    private func info(_ title: String) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.isEnabled = false
        return it
    }

    private func submenu(_ title: String, _ sub: NSMenu) -> NSMenuItem {
        let it = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        it.submenu = sub
        return it
    }

    static func describe(_ sc: SwitchShortcut) -> String {
        var s = ""
        if sc.modifiers & CGEventFlags.maskControl.rawValue != 0 { s += "⌃" }
        if sc.modifiers & CGEventFlags.maskAlternate.rawValue != 0 { s += "⌥" }
        if sc.modifiers & CGEventFlags.maskShift.rawValue != 0 { s += "⇧" }
        if sc.modifiers & CGEventFlags.maskCommand.rawValue != 0 { s += "⌘" }
        let fkeys: [Int: String] = [0x7A: "F1", 0x78: "F2", 0x63: "F3", 0x76: "F4", 0x60: "F5", 0x61: "F6", 0x62: "F7",
                                    0x64: "F8", 0x65: "F9", 0x6D: "F10", 0x67: "F11", 0x6F: "F12", 0x69: "F13",
                                    0x6B: "F14", 0x71: "F15", 0x6A: "F16", 0x40: "F17", 0x4F: "F18", 0x50: "F19", 0x5A: "F20"]
        if sc.keyCode == KeyCode.space { return s + "Space" }
        if let f = fkeys[sc.keyCode] { return s + f }
        if let p = QwertyKeys.pairs.first(where: { $0.0 == sc.keyCode }) { return s + String(p.2) }
        return s + "키 \(sc.keyCode)"
    }

    // MARK: actions

    @objc private func toggleEnabled() { controller.setEnabled(!controller.settings.enabled) }

    @objc private func selectLayout(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { controller.setLayout(id) }
    }

    @objc private func toggleExcluded(_ sender: NSMenuItem) {
        if let id = sender.representedObject as? String { controller.toggleExcluded(id) }
    }

    @objc private func toggleShiftSpace() { controller.setShiftSpaceToggle(!controller.settings.shiftSpaceToggle) }

    @objc private func forgetLearned(_ sender: NSMenuItem) {
        guard let kv = sender.representedObject as? [String], kv.count == 2 else { return }
        controller.forget(LearnedEntry(keys: kv[0], mode: kv[1], text: "", count: 0))
    }

    @objc private func forgetAllLearned() { controller.forgetAll() }

    @objc private func openAccessibility() {
        if controller.state == .needsPermission { controller.requestPermission() }
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func toggleLogin() {
        do {
            try controller.setOpensAtLogin(!controller.opensAtLogin)
        } catch {
            let alert = NSAlert()
            alert.messageText = "로그인 항목을 바꾸지 못했어요"
            alert.informativeText = error.localizedDescription
            NSApp.activate(ignoringOtherApps: true)
            alert.runModal()
        }
    }

    @objc private func quit() { NSApp.terminate(nil) }
}
