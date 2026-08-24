import StoreKit
import StoreKitTest
import XCTest

final class MakaronStoreKitTests: XCTestCase {
    private let productID = "app.makaron.ios.subscription.basic.monthly"

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
