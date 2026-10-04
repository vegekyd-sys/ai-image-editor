import XCTest
import StoreKitTest
import StoreKit

@MainActor
final class MakaronStoreKitUITests: XCTestCase {
    private var storeKitSession: SKTestSession?

    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testRegisterWelcomeTopupSubscriptionAndRestore() async throws {
        let email = try await runRegistrationAndWelcome(includePayments: true)
        try runNativeSave(paid: true, emailOverride: email, usePaidFixture: false)
    }

    func testNativeRegistrationAndWelcomeCredits() async throws {
        _ = try await runRegistrationAndWelcome(includePayments: false)
    }

    private func configureStoreKit() throws {
        try requireIsolatedNativeEnvironment()
        let session = try SKTestSession(configurationFileNamed: "MakaronLocal")
        storeKitSession = session
        session.resetToDefaultState()
        session.clearTransactions()
        session.disableDialogs = true
        session.locale = Locale(identifier: "en_US")
        session.storefront = "USA"
        session.timeRate = .realTime
    }

    func testNativeExistingAccountApplePurchaseAndSave() throws {
        guard let email = ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"] else {
            throw XCTSkip("Requires a UI-registered isolated account")
        }
        try configureStoreKit()
        let app = XCUIApplication()
        app.launch()
        try runApplePurchases(app, email: email)
        try runNativeSave(paid: true, emailOverride: email, usePaidFixture: false)
    }

    private func requireIsolatedNativeEnvironment() throws {
        guard ProcessInfo.processInfo.environment["MAKARON_E2E_NATIVE_LOCAL"] == "1" else {
            throw XCTSkip("Requires the isolated local native regression environment")
        }
        let data = try synchronousData(from: URL(string: "http://127.0.0.1:3004/health")!)
        let health = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        XCTAssertEqual(health["e2e"] as? Bool, true)
        XCTAssertEqual(health["supabaseUrl"] as? String, "http://127.0.0.1:55321")
    }

    private func runRegistrationAndWelcome(includePayments: Bool) async throws -> String {
        try requireIsolatedNativeEnvironment()
        if includePayments { try configureStoreKit() }
        let email = ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"]
            ?? "ios-free-media+\(UUID().uuidString.lowercased())@e2e.makaron.test"
        print("IOS_FREE_MEDIA_EMAIL=\(email)")
        let app = XCUIApplication()
        app.launchArguments = ["-AppleLanguages", "(en)", "-AppleLocale", "en_US"]
        app.launch()
        let consent = app.buttons["Allow AI processing and continue"]
        if consent.waitForExistence(timeout: 20) { consent.tap() }
        if app.buttons["Open account menu"].exists {
            tapVisible(app, label: "Open account menu")
            tapVisible(app, label: "Sign out")
        }
        let emailField = app.textFields.matching(identifier: "Email").firstMatch
        if !emailField.waitForExistence(timeout: 3) { tapVisible(app, label: "SIGN IN", timeout: 40) }
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), app.debugDescription)
        emailField.tap()
        emailField.typeText(email)
        let passwords = app.secureTextFields.matching(identifier: "Password")
        XCTAssertTrue(passwords.firstMatch.waitForExistence(timeout: 5))
        let passwordField = passwords.allElementsBoundByIndex.first(where: { $0.isHittable }) ?? passwords.firstMatch
        passwordField.tap()
        passwordField.typeText("E2ePass123!")
        tapVisible(app, label: "Continue")
        let otp = try waitForOTP(email: email, timeout: 30)
        for (index, digit) in otp.enumerated() {
            let field = app.textFields["OTP digit \(index + 1)"]
            XCTAssertTrue(field.waitForExistence(timeout: 10))
            field.tap()
            field.typeText(String(digit))
        }
        XCTAssertTrue(app.staticTexts["Welcome to Makaron!"].waitForExistence(timeout: 40), app.debugDescription)
        XCTAssertTrue(app.staticTexts["500"].exists)
        XCTAssertFalse(webElement(app, identifier: "Start 3-day free trial").exists)
        attachScreenshot(app, name: "new-01-registered-500-welcome")
        tapVisible(app, label: "Start Creating")
        try assertLocalBalance(email: email, expected: 500, applePurchaseCount: 0)
        guard includePayments else { return email }
        try runApplePurchases(app, email: email)
        return email
    }

    private func runApplePurchases(_ app: XCUIApplication, email: String) throws {
        let stateData = try synchronousData(from: localFixtureURL("state", email: email))
        let state = try JSONSerialization.jsonObject(with: stateData) as! [String: Any]
        let purchases = state["purchases"] as! [[String: Any]]
        let appleCount = purchases.filter { ($0["provider"] as? String) == "apple" }.count
        XCTAssertLessThanOrEqual(appleCount, 1, "Start with a new account or resume a verified top-up")
        // Separate hosted/UI runners can reuse numeric StoreKit IDs. Advance
        // the local test counter past retained ledger IDs without crediting
        // any priming purchase, or leaving one for the app to resume.
        let historyData = try synchronousData(from: localFixtureURL("storekit-history", email: email))
        let history = try JSONSerialization.jsonObject(with: historyData) as! [String: Any]
        let previous = history["transactions"] as! [[String: Any]]
        if let last = previous.compactMap({ UInt($0["apple_transaction_id"] as! String) }).max() {
            let session = try XCTUnwrap(storeKitSession)
            var advanced = false
            for _ in 0..<100 {
                try session.buyProduct(productIdentifier: "app.makaron.ios.topup.starter")
                let transaction = try XCTUnwrap(session.allTransactions().last)
                try session.deleteTransaction(identifier: transaction.identifier)
                if transaction.identifier >= last { advanced = true; break }
            }
            guard advanced else { XCTFail("Could not advance local StoreKit test counter"); return }
        }
        tapVisible(app, label: "Open dashboard")
        XCTAssertTrue(app.staticTexts["Apple In-App Purchase"].waitForExistence(timeout: 20), app.debugDescription)
        if appleCount == 0 {
            tapVisible(app, label: "Top Up")
            tapVisible(app, label: "$4.99", timeout: 30)
        }
        assertVisibleBalance(app, expected: 1000)
        try assertLocalBalance(email: email, expected: 1000, applePurchaseCount: 1)
        attachScreenshot(app, name: "new-02-apple-topup-credited")
        tapVisible(app, label: "Plan")
        tapVisible(app, label: "$19.99", timeout: 20)
        assertVisibleBalance(app, expected: 4000)
        try assertLocalBalance(email: email, expected: 4000, applePurchaseCount: 2)
        attachScreenshot(app, name: "new-03-apple-subscription-credited")
        tapVisible(app, label: "Restore Apple Purchase")
        assertVisibleBalance(app, expected: 4000)
        try assertLocalBalance(email: email, expected: 4000, applePurchaseCount: 2)
        attachScreenshot(app, name: "new-04-restore-no-double-credit")
    }

    private func assertVisibleBalance(_ app: XCUIApplication, expected: Int) {
        let formatted = NumberFormatter.localizedString(from: NSNumber(value: expected), number: .decimal)
        let labels = [String(expected), formatted]
        let balance = app.staticTexts.matching(NSPredicate(format: "label IN %@", labels)).firstMatch
        XCTAssertTrue(balance.waitForExistence(timeout: 30), app.debugDescription)
    }

    private func assertLocalBalance(email: String, expected: Int, applePurchaseCount: Int) throws {
        let data = try synchronousData(from: localFixtureURL("state", email: email))
        let state = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        let balance = state["balance"] as! [String: Any]
        XCTAssertEqual(balance["balance"] as? Int, expected)
        let purchases = state["purchases"] as! [[String: Any]]
        let apple = purchases.filter { ($0["provider"] as? String) == "apple" }
        XCTAssertEqual(apple.count, applePurchaseCount)
        for purchase in apple {
            XCTAssertEqual(purchase["apple_environment"] as? String, "Xcode")
            XCTAssertEqual(purchase["status"] as? String, "completed")
            XCTAssertGreaterThan(purchase["amount_usd"] as? Double ?? 0, 0)
            XCTAssertFalse((purchase["apple_transaction_id"] as? String ?? "").hasPrefix("xcode-e2e-"))
        }
    }

    func testNativeFreeImageAndVideoSave() throws {
        try runNativeSave(paid: false)
    }

    func testNativePaidOriginalImageAndVideoSave() throws {
        try runNativeSave(paid: true)
    }

    func testNativeApplePaidOriginalImageAndVideoSave() throws {
        guard let email = ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"] else {
            throw XCTSkip("Requires a UI-registered account with genuine local Apple purchases")
        }
        try requireIsolatedNativeEnvironment()
        try assertLocalBalance(email: email, expected: 4000, applePurchaseCount: 2)
        try runNativeSave(paid: true, emailOverride: email, usePaidFixture: false)
    }

    private func runNativeSave(paid: Bool, emailOverride: String? = nil, usePaidFixture: Bool = true) throws {
        try requireIsolatedNativeEnvironment()
        let email = try XCTUnwrap(emailOverride ?? ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"])
        _ = try synchronousData(from: localFixtureURL("seed", email: email))
        if paid && usePaidFixture { _ = try synchronousData(from: localFixtureURL("paid-fixture", email: email), method: "POST") }
        let mode = paid ? "paid-original" : "free"
        let app = XCUIApplication()
        app.launch()
        allowPhotosPermission()
        if webElement(app, identifier: "← Back to app").waitForExistence(timeout: 5) {
            tapVisible(app, label: "← Back to app")
        }
        tapVisible(app, label: "Projects", timeout: 30)
        let kinds = ProcessInfo.processInfo.environment["MAKARON_E2E_MEDIA_KIND"].map { [$0] } ?? ["Image", "Video"]
        for kind in kinds {
            tapVisible(app, label: "iOS Save \(kind)", timeout: 30)
            if webElement(app, identifier: "Back to canvas").waitForExistence(timeout: 5) {
                tapVisible(app, label: "Back to canvas")
            }
            let previousPhotos = try localPhotoFiles(email: email)
            tapVisible(app, label: "Save", timeout: 30)
            if !paid {
                XCTAssertTrue(app.staticTexts["Free download · Makaron watermark"].waitForExistence(timeout: 15), app.debugDescription)
                if kind == "Video" {
                    tapVisible(app, label: "Play preview")
                    XCTAssertTrue(app.buttons["Pause preview"].waitForExistence(timeout: 10), app.debugDescription)
                }
                attachScreenshot(app, name: "native-\(mode)-\(kind)-preview")
                tapVisible(app, label: "Save")
            }
            allowPhotosPermission(timeout: 5)
            let deadline = Date().addingTimeInterval(90)
            var added = Set<String>()
            while Date() < deadline && added.isEmpty {
                added = try localPhotoFiles(email: email).subtracting(previousPhotos)
                if added.isEmpty { RunLoop.current.run(until: Date().addingTimeInterval(0.3)) }
            }
            XCTAssertEqual(added.count, 1, "No new Photos file: \(app.debugDescription)")
            if kind == "Video" { XCTAssertTrue(added.first?.lowercased().hasSuffix(".mp4") == true || added.first?.lowercased().hasSuffix(".mov") == true) }
            print("IOS_SAVED_\(mode.uppercased())_\(kind.uppercased())=\(added.sorted())")
            if !paid { XCTAssertTrue(app.staticTexts["Free download · Makaron watermark"].waitForNonExistence(timeout: 10)) }
            else { XCTAssertFalse(app.staticTexts["Free download · Makaron watermark"].exists) }
            attachScreenshot(app, name: "native-\(mode)-\(kind)-saved-to-photos")
            tapVisible(app, label: "Back to projects")
            XCTAssertTrue(app.buttons["Back to projects"].waitForNonExistence(timeout: 10))
        }
    }

    private func tapVisible(_ app: XCUIApplication, label: String, timeout: TimeInterval = 10) {
        let predicate = label.hasPrefix("$")
            ? NSPredicate(format: "label ENDSWITH %@", label)
            : NSPredicate(format: "label ==[c] %@ OR identifier == %@", label, label)
        let query = app.descendants(matching: .any).matching(predicate)
        XCTAssertTrue(query.firstMatch.waitForExistence(timeout: timeout), "Missing \(label): \(app.debugDescription)")
        // WebKit can report the covered toolbar as hittable behind a dialog.
        let element = query.allElementsBoundByIndex.last(where: { $0.isHittable }) ?? query.firstMatch
        let frame = element.frame
        XCTAssertFalse(frame.isEmpty, "Empty frame for \(label)")
        app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: frame.midX, dy: frame.midY)).tap()
    }

    private func localFixtureURL(_ endpoint: String, email: String) -> URL {
        var components = URLComponents(string: "http://127.0.0.1:3004/\(endpoint)")!
        components.queryItems = [URLQueryItem(name: "email", value: email)]
        // Form-style query parsing otherwise treats the email's literal + as a space.
        components.percentEncodedQuery = components.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        return components.url!
    }

    private func localPhotoFiles(email: String) throws -> Set<String> {
        let data = try synchronousData(from: localFixtureURL("photos", email: email))
        let response = try JSONSerialization.jsonObject(with: data) as! [String: Any]
        return Set(response["files"] as! [String])
    }

    private func allowPhotosPermission(timeout: TimeInterval = 1) {
        // New iOS permission sheets can be exposed under the app's remote
        // view rather than SpringBoard's alerts collection.
        let applications = [XCUIApplication(), XCUIApplication(bundleIdentifier: "com.apple.springboard")]
        let predicate = NSPredicate(format: "label IN %@ OR label BEGINSWITH[c] 'Allow Access' OR label BEGINSWITH[c] 'Allow Adding'",
                                    ["Allow", "允许", "OK"])
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            for application in applications {
                let allow = application.buttons.matching(predicate).firstMatch
                if allow.exists && allow.isHittable { allow.tap(); return }
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.15))
        }
    }

    func testSubscriptionBeforeRegistrationWithPhotoCarriesSkillAndCredits() throws {
        try runSubscriptionBeforeRegistration(includesPhoto: true)
    }

    func testSubscriptionBeforeRegistrationWithoutPhotoReturnsToSkill() throws {
        try runSubscriptionBeforeRegistration(includesPhoto: false)
    }

    private func runSubscriptionBeforeRegistration(includesPhoto: Bool) throws {
        let email = ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"]
            ?? "ios-e2e+\(UUID().uuidString.lowercased())@e2e.makaron.test"
        let password = "E2ePass123!"
        let app = XCUIApplication()
        app.launchArguments += [
            "--makaron-e2e-local-purchase",
            "-AppleLanguages", "(en)",
            "-AppleLocale", "en_US"
        ]
        app.launch()

        // WKWebView exposes this button's visible aria-label but does not
        // consistently promote its data-testid to accessibilityIdentifier.
        let consent = app.buttons
            .matching(NSPredicate(format: "label == %@", "Allow AI processing and continue"))
            .firstMatch
        // A cold local Next.js compile can finish after the native WebView is
        // already visible. Give the first-run consent document enough time to
        // become accessible before continuing into the seeded Skill flow.
        if consent.waitForExistence(timeout: 20) {
            consent.tap()
        }

        // The native shell persists the last selected home tab. A prior run
        // may therefore reopen on Projects even after the E2E database reset.
        // Always enter Explore explicitly before locating the seeded Skill.
        let explore = webElement(app, identifier: "Explore")
        if explore.waitForExistence(timeout: 5) {
            explore.tap()
        }

        let skill = webElement(app, identifier: "E2E Ending Spirit")
        XCTAssertTrue(skill.waitForExistence(timeout: 30), "Seeded E2E Skill did not load")
        skill.tap()
        attachScreenshot(app, name: "01-skill-detail")

        let uploadPhoto = app.buttons
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Upload photo"))
            .firstMatch
        XCTAssertTrue(uploadPhoto.waitForExistence(timeout: 10), "The guest Skill photo slot did not appear")

        // The home hero and the open Skill sheet intentionally share this copy.
        // Tap the sheet action (the last matching button), not the obscured hero.
        let primaryAction = app.buttons.matching(identifier: "See what happens").element(boundBy: 1)
        XCTAssertTrue(primaryAction.waitForExistence(timeout: 10), "First-use Skill action did not appear")

        let startTrial = webElement(app, identifier: "Start 3-day free trial")
        if includesPhoto {
            uploadPhoto.tap()

            let pickerDone = app.buttons["Done"]
            XCTAssertTrue(pickerDone.waitForExistence(timeout: 15), "Native photo picker did not open")
            // Querying an individual Photos grid asset can deadlock XCUI for two
            // minutes when the iOS 26 remote picker scene is still indexing.
            // The dedicated simulator always contains the fixture as the first
            // grid item, so tap that visible cell by its stable grid position.
            RunLoop.current.run(until: Date().addingTimeInterval(2))
            let firstPhotoPoint = CGVector(
                dx: app.frame.width / 6,
                dy: app.frame.height * 0.42
            )
            var selectedPhoto = false
            for _ in 0..<3 where !selectedPhoto {
                app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
                    .withOffset(firstPhotoPoint)
                    .tap()
                selectedPhoto = XCTWaiter.wait(
                    for: [XCTNSPredicateExpectation(predicate: NSPredicate(format: "isEnabled == true"), object: pickerDone)],
                    timeout: 2
                ) == .completed
            }
            XCTAssertTrue(selectedPhoto, "The injected E2E photo could not be selected")
            pickerDone.tap()

            XCTAssertFalse(startTrial.waitForExistence(timeout: 2), "Selecting a photo must not open the trial paywall")
            attachScreenshot(app, name: "02-photo-selected-before-trial")
        }

        primaryAction.tap()
        XCTAssertTrue(startTrial.waitForExistence(timeout: 15), "Apple trial paywall did not appear after photo selection")
        let startTrialFrame = startTrial.frame
        attachScreenshot(app, name: includesPhoto ? "03-trial-paywall" : "02-trial-paywall-without-photo")
        // WebKit can reclassify this DOM button from AX Switch to AX Button
        // during the paywall animation, invalidating the cached XCUIElement.
        // Tap the frame proven above instead of resolving the stale AX node.
        app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
            .withOffset(CGVector(dx: startTrialFrame.midX, dy: startTrialFrame.midY))
            .tap()

        let emailField = app.textFields.matching(identifier: "Email").firstMatch
        XCTAssertTrue(emailField.waitForExistence(timeout: 20), "Registration screen did not appear after the isolated Xcode purchase")
        XCTAssertTrue(app.keyboards.firstMatch.waitForExistence(timeout: 5), "Registration email field did not automatically summon the keyboard")
        let focusedEmailField = app.textFields
            .matching(identifier: "Email")
            .matching(NSPredicate(format: "hasKeyboardFocus == true"))
            .firstMatch
        XCTAssertTrue(focusedEmailField.waitForExistence(timeout: 3), "The automatically focused Email field was not exposed to UI automation")
        focusedEmailField.typeText(email)

        let passwordField = app.secureTextFields.matching(identifier: "Password").element(boundBy: 1)
        XCTAssertTrue(passwordField.waitForExistence(timeout: 3))
        passwordField.tap()
        passwordField.typeText(password)
        app.buttons.matching(identifier: "Continue").element(boundBy: 1).tap()

        let otp = try waitForOTP(email: email, timeout: 30)
        let firstOTPField = app.textFields.matching(identifier: "OTP digit 1").firstMatch
        XCTAssertTrue(firstOTPField.waitForExistence(timeout: 10), "OTP fields did not appear")
        XCTAssertTrue(app.keyboards.firstMatch.exists, "OTP keyboard was not focused")
        // Drive the visible system keypad directly. WebKit briefly removes the
        // newly focused OTP field from the AX tree while React advances focus,
        // so retargeting the WebView field after every digit is inherently
        // flaky even though the real keyboard remains ready.
        for (index, digit) in otp.enumerated() {
            let key = app.keys[String(digit)]
            if !key.waitForExistence(timeout: 1) {
                // iOS 26 occasionally dismisses the number pad during the
                // React focus handoff. Refocus the exact next cell and resume.
                let field = app.textFields.matching(identifier: "OTP digit \(index + 1)").firstMatch
                XCTAssertTrue(field.waitForExistence(timeout: 3), "OTP digit \(index + 1) field was unavailable")
                field.tap()
            }
            XCTAssertTrue(key.waitForExistence(timeout: 3), "OTP keypad digit \(digit) was unavailable")
            if key.isHittable {
                key.tap()
            } else {
                // The iOS 26 remote number pad can expose a valid key frame
                // while XCUIElement.tap() tries to scroll it and resolves to
                // {-1,-1}. Tap the already-proven visible frame directly.
                let keyFrame = key.frame
                if !keyFrame.isEmpty && app.frame.intersects(keyFrame) {
                    app.coordinate(withNormalizedOffset: CGVector(dx: 0, dy: 0))
                        .withOffset(CGVector(dx: keyFrame.midX, dy: keyFrame.midY))
                        .tap()
                } else {
                    let field = app.textFields.matching(identifier: "OTP digit \(index + 1)").firstMatch
                    XCTAssertTrue(field.waitForExistence(timeout: 3), "OTP digit \(index + 1) field was unavailable")
                    field.tap()
                    field.typeText(String(digit))
                }
            }
        }
        // The web flow auto-submits as soon as digit 8 lands. Do not race the
        // transient Verify button: it becomes disabled while verification is
        // running and disappears once navigation resumes.
        let editor = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Makaron editor workspace"))
            .firstMatch
        if includesPhoto {
            XCTAssertTrue(editor.waitForExistence(timeout: 40), "Registration did not resume into the editor")
            XCTAssertTrue(app.images["Current photo"].waitForExistence(timeout: 10), "The selected photo was not carried into the editor")
            XCTAssertTrue(app.staticTexts["Turn my photo into an ending spirit"].waitForExistence(timeout: 10), "The selected Skill was not carried into the editor")
            attachScreenshot(app, name: "04-editor-with-trial")
        } else {
            let returnedUploadPhoto = app.buttons
                .matching(NSPredicate(format: "label BEGINSWITH %@", "Upload photo"))
                .firstMatch
            XCTAssertTrue(returnedUploadPhoto.waitForExistence(timeout: 40), "Registration without a photo did not return to the Skill upload surface")
            XCTAssertFalse(editor.exists, "Registration without a photo must not create an empty editor project")
            attachScreenshot(app, name: "03-skill-after-registration-without-photo")
        }
    }

    private func webElement(_ app: XCUIApplication, identifier: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: identifier).firstMatch
    }

    private func attachScreenshot(_ app: XCUIApplication, name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func waitForOTP(email: String, timeout: TimeInterval) throws -> String {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if let token = try fetchOTP(email: email) {
                return token
            }
            RunLoop.current.run(until: Date().addingTimeInterval(0.5))
        }
        throw NSError(
            domain: "MakaronStoreKitUITests",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "No Mailpit OTP arrived for \(email)"]
        )
    }

    private func fetchOTP(email: String) throws -> String? {
        let messagesURL = URL(string: "http://127.0.0.1:55324/api/v1/messages")!
        let messagesData = try synchronousData(from: messagesURL)
        let response = try JSONSerialization.jsonObject(with: messagesData) as? [String: Any]
        let messages = response?["messages"] as? [[String: Any]] ?? []

        for message in messages {
            let recipients = message["To"] as? [[String: Any]] ?? []
            guard recipients.contains(where: { ($0["Address"] as? String) == email }),
                  let identifier = message["ID"] as? String,
                  let encodedID = identifier.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed),
                  let detailURL = URL(string: "http://127.0.0.1:55324/api/v1/message/\(encodedID)") else {
                continue
            }
            let detailData = try synchronousData(from: detailURL)
            let detail = try JSONSerialization.jsonObject(with: detailData) as? [String: Any]
            let content = "\(detail?["Text"] ?? "") \(detail?["HTML"] ?? "")"
            let regex = try NSRegularExpression(pattern: "(?<![0-9])[0-9]{8}(?![0-9])")
            let range = NSRange(content.startIndex..<content.endIndex, in: content)
            guard let match = regex.firstMatch(in: content, range: range),
                  let tokenRange = Range(match.range, in: content) else {
                continue
            }
            return String(content[tokenRange])
        }
        return nil
    }

    private func synchronousData(from url: URL, method: String = "GET") throws -> Data {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error>!
        var request = URLRequest(url: url)
        request.httpMethod = method
        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error {
                result = .failure(error)
            } else if let response = response as? HTTPURLResponse, !(200..<300).contains(response.statusCode) {
                result = .failure(URLError(.badServerResponse))
            } else {
                result = .success(data ?? Data())
            }
            semaphore.signal()
        }.resume()
        if semaphore.wait(timeout: .now() + 5) == .timedOut {
            throw URLError(.timedOut)
        }
        return try result.get()
    }
}
