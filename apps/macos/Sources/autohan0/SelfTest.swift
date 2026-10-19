import Foundation

/// `autohan0 --selftest`: runs SPEC section 7 through the same path the event tap uses
/// (macOS key code + modifiers -> JavaScriptCore -> packed HostAction -> edit applied to a
/// simulated text field) and measures the per-key cost of that call. Needs no permissions.
enum SelfTest {
    /// A text field that applies HostActions the way the event tap does.
    final class Field {
        var scalars: [Unicode.Scalar] = []
        var text: String { String(String.UnicodeScalarView(scalars)) }

        func native(_ ch: Character) {
            if ch == "\u{8}" {
                if !scalars.isEmpty { scalars.removeLast() }
            } else {
                scalars.append(contentsOf: ch.unicodeScalars)
            }
        }

        func apply(_ a: HostAction, native ch: Character?) {
            if !a.consume {
                if let ch { native(ch) }
                return
            }
            scalars.removeLast(min(a.deleteCount, scalars.count))
            scalars.append(contentsOf: a.insert.unicodeScalars)
            if a.thenOriginal, let ch { native(ch) }
        }
    }

    final class Session {
        let bridge: EngineBridge
        let field = Field()
        var clock = 10_000.0

        init(_ bridge: EngineBridge, mode: Mode, layout: String = "3f") {
            self.bridge = bridge
            bridge.reset(options: ["mode": mode.rawValue, "layout": layout])
        }

        /// QWERTY keys: ' ' space, '\n' return, '\u{8}' backspace, '⇄' Han/Yeong key. 120 ms apart.
        func type(_ s: String) {
            for ch in s {
                clock += 120
                if ch == "⇄" {
                    field.apply(bridge.toggle(now: clock), native: nil)
                } else if ch == "\u{8}" {
                    field.apply(bridge.keyDown(KeyCode.delete, mods: 0, now: clock), native: ch)
                } else if let k = QwertyKeys.key(for: ch) {
                    field.apply(bridge.keyDown(k.code, mods: k.shift ? EngineMod.shift : 0, now: clock), native: ch)
                } else {
                    fatalError("no key for \(ch)")
                }
            }
        }

        var mode: Mode { bridge.mode }
    }

    struct Case {
        let id: String
        let required: Bool
        let run: (EngineBridge) -> (ok: Bool, got: String)
    }

    /// Typical acceptance case: start mode, keys, expected field text, optional expected mode.
    static func simple(_ id: String, _ start: Mode, _ keys: String, _ expect: String, mode: Mode? = nil,
                       layout: String = "3f", required: Bool = true) -> Case {
        Case(id: id, required: required) { b in
            let s = Session(b, mode: start, layout: layout)
            s.type(keys)
            let ok = s.field.text == expect && (mode == nil || s.mode == mode)
            return (ok, "\(s.field.text) [\(s.mode == .ko ? "가" : "A")]")
        }
    }

