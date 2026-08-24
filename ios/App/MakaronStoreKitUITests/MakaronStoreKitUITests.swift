import XCTest

@MainActor
final class MakaronStoreKitUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
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

        let consent = webElement(app, identifier: "Allow AI processing and continue")
        if consent.waitForExistence(timeout: 5) {
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
        XCTAssertTrue(skill.waitForExistence(timeout: 20), "Seeded E2E Skill did not load")
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

            // iOS 26 exposes PHPicker grid assets as Images rather than Cells.
            // The picker is a remote scene, but it remains in the host app's AX tree.
            let firstPhoto = app.images.matching(identifier: "PXGGridLayout-Info").firstMatch
            XCTAssertTrue(firstPhoto.waitForExistence(timeout: 10), "Native photo picker did not open")
            let pickerDone = app.buttons["Done"]
            XCTAssertTrue(pickerDone.waitForExistence(timeout: 5), "Native photo picker Done button did not appear")
            // The remote Photos scene can expose the first grid item just before it
            // is ready to accept the synthesized tap. Only continue after the Done
            // button proves that an item is actually selected.
            var selectedPhoto = false
            for _ in 0..<3 where !selectedPhoto {
                firstPhoto.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
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
            key.tap()
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

    private func synchronousData(from url: URL) throws -> Data {
        let semaphore = DispatchSemaphore(value: 0)
        var result: Result<Data, Error>!
        URLSession.shared.dataTask(with: url) { data, _, error in
            if let error {
                result = .failure(error)
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
