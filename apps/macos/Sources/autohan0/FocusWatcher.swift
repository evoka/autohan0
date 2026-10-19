import AppKit
import ApplicationServices
import Carbon

/// Watches keyboard focus in the frontmost app through the Accessibility API:
/// focus moves mean the text before the caret is unknown (commit), and a focused password
/// field means autohan0 must type exactly what was pressed (bypass).
final class FocusWatcher {
    var onFocusChanged: (() -> Void)?
    /// Called when "a password field is focused" flips.
    var onSecureChanged: ((Bool) -> Void)?

    private var observer: AXObserver?
    private var appElement: AXUIElement?
    private var pid: pid_t = 0
    private(set) var secure = false
    private var focusedIsSecureField = false
    private var timer: Timer?

    init() {
        NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main
        ) { [weak self] note in
            let app = note.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            self?.attach(app?.processIdentifier ?? 0)
        }
        // Secure Event Input (password fields in most apps) can toggle without a focus notification.
        timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.refresh() }
        timer?.tolerance = 0.1
    }

    /// Start observing the frontmost app (call once permission is granted).
    func start() {
        attach(NSWorkspace.shared.frontmostApplication?.processIdentifier ?? 0)
    }

    private func attach(_ newPid: pid_t) {
        if let observer {
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(observer), .defaultMode)
        }
        observer = nil
        appElement = nil
        pid = newPid
        guard newPid > 0, AXIsProcessTrusted() else { return refresh() }
        let el = AXUIElementCreateApplication(newPid)
        AXUIElementSetMessagingTimeout(el, 0.1)
        appElement = el
        var obs: AXObserver?
        let callback: AXObserverCallback = { _, _, _, refcon in
            guard let refcon else { return }
            let me = Unmanaged<FocusWatcher>.fromOpaque(refcon).takeUnretainedValue()
            me.onFocusChanged?()
            me.checkFocusedElement()
        }
        if AXObserverCreate(newPid, callback, &obs) == .success, let obs {
            let refcon = Unmanaged.passUnretained(self).toOpaque()
            AXObserverAddNotification(obs, el, kAXFocusedUIElementChangedNotification as CFString, refcon)
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
            observer = obs
        }
        checkFocusedElement()
    }

    /// Re-read the focused element soon (after a click focus may have moved without a notification).
    func checkSoon() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { [weak self] in self?.checkFocusedElement() }
    }

    func checkFocusedElement() {
        focusedIsSecureField = false
        if let appElement {
            var focused: CFTypeRef?
            if AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
               let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() {
                let el = focused as! AXUIElement
                var subrole: CFTypeRef?
                if AXUIElementCopyAttributeValue(el, kAXSubroleAttribute as CFString, &subrole) == .success {
                    focusedIsSecureField = (subrole as? String) == (kAXSecureTextFieldSubrole as String)
                }
            }
        }
        refresh()
    }

    private func refresh() {
        let now = IsSecureEventInputEnabled() || focusedIsSecureField
        if now != secure {
            secure = now
            onSecureChanged?(now)
        }
    }
}