    static let cases: [Case] = [
        Case(id: "1", required: true) { b in
            let s = Session(b, mode: .en)
            s.type("jfshea")
            let mid = s.field.text
            s.type("mfncj4")
            return (mid == "안녕" && s.field.text == "안녕하세요" && s.mode == .ko, "jfshea→\(mid), 끝→\(s.field.text) [\(s.mode == .ko ? "가" : "A")]")
        },
        simple("2", .en, "jfshea", "안녕"),
        simple("3", .ko, "git push origin main", "git push origin main", mode: .en),
        simple("4", .ko, "hello", "hello"),
        simple("5", .ko, "npm test", "npm test"),
        simple("6a", .en, "AIy/", "AI로"),
        simple("6b", .en, "AIyv", "AI로"),
        simple("7", .en, "deploymr2hgsuc jcytkf hfj4", "deploy했는데 에러가 나요"),
        simple("8", .en, "Q4 y/ugir3 o/jfs k/aj5ugyej4", "Q4 로드맵 초안 공유드려요"),
        simple("9", .en, "Figma yda0g ;/hrugydwkcj4", "Figma 링크 보내드릴게요"),
        simple("10", .en, "READMEjc ntwod ;fa;t3 o9kfmrl9t\nnpm testu/ u/wyel9t", "README에 설치 방법 추가해줘\nnpm test도 돌려줘"),
        simple("11", .en, "hr kfXjgy/", "내 값으로"),
        simple("12", .en, "kktl9t", "꺼줘"),
        simple("13a", .en, "jd@jt2uf", "읽었다"),
        simple("13b", .en, "jdwxjt2uf", "읽었다"),
        simple("14", .en, "k/rsofSjfj4", "괜찮아요"),
        simple("15", .en, "l/1jfj4", "좋아요"),
        simple("16a", .en, "TV", "TV"),
        simple("16b", .en, "README", "README"),
        simple("16c", .en, "PR", "PR"),
        simple("17a", .en, "v2", "v2"),
        simple("17b", .en, "build.sh", "build.sh"),
        simple("18", .en, "jfshea⇄", "jfshea", mode: .en),
        simple("19", .en, "jfshea ⇄⇄", "jfshea "),
        Case(id: "20", required: true) { b in
            let s = Session(b, mode: .en)
            s.type("jfshea ")
            let before = s.mode
            s.type("⇄")
            return (s.field.text == "안녕 " && before == .ko && s.mode == .en, "\(s.field.text) [\(s.mode == .ko ? "가" : "A")]")
        },
        Case(id: "21", required: true) { b in
            let s = Session(b, mode: .en)
            for _ in 0..<3 {
                s.field.scalars = []
                s.type("jfshea⇄")
                b.caretMoved()
                b.setMode(.en)
                s.clock += 10_000
            }
            s.field.scalars = []
            s.type("jfshea")
            let learned = b.learned().map(\.keys)
            return (s.field.text == "jfshea" && learned == ["jfshea"], "\(s.field.text), 배운 말 \(learned)")
        },
        simple("22", .en, "jfsheamfncj4", "안녕하세요", layout: "39"),
        simple("24", .ko, "it is", "it is", required: false),
        simple("25", .ko, "pea soup", "pea soup", required: false),
        simple("26", .en, "if jfsheamfncj4", "if 안녕하세요", required: false),
        simple("27", .ko, "yes\n", "yes\n", required: false),
        simple("28", .en, "fori9s", "for문", required: false),
        simple("bs1", .en, "jfshea\u{8}", "안"),
        simple("bs2", .en, "jfshea\u{8}heamfncj4", "안녕하세요"),
        simple("bs3", .en, "deploymr2hgsuc\u{8}\u{8}", "deploy했"),
    ]

    static func now() -> UInt64 { clock_gettime_nsec_np(CLOCK_UPTIME_RAW) }

    static func run() -> Bool {
        guard let url = EngineBridge.defaultScriptURL() else {
            print("엔진 스크립트(autohan0-engine.js)를 찾지 못했습니다")
            return false
        }
        let t0 = now()
        let bridge: EngineBridge
        do {
            bridge = try EngineBridge(scriptURL: url, options: ["mode": "en"])
        } catch {
            print("엔진 로드 실패: \(error)")
            return false
        }
        let loadMs = Double(now() - t0) / 1e6
        print(String(format: "엔진 로드 %.0f ms (모델 만들기 %.0f ms)", loadMs, bridge.initMs))

        // Cold per-key cost before any warm-up (what the first keys after launch would see).
        var cold: [Double] = []
        do {
            let s = Session(bridge, mode: .en)
            for ch in "jfsheamfncj4 " {
                let k = QwertyKeys.key(for: ch)!
                let a = now()
                _ = bridge.keyDown(k.code, mods: k.shift ? EngineMod.shift : 0, now: s.clock)
                cold.append(Double(now() - a) / 1000)
                s.clock += 120
            }
        }

        var failedRequired = 0
        var failedOptional = 0
        for c in cases {
            let r = c.run(bridge)
            if let e = bridge.takeError() { print("  스크립트 오류: \(e)") }
            let tag = r.ok ? "통과" : (c.required ? "실패" : "실패(권장)")
            if !r.ok { if c.required { failedRequired += 1 } else { failedOptional += 1 } }
            print("  #\(c.id.padding(toLength: 4, withPad: " ", startingAt: 0)) \(tag)  \(r.got)")
        }
        print("수용 테스트: \(cases.count - failedRequired - failedOptional)/\(cases.count) 통과 (필수 실패 \(failedRequired), 권장 실패 \(failedOptional))")

        let warm = bridge.warmup()
        print(String(format: "워밍업 %.0f ms", warm))
        print(String(format: "첫 키 13개(워밍업 전): 처음 %.0f µs, 평균 %.0f µs", cold.first ?? 0, cold.reduce(0, +) / Double(max(cold.count, 1))))
        benchmark(bridge)
        return failedRequired == 0
    }

