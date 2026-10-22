import AppKit
import ApplicationServices
import Carbon

/// Decides which focus notifications mean "the caret is somewhere else now".
///
/// Chrome reports focus on a suggestion list item while the user keeps typing in the combo box
/// (Google Calendar's guests field, address bars, search boxes), and window notices with the same
/// field still focused. Neither moves the caret: keys still go to the field. Only another text
/// field getting focus does (keys, clicks and app switches are caught elsewhere).
struct FocusFilter<Element> {
    let same: (Element, Element) -> Bool
    /// the text field keys were going to
    private(set) var field: Element?

    init(same: @escaping (Element, Element) -> Bool) {
        self.same = same
    }

    /// Start of observation (app activated): remember the focused field without committing.
    mutating func attached(to element: Element?, editable: Bool) {
        field = editable ? element : nil
    }

    /// A focus notification arrived; `element` is what is focused now. True: commit and forget.
    mutating func focusChanged(to element: Element?, editable: Bool) -> Bool {
        guard let element, editable else { return false }
        if let field, same(field, element) { return false }
        field = element
        return true
    }
}

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
    private var filter = FocusFilter<AXUIElement>(same: { CFEqual($0, $1) })

    private static let textRoles: Set<String> = [
        kAXTextFieldRole as String, kAXTextAreaRole as String, kAXComboBoxRole as String, "AXSearchField",
    ]

    /// Can the user type into this element (text field, text area, combo box, contenteditable)?
    static func isTextInput(_ el: AXUIElement) -> Bool {
        var role: CFTypeRef?
        if AXUIElementCopyAttributeValue(el, kAXRoleAttribute as CFString, &role) == .success,
           let r = role as? String, textRoles.contains(r) {
            return true
        }
        var settable: DarwinBoolean = false
        return AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable) == .success && settable.boolValue
    }

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
            let focused = me.focusedElement()
            if me.filter.focusChanged(to: focused, editable: focused.map(FocusWatcher.isTextInput) ?? false) {
                me.onFocusChanged?()
            }
            me.checkFocusedElement()
        }
        if AXObserverCreate(newPid, callback, &obs) == .success, let obs {
            let refcon = Unmanaged.passUnretained(self).toOpaque()
            AXObserverAddNotification(obs, el, kAXFocusedUIElementChangedNotification as CFString, refcon)
            CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
            observer = obs
        }
        let focused = focusedElement()
        filter.attached(to: focused, editable: focused.map(FocusWatcher.isTextInput) ?? false)
        checkFocusedElement()
    }

    private func focusedElement() -> AXUIElement? {
        guard let appElement else { return nil }
        var focused: CFTypeRef?
        guard AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &focused) == .success,
              let focused, CFGetTypeID(focused) == AXUIElementGetTypeID() else { return nil }
        return (focused as! AXUIElement)
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
