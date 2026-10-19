// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "autohan0",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "autohan0",
            path: "Sources/autohan0",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("Carbon"),
                .linkedFramework("JavaScriptCore"),
                .linkedFramework("ServiceManagement"),
            ]
        ),
    ]
)
