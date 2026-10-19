import Foundation

struct Settings: Codable, Equatable {
    var enabled = true
    /// "3f" (세벌식 최종) or "39" (세벌식 390)
    var layout = "3f"
    /// bundle identifiers of apps where autohan0 steps aside
    var excludedApps: [String] = []
    /// Shift+Space also works as the Han/Yeong key
    var shiftSpaceToggle = false

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let d = Settings()
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? d.enabled
        layout = try c.decodeIfPresent(String.self, forKey: .layout) ?? d.layout
        excludedApps = try c.decodeIfPresent([String].self, forKey: .excludedApps) ?? d.excludedApps
        shiftSpaceToggle = try c.decodeIfPresent(Bool.self, forKey: .shiftSpaceToggle) ?? d.shiftSpaceToggle
    }
}

/// ~/Library/Application Support/autohan0/{settings,learned}.json
enum Store {
    static let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support")
        return base.appendingPathComponent("autohan0", isDirectory: true)
    }()

    static var settingsURL: URL { directory.appendingPathComponent("settings.json") }
    static var learnedURL: URL { directory.appendingPathComponent("learned.json") }

    static func loadSettings() -> Settings {
        guard let data = try? Data(contentsOf: settingsURL) else { return Settings() }
        return (try? JSONDecoder().decode(Settings.self, from: data)) ?? Settings()
    }

    static func save(_ settings: Settings) {
        write(settings, to: settingsURL)
    }

    static func loadLearned() -> [LearnedEntry] {
        guard let data = try? Data(contentsOf: learnedURL) else { return [] }
        return (try? JSONDecoder().decode([LearnedEntry].self, from: data)) ?? []
    }

    static func save(_ learned: [LearnedEntry]) {
        write(learned, to: learnedURL)
    }

    private static func write<T: Encodable>(_ value: T, to url: URL) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let enc = JSONEncoder()
            enc.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            try enc.encode(value).write(to: url, options: .atomic)
        } catch {
            NSLog("autohan0: could not save \(url.lastPathComponent): \(error)")
        }
    }
}
