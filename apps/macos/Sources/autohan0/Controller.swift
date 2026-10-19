import AppKit
import ApplicationServices
import Carbon
import ServiceManagement

/// Builds and sends the keyboard events that apply an engine edit: Backspace × n, then the text.
final class Typist {
    /// eventSourceUserData of every event autohan0 synthesizes, so its own tap lets them through.
    static let marker: Int64 = 0x6175_7468_616E // "authan"
    private let source = CGEventSource(stateID: .privateState)

    func events(deleteCount: Int, insert: String) -> [CGEvent] {
        var out: [CGEvent] = []
        out.reserveCapacity(2 * (deleteCount + insert.count))
        for _ in 0..<deleteCount { out += key(KeyCode.delete) }
        for ch in insert {
            if ch == "\n" { out += key(KeyCode.returnKey); continue }
            let units = Array(String(ch).utf16)
            for down in [true, false] {
                guard let e = CGEvent(keyboardEventSource: source, virtualKey: 0, keyDown: down) else { continue }
                e.flags = []
                e.keyboardSetUnicodeString(stringLength: units.count, unicodeString: units)
                out.append(e)
            }
        }
        return out
    }

    private func key(_ code: Int) -> [CGEvent] {
        [true, false].compactMap { down in
            let e = CGEvent(keyboardEventSource: source, virtualKey: CGKeyCode(code), keyDown: down)
            e?.flags = []
            return e
        }
    }

    /// Inside the tap callback pass its proxy: the events then go to the app right after this tap,
    /// ahead of any key the user pressed later. Without a proxy they are posted to the session.
    func send(_ events: [CGEvent], proxy: CGEventTapProxy?) {
        for e in events {
            e.setIntegerValueField(.eventSourceUserData, value: Self.marker)
            if let proxy { e.tapPostEvent(proxy) } else { e.post(tap: .cgSessionEventTap) }
        }
    }
}

/// Per-key timing of the event tap (shown in the menu, written by --selftest for the engine alone).
struct KeyStats {
    private(set) var count = 0
    private(set) var engineNs: UInt64 = 0
    private(set) var totalNs: UInt64 = 0
    private(set) var maxTotalNs: UInt64 = 0

    mutating func add(engine: UInt64, total: UInt64) {
        count += 1
        engineNs += engine
        totalNs += total
        maxTotalNs = max(maxTotalNs, total)
    }

    var summary: String? {
        guard count > 0 else { return nil }
        let eng = Double(engineNs) / Double(count) / 1000
        let tot = Double(totalNs) / Double(count) / 1000
        return String(format: "키당 처리 평균 %.0f µs (엔진 %.0f µs) · 최대 %.1f ms · %d키", tot, eng, Double(maxTotalNs) / 1e6, count)
    }
}

/// The app's brain: owns the engine, the event tap, the input-source policy and the settings.
final class Controller: NSObject {
    enum State: Equatable {
        case loading, failed, needsPermission, off, excluded, bypass, active
    }

    /// Called on the main thread whenever something shown in the menu bar may have changed.
    var onChange: (() -> Void)?

    private(set) var settings = Store.loadSettings()
    private(set) var bridge: EngineBridge?
    private(set) var loadError: String?
    private(set) var mode: Mode = .en
    private(set) var trusted = AXIsProcessTrusted()
    private(set) var frontApp = NSWorkspace.shared.frontmostApplication
    private(set) var shortcuts = SwitchShortcut.load()
    private(set) var stats = KeyStats()
    let sources = InputSources()
    let focus = FocusWatcher()

    private let typist = Typist()
    private var tap: CFMachPort?
    private var tapSource: CFRunLoopSource?
    private var swallowedKeyUps = Set<Int>()
    /// input-source changes before this time (ms) are undone without counting as the Han/Yeong key
    private var ignoreSwitchUntil = 0.0
    /// when an input-source change last counted as the Han/Yeong key (ms)
    private var lastSwitchToggleAt = -1e9
    private var lastState = State.loading
    private var timers: [Timer] = []
    /// Keeps App Nap from throttling the event tap: every key waits on this process.
    private var activity: NSObjectProtocol?
    /// Edit of a Han/Yeong key press, held back until the OS input source is ABC again
    /// (typed into a Korean input method it would be composed back into Hangul).
    private var pendingEdit: [CGEvent] = []
    private var pendingFlush: DispatchWorkItem?
    /// Recent toggle / input-source events for status.json (never typed text).
    private var trace: [String] = []
    static let statusRequest = Notification.Name("dev.autohan0.status")
    static var statusURL: URL { Store.directory.appendingPathComponent("status.json") }

    var isExcluded: Bool {
        guard let id = frontApp?.bundleIdentifier else { return false }
        return settings.excludedApps.contains(id)
    }

