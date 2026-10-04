import StoreKit
import StoreKitTest
import XCTest
import UIKit
@testable import App

final class MakaronStoreKitTests: XCTestCase {
    private let productID = "app.makaron.ios.subscription.basic.monthly"

    @MainActor
    func testGenuineStoreKitTopupSubscriptionAndServerRestore() async throws {
        guard ProcessInfo.processInfo.environment["MAKARON_E2E_NATIVE_LOCAL"] == "1",
              let email = ProcessInfo.processInfo.environment["MAKARON_E2E_EMAIL"] else {
            throw XCTSkip("Requires an isolated local account registered through the native UI")
        }
        var fixture = URLComponents(string: "http://127.0.0.1:3004/session")!
        fixture.queryItems = [URLQueryItem(name: "email", value: email)]
        fixture.percentEncodedQuery = fixture.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        let (sessionData, sessionResponse) = try await URLSession.shared.data(from: fixture.url!)
        XCTAssertEqual((sessionResponse as? HTTPURLResponse)?.statusCode, 200)
        let local = try JSONSerialization.jsonObject(with: sessionData) as! [String: Any]
        let cookie = try XCTUnwrap(local["cookie"] as? String)
        let userID = try XCTUnwrap(UUID(uuidString: try XCTUnwrap(local["userId"] as? String)))
        fixture.path = "/state"
        let (initialData, _) = try await URLSession.shared.data(from: fixture.url!)
        let initial = try JSONSerialization.jsonObject(with: initialData) as! [String: Any]
        let initialBalance = (initial["balance"] as! [String: Any])["balance"] as! Int
        let initialAppleCount = (initial["purchases"] as! [[String: Any]]).filter { ($0["provider"] as? String) == "apple" }.count
        let previousTransactionIDs = (initial["purchases"] as! [[String: Any]])
            .filter { ($0["provider"] as? String) == "apple" && ($0["apple_environment"] as? String) == "Xcode" }
            .compactMap { $0["apple_transaction_id"] as? String }
        var expectedBalance = initialBalance
        var expectedAppleCount = initialAppleCount

        let storeKit = try SKTestSession(configurationFileNamed: "MakaronLocal")
        storeKit.resetToDefaultState()
        storeKit.clearTransactions()
        storeKit.disableDialogs = true
        storeKit.locale = Locale(identifier: "en_US")
        storeKit.storefront = "USA"
        storeKit.timeRate = .realTime
        defer { storeKit.clearTransactions() }

        fixture.path = "/storekit-history"
        let (historyData, _) = try await URLSession.shared.data(from: fixture.url!)
        let history = try JSONSerialization.jsonObject(with: historyData) as! [String: Any]
        let previous = history["transactions"] as! [[String: Any]]
        if let last = previous.compactMap({ UInt($0["apple_transaction_id"] as! String) }).max() {
            var advanced = false
            for _ in 0..<100 {
                // Use a different SKU so StoreKit 2 cannot reuse a preparation purchase.
                try storeKit.buyProduct(productIdentifier: "app.makaron.ios.topup.team")
                let transaction = try XCTUnwrap(storeKit.allTransactions().last)
                try storeKit.deleteTransaction(identifier: transaction.identifier)
                if transaction.identifier >= last { advanced = true; break }
            }
            guard advanced else { return XCTFail("Could not advance isolated local StoreKit IDs") }
        }

        let ids = ["app.makaron.ios.topup.starter", "app.makaron.ios.subscription.pro.monthly"]
        let products = try await Product.products(for: ids)
        XCTAssertEqual(products.count, 2)
        for (index, id) in ids.enumerated() {
            let product = try XCTUnwrap(products.first { $0.id == id })
            let purchase = try await product.purchase(options: [.appAccountToken(userID)])
            guard case .success(let verification) = purchase,
                  case .verified(let transaction) = verification else {
                return XCTFail("Real StoreKit did not return a verified transaction")
            }
            XCTAssertFalse(String(transaction.id).hasPrefix("xcode-e2e-"))
            XCTAssertEqual(transaction.appAccountToken, userID)
            // Preserve the local account and ledger across hosted/UI runners.
            let isNew = !previousTransactionIDs.contains(String(transaction.id))
            if isNew { expectedBalance += index == 0 ? 500 : 3000; expectedAppleCount += 1 }
            let result = try await verifyOnLocalServer(verification.jwsRepresentation, cookie: cookie)
            XCTAssertEqual(result["ok"] as? Bool, true)
            XCTAssertEqual(result["credited"] as? Bool, isNew)
            XCTAssertEqual(result["balance"] as? Int, expectedBalance)
            let replay = try await verifyOnLocalServer(verification.jwsRepresentation, cookie: cookie)
            XCTAssertEqual(replay["credited"] as? Bool, false)
            XCTAssertEqual(replay["balance"] as? Int, expectedBalance)
            await transaction.finish()
        }
        try await AppStore.sync()
        var restored = false
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement,
                  transaction.productID == ids[1] else { continue }
            let result = try await verifyOnLocalServer(entitlement.jwsRepresentation, cookie: cookie)
            XCTAssertEqual(result["credited"] as? Bool, false)
            XCTAssertEqual(result["balance"] as? Int, expectedBalance)
            restored = true
        }
        XCTAssertTrue(restored, "Paid subscription missing from genuine StoreKit restore")
        fixture.path = "/state"
        let (stateData, _) = try await URLSession.shared.data(from: fixture.url!)
        let state = try JSONSerialization.jsonObject(with: stateData) as! [String: Any]
        let purchases = (state["purchases"] as! [[String: Any]]).filter { ($0["provider"] as? String) == "apple" }
        XCTAssertEqual(purchases.count, expectedAppleCount)
        for purchase in purchases {
            XCTAssertEqual(purchase["apple_environment"] as? String, "Xcode")
            XCTAssertEqual(purchase["status"] as? String, "completed")
            XCTAssertGreaterThan(purchase["amount_usd"] as? Double ?? 0, 0)
        }
    }

    private func verifyOnLocalServer(_ signedTransaction: String, cookie: String) async throws -> [String: Any] {
        var request = URLRequest(url: URL(string: "http://127.0.0.1:3002/api/billing/apple/verify")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(cookie, forHTTPHeaderField: "Cookie")
        request.httpBody = try JSONSerialization.data(withJSONObject: ["signedTransactionInfo": signedTransaction])
        let (data, response) = try await URLSession.shared.data(for: request)
        XCTAssertEqual((response as? HTTPURLResponse)?.statusCode, 200, String(data: data, encoding: .utf8) ?? "")
        return try JSONSerialization.jsonObject(with: data) as! [String: Any]
    }

    func testNativeVideoWatermarkGeometryMatchesPreview() {
        for size in [CGSize(width: 768, height: 768), CGSize(width: 480, height: 854), CGSize(width: 854, height: 480)] {
            let rect = MakaronBridgeViewController.videoWatermarkRect(size: size, signatureSize: CGSize(width: 500, height: 100))
            let margin = max(2, (min(size.width, size.height) * 0.025).rounded())
            XCTAssertEqual(rect.width, min(size.width * 0.28, size.height * 0.45, 360))
            XCTAssertEqual(rect.height, rect.width * 0.2, accuracy: 0.00001)
            XCTAssertEqual(rect.maxX, size.width - margin)
            XCTAssertEqual(rect.minY, margin)
        }
    }

    func testNativePhotoResourcesPreservePNGAndJPEGBytes() throws {
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: 20, height: 12))
        let image = renderer.image { context in
            UIColor.red.setFill()
            context.fill(CGRect(x: 4, y: 4, width: 8, height: 4))
        }
        for (data, ext) in [(try XCTUnwrap(image.pngData()), "png"),
                            (try XCTUnwrap(image.jpegData(compressionQuality: 0.93)), "jpg")] {
            let resource = try XCTUnwrap(MakaronBridgeViewController.photoResourceForSave(data, filename: "original.webp"))
            XCTAssertEqual(resource.data, data)
            XCTAssertEqual(resource.filename, "original.\(ext)")
        }
        XCTAssertNil(MakaronBridgeViewController.photoResourceForSave(Data("invalid".utf8), filename: "bad.png"))
    }

    func testResetStateForUIFlow() throws {
        let session = try SKTestSession(configurationFileNamed: "MakaronE2E")
        session.disableDialogs = true
        session.resetToDefaultState()
        session.clearTransactions()
        session.storefront = "USA"
        XCTAssertTrue(session.allTransactions().isEmpty)
    }

    func testPurchaseExpireRefundAndReset() throws {
        let session = try SKTestSession(configurationFileNamed: "MakaronE2E")
        session.disableDialogs = true
        session.resetToDefaultState()
        session.clearTransactions()

        try session.buyProduct(productIdentifier: productID)
        guard let transaction = session.allTransactions().first else {
            return XCTFail("Local StoreKit did not create a transaction")
        }
        XCTAssertEqual(transaction.productIdentifier, productID)

        try session.expireSubscription(productIdentifier: productID)
        XCTAssertNotNil(session.allTransactions().first?.expirationDate)
        try session.refundTransaction(identifier: transaction.identifier)
        XCTAssertNotNil(session.allTransactions().first?.cancelDate)

        session.clearTransactions()
        XCTAssertTrue(session.allTransactions().isEmpty)
    }

    func testPurchasedSubscriptionIsAvailableToRestore() async throws {
        let session = try SKTestSession(configurationFileNamed: "MakaronE2E")
        session.disableDialogs = true
        session.resetToDefaultState()
        session.clearTransactions()

        try session.buyProduct(productIdentifier: productID)
        var restoredProductIDs = Set<String>()
        for await entitlement in Transaction.currentEntitlements {
            guard case .verified(let transaction) = entitlement else { continue }
            restoredProductIDs.insert(transaction.productID)
        }
        XCTAssertTrue(restoredProductIDs.contains(productID))

        session.clearTransactions()
    }
}
