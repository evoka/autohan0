import AppKit

let arguments = CommandLine.arguments

if arguments.contains("--selftest") {
    exit(SelfTest.run() ? 0 : 1)
}
if arguments.contains("--inject") {
    exit(Injector.run(freshLine: arguments.contains("--fresh-line")) ? 0 : 1)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()