    var state: State {
        if loadError != nil { return .failed }
        if bridge == nil { return .loading }
        if !trusted || tap == nil { return .needsPermission }
        if !settings.enabled { return .off }
        if isExcluded { return .excluded }
        if focus.secure { return .bypass }
        return .active
    }

    static func nowMs() -> Double { ProcessInfo.processInfo.systemUptime * 1000 }

    // MARK: lifecycle

    func start() {
        activity = ProcessInfo.processInfo.beginActivity(options: [.userInitiated, .latencyCritical], reason: "키 입력 처리")
        mode = sources.isOnKorean ? .ko : .en
        sources.onSwitchedAway = { [weak self] at in self?.osSwitchedAway(at: at) }
        DistributedNotificationCenter.default().addObserver(
            self, selector: #selector(writeStatus), name: Self.statusRequest, object: nil,
            suspensionBehavior: .deliverImmediately)
        focus.onFocusChanged = { [weak self] in self?.caretMoved() }
        focus.onSecureChanged = { [weak self] _ in self?.applyState() }
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            self?.appActivated(note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication)
        }
        loadEngine()
        if !trusted {
            AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
        }
        checkPermission()
        var tick = 0
        timers.append(Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            tick += 1
            // every second while waiting for the permission, then every 5 s to notice it being revoked
            if self.tap == nil || tick % 5 == 0 { self.checkPermission() }
        })
        // gksdud and System Settings can change the input-source shortcuts at any time.
        timers.append(Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            self?.shortcuts = SwitchShortcut.load()
        })
    }

    /// Quitting: give the user's Korean input source back if they were typing Korean.
    func shutdown() {
        if let bridge { Store.save(bridge.learned()) }
        if state == .active, mode == .ko { sources.selectKorean() }
    }

    private func loadEngine() {
        guard let url = EngineBridge.defaultScriptURL() else {
            loadError = "엔진 파일(autohan0-engine.js)이 앱 안에 없어요"
            return
        }
        let learned = (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(Store.loadLearned()))) ?? []
        let options: [String: Any] = ["mode": mode.rawValue, "layout": settings.layout, "learned": learned]
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            do {
                let b = try EngineBridge(scriptURL: url, options: options)
                b.warmup()
                DispatchQueue.main.async {
                    guard let self else { return }
                    b.setMode(self.mode) // the user may have switched while the models were built
                    self.bridge = b
                    self.applyState()
                }
            } catch {
                DispatchQueue.main.async {
                    self?.loadError = "\(error)"
                    self?.applyState()
                }
            }
        }
    }

    private func checkPermission() {
        let now = AXIsProcessTrusted()
        if now != trusted || (now && tap == nil) {
            trusted = now
            if now { installTap(); focus.start() } else { removeTap() }
            applyState()
        }
    }

    // MARK: state

    /// Re-evaluate the state; on transitions take or give back the OS input source.
    func applyState() {
        let s = state
        let prev = lastState
        lastState = s
        if s != prev {
            switch s {
            case .active:
                bridge?.setBypass(false)
                bridge?.caretMoved()
                if prev != .bypass {
                    // coming back from off / another app: continue in the language the user was typing
                    let m: Mode = sources.isOnKorean ? .ko : (sources.isOnASCII ? .en : mode)
                    if m != mode || prev == .loading || prev == .needsPermission {
                        bridge?.setMode(m)
                        mode = m
                    }
                }
                ignoreSwitchUntil = Self.nowMs() + 500
                sources.selectASCII()
            case .bypass:
                bridge?.setBypass(true)
            case .off, .excluded:
                bridge?.caretMoved()
                if prev == .active || prev == .bypass, mode == .ko { sources.selectKorean() }
            case .loading, .failed, .needsPermission:
                break
            }
        }
        onChange?()
    }

    private func setMode(_ m: Mode) {
        guard m != mode else { return }
        mode = m
        DispatchQueue.main.async { [weak self] in self?.onChange?() }
    }

    private func caretMoved() {
        bridge?.caretMoved()
    }

    private func appActivated(_ app: NSRunningApplication?) {
        if app?.bundleIdentifier == Bundle.main.bundleIdentifier { return } // our own alerts
        frontApp = app
        // "Automatically switch to a document's input source" may switch right after activation.
        ignoreSwitchUntil = Self.nowMs() + 500
        caretMoved()
        applyState()
        if state == .active { sources.selectASCII() }
    }

    /// Caps Lock, 🌐, the input menu or a shortcut switched away from ABC (macOS acts on its
    /// input-source shortcuts even when the tap swallows them).
    private func osSwitchedAway(at: Double) {
        guard state == .active, let bridge else { return }
        sources.selectASCII()
        verifyASCIISoon()
        if !pendingEdit.isEmpty { schedulePendingFlush(after: 0.05) }
        if at < ignoreSwitchUntil {
            note("input source → \(sources.currentID): switched back (already handled)")
            return
        }
        // One switch can be announced twice within a few ms (or read stale right after our switch back);
        // a real second press comes 100+ ms later.
        if at - lastSwitchToggleAt < 100 {
            note("input source → \(sources.currentID): duplicate notice ignored")
            return
        }
        lastSwitchToggleAt = at
        // Our own switch back to ABC is filtered out by InputSources, so a quick second press still counts.
        let a = bridge.toggle(now: at)
        setMode(a.mode)
        note("input source changed: Han/Yeong → \(a.mode.rawValue), edit \(a.hasEdit)")
        if a.hasEdit { deferEdit(typist.events(deleteCount: a.deleteCount, insert: a.insert), after: 0.05) }
        if a.learnedChanged { saveLearned() }
    }

    // MARK: Han/Yeong edits

    private func deferEdit(_ evs: [CGEvent], after delay: TimeInterval) {
        pendingEdit += evs
        schedulePendingFlush(after: delay)
    }

    private func schedulePendingFlush(after delay: TimeInterval) {
        pendingFlush?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.flushPending(proxy: nil) }
        pendingFlush = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    /// Type the held-back edit now (from the tap: before the event being handled, keeping order).
    private func flushPending(proxy: CGEventTapProxy?) {
        guard !pendingEdit.isEmpty else { return }
        pendingFlush?.cancel()
        pendingFlush = nil
        sources.selectASCII()
        let evs = pendingEdit
        pendingEdit = []
        typist.send(evs, proxy: proxy)
        note("edit applied (\(evs.count / 2) keys) on \(sources.currentID)")
    }

    /// The OS may finish its own switch after ours: make sure ABC wins.
    private func verifyASCIISoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            guard let self, self.state == .active, !self.sources.isOnASCII else { return }
            self.note("input source still \(self.sources.currentID): selecting ABC again")
            self.sources.selectASCII()
        }
    }

    // MARK: status

    private func note(_ s: String) {
        trace.append(String(format: "%.0f ", Self.nowMs()) + s)
        if trace.count > 40 { trace.removeFirst(trace.count - 40) }
    }

    /// Answer to the "dev.autohan0.status" distributed notification (used by --inject).
    @objc private func writeStatus() {
        let status: [String: Any] = [
            "state": "\(state)", "mode": mode.rawValue, "layout": settings.layout, "trusted": trusted,
            "tap": tap != nil, "inputSource": sources.currentID, "shortcuts": shortcuts.map(AppDelegate.describe),
            "stats": stats.summary ?? "", "trace": trace,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: status, options: [.prettyPrinted, .sortedKeys]) else { return }
        try? FileManager.default.createDirectory(at: Store.directory, withIntermediateDirectories: true)
        try? data.write(to: Self.statusURL, options: .atomic)
    }

    // MARK: menu actions

    func setEnabled(_ on: Bool) {
        settings.enabled = on
        Store.save(settings)
        applyState()
    }

    func setLayout(_ id: String) {
        settings.layout = id
        Store.save(settings)
        bridge?.setLayout(id)
        onChange?()
    }

    func setShiftSpaceToggle(_ on: Bool) {
        settings.shiftSpaceToggle = on
        Store.save(settings)
    }

    func toggleExcluded(_ bundleID: String) {
        if let i = settings.excludedApps.firstIndex(of: bundleID) {
            settings.excludedApps.remove(at: i)
        } else {
            settings.excludedApps.append(bundleID)
        }
        Store.save(settings)
        applyState()
    }

    var learned: [LearnedEntry] { bridge?.learned() ?? [] }

    func forget(_ e: LearnedEntry) {
        bridge?.forget(keys: e.keys, mode: e.mode)
        saveLearned()
    }

    func forgetAll() {
        bridge?.forgetAll()
        saveLearned()
    }

    private func saveLearned() {
        if let bridge { Store.save(bridge.learned()) }
    }

    // MARK: event tap

    private func installTap() {
        guard tap == nil else { return }
        let types: [CGEventType] = [.keyDown, .keyUp, .leftMouseDown, .rightMouseDown, .otherMouseDown]
        let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
        let callback: CGEventTapCallBack = { proxy, type, event, refcon in
            let me = Unmanaged<Controller>.fromOpaque(refcon!).takeUnretainedValue()
            return me.handle(proxy: proxy, type: type, event: event)
        }
        guard let t = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .defaultTap,
                                        eventsOfInterest: mask, callback: callback,
                                        userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return }
        let src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, t, 0)
        CFRunLoopAddSource(CFRunLoopGetMain(), src, .commonModes)
        CGEvent.tapEnable(tap: t, enable: true)
        tap = t
        tapSource = src
    }

    private func removeTap() {
        if let tapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapSource, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        tapSource = nil
    }

    private func handle(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent) -> Unmanaged<CGEvent>? {
        let pass = Unmanaged.passUnretained(event)
        switch type {
        case .tapDisabledByTimeout, .tapDisabledByUserInput:
            if let tap { CGEvent.tapEnable(tap: tap, enable: true) }
            return pass
        case .leftMouseDown, .rightMouseDown, .otherMouseDown:
            flushPending(proxy: proxy) // still belongs where the caret was
            caretMoved() // a click can move the caret anywhere
            focus.checkSoon()
            return pass
        case .keyDown, .keyUp:
            break
        default:
            return pass
        }
        if event.getIntegerValueField(.eventSourceUserData) == Typist.marker { return pass }
        let keyCode = Int(event.getIntegerValueField(.keyboardEventKeycode))
        if type == .keyUp {
            return swallowedKeyUps.remove(keyCode) != nil ? nil : pass
        }
        let flags = event.flags
        let isRepeat = event.getIntegerValueField(.keyboardEventAutorepeat) != 0

        // ⌃⌥W turns autohan0 on and off in every state.
        if keyCode == KeyCode.w, flags.contains(.maskControl), flags.contains(.maskAlternate), !flags.contains(.maskCommand) {
            swallowedKeyUps.insert(keyCode)
            if !isRepeat { DispatchQueue.main.async { [weak self] in self.map { $0.setEnabled(!$0.settings.enabled) } } }
            return nil
        }
        guard state == .active, let bridge else { return pass }
        let t0 = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        let now = Self.nowMs()

        // The user's input-source shortcut (and optionally Shift+Space) is the Han/Yeong key.
        let modsOnly = flags.rawValue & SwitchShortcut.relevant
        if shortcuts.contains(where: { $0.matches(keyCode: keyCode, flags: flags) })
            || (settings.shiftSpaceToggle && keyCode == KeyCode.space && modsOnly == CGEventFlags.maskShift.rawValue) {
            swallowedKeyUps.insert(keyCode)
            if !isRepeat {
                let a = bridge.toggle(now: now)
                setMode(a.mode)
                // macOS still switches the input source for its own shortcut: that switch is undone in
                // osSwitchedAway without counting twice, and the edit waits until ABC is back.
                ignoreSwitchUntil = now + 600
                if a.hasEdit { deferEdit(typist.events(deleteCount: a.deleteCount, insert: a.insert), after: 0.25) }
                verifyASCIISoon()
                DispatchQueue.main.async { [weak self] in
                    self?.note("shortcut \(keyCode): Han/Yeong → \(a.mode.rawValue), edit \(a.hasEdit)")
                    if a.learnedChanged { self?.saveLearned() }
                }
            }
            return nil
        }
        // A held-back Han/Yeong edit goes before this key (another Han/Yeong press just appends to it).
        if !pendingEdit.isEmpty { flushPending(proxy: proxy) }
        // 🌐 + key (system shortcuts), arrows, Home/End, F-keys: the caret or focus may move.
        if flags.contains(.maskSecondaryFn) {
            bridge.caretMoved()
            return pass
        }

        var mods = 0
        if flags.contains(.maskShift) { mods |= EngineMod.shift }
        if flags.contains(.maskAlphaShift) { mods |= EngineMod.capsLock }
        if flags.contains(.maskControl) { mods |= EngineMod.control }
        if flags.contains(.maskAlternate) { mods |= EngineMod.option }
        if flags.contains(.maskCommand) { mods |= EngineMod.command }
        let a = bridge.keyDown(keyCode, mods: mods, now: now)
        let t1 = clock_gettime_nsec_np(CLOCK_UPTIME_RAW)
        setMode(a.mode)
        if a.learnedChanged { DispatchQueue.main.async { [weak self] in self?.saveLearned() } }
        guard a.consume else {
            stats.add(engine: t1 - t0, total: clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - t0)
            return pass
        }
        var evs = typist.events(deleteCount: a.deleteCount, insert: a.insert)
        if a.thenOriginal, let original = event.copy() {
            evs.append(original) // Return keeps its own meaning (send, run) after the fix-up
        } else {
            swallowedKeyUps.insert(keyCode)
        }
        typist.send(evs, proxy: proxy)
        stats.add(engine: t1 - t0, total: clock_gettime_nsec_np(CLOCK_UPTIME_RAW) - t0)
        return nil
    }

    /// Put autohan0 (back) into the Accessibility list, e.g. after a rebuild invalidated the old entry.
    func requestPermission() {
        AXIsProcessTrustedWithOptions([kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary)
    }

    // MARK: login item

    var opensAtLogin: Bool { SMAppService.mainApp.status == .enabled }

    func setOpensAtLogin(_ on: Bool) throws {
        if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
    }
}