    /// SPEC #23: at least 10,000 keys through keyDown (call + result parsing), per-key wall time.
    static func benchmark(_ bridge: EngineBridge) {
        let corpus = [
            "jfsheamfncj4", "git push origin main", "deploymr2hgsuc jcytkf hfj4", "Q4 y/ugir3 o/jfs k/aj5ugyej4",
            "Figma yda0g ;/hrugydwkcj4", "READMEjc ntwod ;fa;t3 o9kfmrl9t", "npm testu/ u/wyel9t", "hr kfXjgy/",
            "k/rsofSjfj4", "l/1jfj4", "it is a test of the build.sh script", "fori9s", "pea soup",
        ].joined(separator: " ") + "\n"
        let s = Session(bridge, mode: .en)
        var samples: [Double] = []
        samples.reserveCapacity(12_000)
        while samples.count < 10_000 {
            for ch in corpus {
                let k = QwertyKeys.key(for: ch)!
                s.clock += 90
                let a = now()
                let r = bridge.keyDown(k.code, mods: k.shift ? EngineMod.shift : 0, now: s.clock)
                samples.append(Double(now() - a) / 1000)
                s.field.apply(r, native: ch)
            }
        }
        samples.sort()
        let mean = samples.reduce(0, +) / Double(samples.count)
        func pct(_ p: Double) -> Double { samples[min(samples.count - 1, Int(Double(samples.count) * p))] }
        print(String(format: "키당 지연(%d키, Swift→JSC→Swift): 평균 %.1f µs, 중앙값 %.1f µs, p99 %.1f µs, 최대 %.1f µs",
                     samples.count, mean, pct(0.5), pct(0.99), samples.last ?? 0))
        print(mean < 500 ? "→ 0.5 ms 기준 안쪽: JavaScriptCore(1안) 유지" : "→ 0.5 ms 기준 초과: Swift 포팅(2안) 필요")

        // Typing speed instead of a hot loop: 300 keys 60 ms apart (caches and CPU clock cool down between keys).
        var spaced: [Double] = []
        for ch in corpus.prefix(300) {
            let k = QwertyKeys.key(for: ch)!
            usleep(60_000)
            s.clock += 60
            let a = now()
            let r = bridge.keyDown(k.code, mods: k.shift ? EngineMod.shift : 0, now: s.clock)
            spaced.append(Double(now() - a) / 1000)
            s.field.apply(r, native: ch)
        }
        spaced.sort()
        print(String(format: "키당 지연(%d키, 60 ms 간격): 평균 %.1f µs, 중앙값 %.1f µs, p99 %.1f µs, 최대 %.1f µs",
                     spaced.count, spaced.reduce(0, +) / Double(spaced.count), spaced[spaced.count / 2],
                     spaced[min(spaced.count - 1, spaced.count * 99 / 100)], spaced.last ?? 0))
    }
}
