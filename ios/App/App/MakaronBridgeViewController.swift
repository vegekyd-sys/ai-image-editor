import Capacitor
import AuthenticationServices
import Photos
import PhotosUI
import StoreKit
import UniformTypeIdentifiers
import UIKit
import WebKit

class MakaronBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler, PHPickerViewControllerDelegate {
    private var nativeBridgeInstalled = false
    private var pendingPickerID: String?
    private var oauthSession: ASWebAuthenticationSession?
    private var transactionUpdatesTask: Task<Void, Never>?
    private var pendingPurchaseResponseIdsByProductId: [String: String] = [:]
    private var pendingPurchaseRequiresIntroByProductId: [String: Bool] = [:]
    private var handledTransactionIds = Set<String>()

#if DEBUG && targetEnvironment(simulator)
    private var usesLocalE2EPurchase: Bool {
        ProcessInfo.processInfo.arguments.contains("--makaron-e2e-local-purchase")
    }

    private func base64URLEncoded(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    /// Xcode 26 no longer attaches a scheme StoreKit configuration to an app
    /// launched by XCUIApplication. Keep the regression deterministic by
    /// returning an unsigned Xcode receipt only in an explicitly opted-in
    /// Debug Simulator process. The E2E server separately requires MAKARON_E2E=1
    /// and a loopback-only Supabase URL before it accepts this environment.
    private func localE2ETransactionPayload(productId: String) throws -> [String: Any] {
        let now = Int64(Date().timeIntervalSince1970 * 1_000)
        let transactionId = "xcode-e2e-\(UUID().uuidString.lowercased())"
        let payload: [String: Any] = [
            "originalTransactionId": transactionId,
            "transactionId": transactionId,
            "bundleId": Bundle.main.bundleIdentifier ?? "app.makaron.ios",
            "productId": productId,
            "purchaseDate": now,
            "originalPurchaseDate": now,
            // Match StoreKit's accelerated Sandbox/Xcode behavior. The server
            // must convert this to the product's full three-day credit window.
            "expiresDate": now + 120_000,
            "quantity": 1,
            "type": "Auto-Renewable Subscription",
            "inAppOwnershipType": "PURCHASED",
            "signedDate": now,
            "offerType": 1,
            "offerDiscountType": "FREE_TRIAL",
            "offerPeriod": "P3D",
            "transactionReason": "PURCHASE",
            "environment": "Xcode"
        ]
        let headerData = try JSONSerialization.data(withJSONObject: ["alg": "none", "typ": "JWT"])
        let payloadData = try JSONSerialization.data(withJSONObject: payload)
        let signedTransactionInfo = "\(base64URLEncoded(headerData)).\(base64URLEncoded(payloadData)).e2e"
        return [
            "productId": productId,
            "transactionId": transactionId,
            "originalTransactionId": transactionId,
            "signedTransactionInfo": signedTransactionInfo
        ]
    }
#endif

    @available(iOS 15.0, *)
    private func canonicalPaymentMode(_ mode: Product.SubscriptionOffer.PaymentMode) -> String {
        switch mode {
        case .freeTrial:
            return "freeTrial"
        case .payAsYouGo:
            return "payAsYouGo"
        case .payUpFront:
            return "payUpFront"
        default:
            return "unknown"
        }
    }

    @available(iOS 15.0, *)
    private func canonicalPeriodUnit(_ unit: Product.SubscriptionPeriod.Unit) -> String {
        switch unit {
        case .day:
            return "day"
        case .week:
            return "week"
        case .month:
            return "month"
        case .year:
            return "year"
        default:
            return "unknown"
        }
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeWebView()
        if #available(iOS 15.0, *) {
            startTransactionUpdatesListener()
        }
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureNativeWebView()
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(MakaronExternalLinkPlugin())
    }

    deinit {
        transactionUpdatesTask?.cancel()
        webView?.configuration.userContentController.removeScriptMessageHandler(forName: "makaronNative")
    }

    private func configureNativeWebView() {
        guard let webView else { return }

        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        if !nativeBridgeInstalled {
            webView.configuration.userContentController.add(self, name: "makaronNative")
            nativeBridgeInstalled = true
        }
        NSLog("[Makaron] WKWebView app viewport configured")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "makaronNative",
              let body = message.body as? [String: Any],
              let action = body["action"] as? String,
              let id = body["id"] as? String else {
            return
        }

        switch action {
        case "openOAuth":
            handleOpenOAuth(id: id, body: body)
        case "saveToPhotos":
            handleSaveToPhotos(id: id, body: body)
        case "pickMedia":
            handlePickMedia(id: id, body: body)
        case "getProducts":
            handleGetProducts(id: id, body: body)
        case "purchaseSubscription":
            handlePurchaseProduct(id: id, body: body)
        case "purchaseProduct":
            handlePurchaseProduct(id: id, body: body)
        case "restorePurchases":
            handleRestorePurchases(id: id, body: body)
        case "finishTransaction":
            handleFinishTransaction(id: id, body: body)
        default:
            sendNativeResponse(id: id, ok: false, error: "Unsupported native action")
        }
    }

    private func handleOpenOAuth(id: String, body: [String: Any]) {
        guard let urlString = body["url"] as? String, let url = URL(string: urlString) else {
            sendNativeResponse(id: id, ok: false, error: "Missing OAuth URL")
            return
        }

        let callbackURLScheme = (body["callbackURLScheme"] as? String) ?? "app.makaron.ios"
        oauthSession?.cancel()

        let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackURLScheme) { [weak self] callbackURL, error in
            DispatchQueue.main.async {
                self?.oauthSession = nil
                if let authError = error as? ASWebAuthenticationSessionError,
                   authError.code == .canceledLogin {
                    self?.sendNativeResponse(id: id, ok: false, error: "Google login cancelled")
                    return
                }
                if let error {
                    self?.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                    return
                }
                guard let callbackURL else {
                    self?.sendNativeResponse(id: id, ok: false, error: "Google login did not return a callback")
                    return
                }
                self?.sendNativeResponse(id: id, ok: true, error: nil, extra: ["callbackUrl": callbackURL.absoluteString])
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = false
        oauthSession = session

        if !session.start() {
            oauthSession = nil
            sendNativeResponse(id: id, ok: false, error: "Could not start Google login")
        }
    }

    private func handleGetProducts(id: String, body: [String: Any]) {
        guard #available(iOS 15.0, *) else {
            sendNativeResponse(id: id, ok: false, error: "Apple subscriptions require iOS 15 or later")
            return
        }

        let productIds = body["productIds"] as? [String] ?? []
        guard !productIds.isEmpty else {
            sendNativeResponse(id: id, ok: true, error: nil, extra: ["products": []])
            return
        }

        Task {
            do {
                let products = try await Product.products(for: productIds)
                var payload: [[String: Any]] = []
                for product in products {
                    var item: [String: Any] = [
                        "productId": product.id,
                        "displayName": product.displayName,
                        "description": product.description,
                        "displayPrice": product.displayPrice,
                        "type": String(describing: product.type)
                    ]
                    if let subscription = product.subscription {
                        item["isEligibleForIntroOffer"] = await subscription.isEligibleForIntroOffer
                        if let offer = subscription.introductoryOffer {
                            item["introductoryOffer"] = [
                                "displayPrice": offer.displayPrice,
                                "paymentMode": canonicalPaymentMode(offer.paymentMode),
                                "periodUnit": canonicalPeriodUnit(offer.period.unit),
                                "periodValue": offer.period.value,
                                "periodCount": offer.periodCount
                            ]
                        }
                    }
                    payload.append(item)
                }
                sendNativeResponse(id: id, ok: true, error: nil, extra: ["products": payload])
            } catch {
                sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func handlePurchaseProduct(id: String, body: [String: Any]) {
        guard #available(iOS 15.0, *) else {
            sendNativeResponse(id: id, ok: false, error: "Apple purchases require iOS 15 or later")
            return
        }

        guard let productId = body["productId"] as? String, !productId.isEmpty else {
            sendNativeResponse(id: id, ok: false, error: "Missing Apple product ID")
            return
        }

#if DEBUG && targetEnvironment(simulator)
        if usesLocalE2EPurchase {
            do {
                let payload = try localE2ETransactionPayload(productId: productId)
                NSLog("[Makaron] Local E2E purchase completed product=%@ transaction=%@", productId, payload["transactionId"] as? String ?? "")
                sendNativeResponse(id: id, ok: true, error: nil, extra: payload)
            } catch {
                sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
            return
        }
#endif
        let introductoryOfferOnly = body["introductoryOfferOnly"] as? Bool ?? false

        NSLog("[Makaron] StoreKit purchase requested product=%@ response=%@", productId, id)
        Task { @MainActor in
            do {
                let products = try await Product.products(for: [productId])
                guard let product = products.first else {
                    NSLog("[Makaron] StoreKit product missing product=%@ response=%@", productId, id)
                    sendNativeResponse(id: id, ok: false, error: "Apple product not found")
                    return
                }

                // A server verification failure deliberately leaves the StoreKit transaction
                // unfinished. The primary purchase button must resume that exact transaction
                // instead of asking a first-time subscriber to use the separate Restore action.
                if let recovered = try await unfinishedTransaction(
                    for: productId,
                    introductoryOfferOnly: introductoryOfferOnly
                ) {
                    clearPendingPurchaseResponse(productId: productId, id: id)
                    NSLog("[Makaron] StoreKit resumed unfinished transaction product=%@ transaction=%@ response=%@", productId, String(recovered.transaction.id), id)
                    sendTransactionResponse(id: id, transaction: recovered.transaction, signedTransactionInfo: recovered.signedTransactionInfo)
                    return
                }

                pendingPurchaseResponseIdsByProductId[productId] = id
                pendingPurchaseRequiresIntroByProductId[productId] = introductoryOfferOnly
                NSLog("[Makaron] StoreKit product ready product=%@ price=%@ response=%@", product.id, product.displayPrice, id)

                var options: Set<Product.PurchaseOption> = []
                if let token = body["appAccountToken"] as? String, let uuid = UUID(uuidString: token) {
                    options.insert(.appAccountToken(uuid))
                }

                NSLog("[Makaron] StoreKit purchase starting product=%@ response=%@", productId, id)
                let result = try await product.purchase(options: options)
                switch result {
                case .success(let verification):
                    let transaction = try checkVerified(verification)
                    let signedTransactionInfo = verification.jwsRepresentation
                    clearPendingPurchaseResponse(productId: productId, id: id)
                    NSLog("[Makaron] StoreKit purchase success product=%@ transaction=%@ response=%@", productId, String(transaction.id), id)
                    sendTransactionResponse(id: id, transaction: transaction, signedTransactionInfo: signedTransactionInfo)
                case .userCancelled:
                    NSLog("[Makaron] StoreKit purchase returned userCancelled product=%@ response=%@", productId, id)
                    if let recovered = try await unfinishedTransaction(
                        for: productId,
                        introductoryOfferOnly: introductoryOfferOnly
                    ) {
                        clearPendingPurchaseResponse(productId: productId, id: id)
                        NSLog("[Makaron] StoreKit recovered unfinished transaction product=%@ transaction=%@ response=%@", productId, String(recovered.transaction.id), id)
                        sendTransactionResponse(id: id, transaction: recovered.transaction, signedTransactionInfo: recovered.signedTransactionInfo)
                        return
                    }
                    if pendingPurchaseResponseIdsByProductId[productId] == id {
                        clearPendingPurchaseResponse(productId: productId, id: id)
                        sendNativeResponse(id: id, ok: false, error: "Purchase cancelled")
                    }
                case .pending:
                    NSLog("[Makaron] StoreKit purchase pending product=%@ response=%@", productId, id)
                    clearPendingPurchaseResponse(productId: productId, id: id)
                    sendNativeResponse(id: id, ok: false, error: "Purchase pending")
                @unknown default:
                    NSLog("[Makaron] StoreKit purchase unknown result product=%@ response=%@", productId, id)
                    clearPendingPurchaseResponse(productId: productId, id: id)
                    sendNativeResponse(id: id, ok: false, error: "Unknown purchase result")
                }
            } catch {
                NSLog("[Makaron] StoreKit purchase failed product=%@ response=%@ error=%@", productId, id, error.localizedDescription)
                clearPendingPurchaseResponse(productId: productId, id: id)
                sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func handleRestorePurchases(id: String, body: [String: Any]) {
        guard #available(iOS 15.0, *) else {
            sendNativeResponse(id: id, ok: false, error: "Apple subscriptions require iOS 15 or later")
            return
        }

        let introductoryOfferOnly = body["introductoryOfferOnly"] as? Bool ?? false
        Task {
            do {
                try await AppStore.sync()
                var transactions: [[String: Any]] = []
                var seenTransactionIds = Set<String>()

                for await unfinished in Transaction.unfinished {
                    let transaction = try checkVerified(unfinished)
                    let transactionId = String(transaction.id)
                    guard transaction.revocationDate == nil else { continue }
                    guard !introductoryOfferOnly || isIntroductoryOffer(transaction) else { continue }
                    guard !seenTransactionIds.contains(transactionId) else { continue }
                    seenTransactionIds.insert(transactionId)
                    transactions.append(transactionPayload(transaction, signedTransactionInfo: unfinished.jwsRepresentation))
                }

                for await entitlement in Transaction.currentEntitlements {
                    let transaction = try checkVerified(entitlement)
                    let transactionId = String(transaction.id)
                    guard transaction.revocationDate == nil else { continue }
                    guard transaction.productType == .autoRenewable else { continue }
                    guard !introductoryOfferOnly || isIntroductoryOffer(transaction) else { continue }
                    guard !seenTransactionIds.contains(transactionId) else { continue }
                    seenTransactionIds.insert(transactionId)
                    transactions.append(transactionPayload(transaction, signedTransactionInfo: entitlement.jwsRepresentation))
                }
                sendNativeResponse(id: id, ok: true, error: nil, extra: ["transactions": transactions])
            } catch {
                sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func handleFinishTransaction(id: String, body: [String: Any]) {
        guard #available(iOS 15.0, *) else {
            sendNativeResponse(id: id, ok: false, error: "Apple purchases require iOS 15 or later")
            return
        }

        guard let transactionId = body["transactionId"] as? String, !transactionId.isEmpty else {
            sendNativeResponse(id: id, ok: false, error: "Missing Apple transaction ID")
            return
        }

#if DEBUG && targetEnvironment(simulator)
        if usesLocalE2EPurchase && transactionId.hasPrefix("xcode-e2e-") {
            sendNativeResponse(id: id, ok: true, error: nil, extra: ["transactionId": transactionId])
            return
        }
#endif

        Task {
            do {
                for await unfinished in Transaction.unfinished {
                    let transaction = try checkVerified(unfinished)
                    if String(transaction.id) == transactionId {
                        await transaction.finish()
                        sendNativeResponse(id: id, ok: true, error: nil, extra: ["transactionId": transactionId])
                        return
                    }
                }
                sendNativeResponse(id: id, ok: false, error: "Apple transaction is not pending")
            } catch {
                sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    @available(iOS 15.0, *)
    private func checkVerified<T>(_ result: VerificationResult<T>) throws -> T {
        switch result {
        case .unverified(_, let error):
            throw error
        case .verified(let safe):
            return safe
        }
    }

    @available(iOS 15.0, *)
    private func startTransactionUpdatesListener() {
        guard transactionUpdatesTask == nil else { return }
        transactionUpdatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                guard let self else { return }
                do {
                    let transaction = try self.checkVerified(update)
                    guard transaction.revocationDate == nil else { continue }
                    let transactionId = String(transaction.id)
                    let signedTransactionInfo = update.jwsRepresentation
                    await MainActor.run {
                        guard !self.handledTransactionIds.contains(transactionId) else { return }
                        let introductoryOfferOnly = self.pendingPurchaseRequiresIntroByProductId[transaction.productID] ?? false
                        guard !introductoryOfferOnly || self.isIntroductoryOffer(transaction) else {
                            NSLog("[Makaron] StoreKit ignored non-intro transaction for trial response product=%@ transaction=%@", transaction.productID, transactionId)
                            return
                        }
                        self.handledTransactionIds.insert(transactionId)
                        guard let responseId = self.pendingPurchaseResponseIdsByProductId.removeValue(forKey: transaction.productID) else {
                            NSLog("[Makaron] StoreKit transaction update without pending web response product=%@ transaction=%@", transaction.productID, transactionId)
                            return
                        }
                        NSLog("[Makaron] StoreKit transaction update matched pending response product=%@ transaction=%@ response=%@", transaction.productID, transactionId, responseId)
                        self.sendTransactionResponse(id: responseId, transaction: transaction, signedTransactionInfo: signedTransactionInfo)
                    }
                } catch {
                    NSLog("[Makaron] StoreKit transaction update verification failed: %@", error.localizedDescription)
                }
            }
        }
    }

    @available(iOS 15.0, *)
    private func unfinishedTransaction(
        for productId: String,
        introductoryOfferOnly: Bool = false
    ) async throws -> (transaction: Transaction, signedTransactionInfo: String)? {
        for await unfinished in Transaction.unfinished {
            let transaction = try checkVerified(unfinished)
            guard transaction.revocationDate == nil else { continue }
            guard transaction.productID == productId else { continue }
            guard !introductoryOfferOnly || isIntroductoryOffer(transaction) else {
                NSLog("[Makaron] StoreKit skipped unfinished non-intro transaction product=%@ transaction=%@", productId, String(transaction.id))
                continue
            }
            return (transaction, unfinished.jwsRepresentation)
        }
        NSLog("[Makaron] StoreKit no unfinished transaction product=%@", productId)
        return nil
    }

    @MainActor
    private func clearPendingPurchaseResponse(productId: String, id: String) {
        if pendingPurchaseResponseIdsByProductId[productId] == id {
            pendingPurchaseResponseIdsByProductId.removeValue(forKey: productId)
            pendingPurchaseRequiresIntroByProductId.removeValue(forKey: productId)
        }
    }

    @available(iOS 15.0, *)
    private func isIntroductoryOffer(_ transaction: Transaction) -> Bool {
        if #available(iOS 17.2, *) {
            return transaction.offer?.type == .introductory
        }
        return transaction.offerType == .introductory
    }

    @available(iOS 15.0, *)
    private func transactionPayload(_ transaction: Transaction, signedTransactionInfo: String) -> [String: Any] {
        [
            "productId": transaction.productID,
            "transactionId": String(transaction.id),
            "originalTransactionId": String(transaction.originalID),
            "signedTransactionInfo": signedTransactionInfo
        ]
    }

    @available(iOS 15.0, *)
    private func sendTransactionResponse(id: String, transaction: Transaction, signedTransactionInfo: String) {
        sendNativeResponse(id: id, ok: true, error: nil, extra: transactionPayload(transaction, signedTransactionInfo: signedTransactionInfo))
    }

    private func handlePickMedia(id: String, body: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingPickerID == nil else {
                self.sendNativeResponse(id: id, ok: false, error: "Photo picker is already open")
                return
            }

            let allowVideo = body["allowVideo"] as? Bool ?? false
            let allowsMultiple = body["multiple"] as? Bool ?? false
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.selectionLimit = allowsMultiple ? 0 : 1
            configuration.filter = allowVideo ? .any(of: [.images, .videos]) : .images
            configuration.preferredAssetRepresentationMode = .compatible

            let picker = PHPickerViewController(configuration: configuration)
            picker.delegate = self
            self.pendingPickerID = id
            self.present(picker, animated: true)
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        let id = pendingPickerID
        pendingPickerID = nil

        picker.dismiss(animated: true) { [weak self] in
            guard let self, let id else { return }
            guard !results.isEmpty else {
                self.sendNativeResponse(id: id, ok: false, error: "Photo picker cancelled")
                return
            }
            self.loadPickedMediaItems(results, id: id)
        }
    }

    private func loadPickedMediaItems(
        _ results: [PHPickerResult],
        id: String,
        index: Int = 0,
        items: [[String: Any]] = []
    ) {
        guard index < results.count else {
            guard let first = items.first else {
                sendNativeResponse(id: id, ok: false, error: "Could not load selected media")
                return
            }
            var payload: [String: Any] = ["items": items]
            first.forEach { payload[$0.key] = $0.value }
            sendNativeResponse(id: id, ok: true, error: nil, extra: payload)
            return
        }

        loadPickedMedia(results[index]) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let item):
                self.loadPickedMediaItems(results, id: id, index: index + 1, items: items + [item])
            case .failure(let error):
                self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            }
        }
    }

    private func loadPickedMedia(
        _ result: PHPickerResult,
        completion: @escaping (Result<[String: Any], Error>) -> Void
    ) {
        let provider = result.itemProvider
        let typeIds = provider.registeredTypeIdentifiers

        if let movieType = typeIds.first(where: { UTType($0)?.conforms(to: .movie) == true }) {
            provider.loadFileRepresentation(forTypeIdentifier: movieType) { [weak self] fileURL, error in
                guard let self else { return }
                if let error {
                    completion(.failure(error))
                    return
                }
                guard let fileURL else {
                    completion(.failure(NSError(domain: "MakaronNativePicker", code: 1, userInfo: [NSLocalizedDescriptionKey: "Could not load selected video"])))
                    return
                }
                do {
                    let data = try Data(contentsOf: fileURL)
                    let filename = self.filename(for: provider, typeIdentifier: movieType, fallback: "makaron-video.mov")
                    let mimeType = self.mimeType(for: movieType, fallback: "video/quicktime")
                    completion(.success(self.pickedMediaPayload(data: data, filename: filename, mimeType: mimeType, mediaType: "video")))
                } catch {
                    completion(.failure(error))
                }
            }
            return
        }

        guard let imageType = typeIds.first(where: { UTType($0)?.conforms(to: .image) == true }) else {
            completion(.failure(NSError(domain: "MakaronNativePicker", code: 2, userInfo: [NSLocalizedDescriptionKey: "Selected item is not supported"])))
            return
        }

        provider.loadDataRepresentation(forTypeIdentifier: imageType) { [weak self] data, error in
            guard let self else { return }
            if let error {
                completion(.failure(error))
                return
            }
            guard let data else {
                completion(.failure(NSError(domain: "MakaronNativePicker", code: 3, userInfo: [NSLocalizedDescriptionKey: "Could not load selected image"])))
                return
            }
            let filename = self.filename(for: provider, typeIdentifier: imageType, fallback: "makaron-photo.jpg")
            let mimeType = self.mimeType(for: imageType, fallback: "image/jpeg")
            let normalized = self.normalizedPickedImagePayload(data: data, filename: filename, mimeType: mimeType, typeIdentifier: imageType)
            completion(.success(self.pickedMediaPayload(data: normalized.data, filename: normalized.filename, mimeType: normalized.mimeType, mediaType: "image")))
        }
    }

    private func normalizedPickedImagePayload(data: Data, filename: String, mimeType: String, typeIdentifier: String) -> (data: Data, filename: String, mimeType: String) {
        if UTType(typeIdentifier)?.conforms(to: .gif) == true {
            return (data, filename, mimeType)
        }
        guard let image = UIImage(data: data) else {
            return (data, filename, mimeType)
        }
        let normalizedImage = resizedPickedImage(image, maxDimension: 2048)
        guard let jpegData = normalizedImage.jpegData(compressionQuality: 0.9) else {
            return (data, filename, mimeType)
        }
        return (jpegData, jpegFilename(for: filename), "image/jpeg")
    }

    private func resizedPickedImage(_ image: UIImage, maxDimension: CGFloat) -> UIImage {
        let longestSide = max(image.size.width, image.size.height)
        guard longestSide > maxDimension else { return image }
        let scale = maxDimension / longestSide
        let targetSize = CGSize(
            width: max(1, round(image.size.width * scale)),
            height: max(1, round(image.size.height * scale))
        )
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }

    private func pickedMediaPayload(data: Data, filename: String, mimeType: String, mediaType: String) -> [String: Any] {
        [
            "dataUrl": "data:\(mimeType);base64,\(data.base64EncodedString())",
            "filename": filename,
            "mimeType": mimeType,
            "mediaType": mediaType
        ]
    }

    private func handleSaveToPhotos(id: String, body: [String: Any]) {
        let mediaType = body["mediaType"] as? String ?? "image"
        let filename = body["filename"] as? String ?? defaultFilename(for: mediaType)
        let hasDataURL = body["dataUrl"] is String
        let hasURL = body["url"] is String
        NSLog("[Makaron] native save request id=%@ type=%@ filename=%@ hasDataURL=%@ hasURL=%@", id, mediaType, filename, String(hasDataURL), String(hasURL))

        if let dataUrl = body["dataUrl"] as? String {
            guard let data = dataFromDataURL(dataUrl) else {
                NSLog("[Makaron] native save decode failed id=%@", id)
                sendNativeResponse(id: id, ok: false, error: "Could not decode media")
                return
            }
            saveMediaData(data, id: id, filename: filename, mediaType: mediaType)
            return
        }

        guard let urlString = body["url"] as? String, let url = URL(string: urlString) else {
            NSLog("[Makaron] native save missing URL id=%@", id)
            sendNativeResponse(id: id, ok: false, error: "Missing media URL")
            return
        }

        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                NSLog("[Makaron] native save download failed id=%@ error=%@", id, error.localizedDescription)
                self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                return
            }
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode >= 400 {
                NSLog("[Makaron] native save download status id=%@ status=%ld", id, httpResponse.statusCode)
                self.sendNativeResponse(id: id, ok: false, error: "Download failed with status \(httpResponse.statusCode)")
                return
            }
            guard let data, !data.isEmpty else {
                NSLog("[Makaron] native save downloaded empty media id=%@", id)
                self.sendNativeResponse(id: id, ok: false, error: "Downloaded media is empty")
                return
            }
            NSLog("[Makaron] native save downloaded id=%@ bytes=%ld", id, data.count)
            self.saveMediaData(data, id: id, filename: filename, mediaType: mediaType)
        }.resume()
    }

    private func saveMediaData(_ data: Data, id: String, filename: String, mediaType: String) {
        requestPhotoAddPermission { [weak self] allowed in
            guard let self else { return }
            guard allowed else {
                NSLog("[Makaron] native save denied id=%@ type=%@", id, mediaType)
                self.sendNativeResponse(id: id, ok: false, error: "Photo Library permission denied")
                return
            }

            NSLog("[Makaron] native save permission ok id=%@ type=%@ bytes=%ld", id, mediaType, data.count)
            if mediaType == "video" {
                self.saveVideoData(data, id: id, filename: filename)
            } else {
                self.saveImageData(data, id: id, filename: filename)
            }
        }
    }

    private func saveImageData(_ data: Data, id: String, filename: String) {
        let photoData: Data
        let photoFilename: String
        if let image = UIImage(data: data), let jpegData = image.jpegData(compressionQuality: 0.95) {
            photoData = jpegData
            photoFilename = jpegFilename(for: filename)
        } else {
            photoData = data
            photoFilename = filename
        }

        let options = PHAssetResourceCreationOptions()
        options.originalFilename = photoFilename
        var localIdentifier: String?

        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, data: photoData, options: options)
            localIdentifier = request.placeholderForCreatedAsset?.localIdentifier
        }) { [weak self] success, error in
            NSLog("[Makaron] native save image result id=%@ success=%@ asset=%@ error=%@", id, String(success), localIdentifier ?? "", error?.localizedDescription ?? "")
            self?.sendNativeResponse(id: id, ok: success, error: error?.localizedDescription, extra: [
                "localIdentifier": localIdentifier ?? "",
                "mediaType": "image"
            ])
        }
    }

    private func saveVideoData(_ data: Data, id: String, filename: String) {
        let ext = (filename as NSString).pathExtension.isEmpty ? "mp4" : (filename as NSString).pathExtension
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")

        do {
            try data.write(to: tempURL, options: .atomic)
        } catch {
            NSLog("[Makaron] native save video temp write failed id=%@ error=%@", id, error.localizedDescription)
            sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            return
        }

        let options = PHAssetResourceCreationOptions()
        options.originalFilename = filename
        var localIdentifier: String?

        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .video, fileURL: tempURL, options: options)
            localIdentifier = request.placeholderForCreatedAsset?.localIdentifier
        }) { [weak self] success, error in
            try? FileManager.default.removeItem(at: tempURL)
            NSLog("[Makaron] native save video result id=%@ success=%@ asset=%@ error=%@", id, String(success), localIdentifier ?? "", error?.localizedDescription ?? "")
            self?.sendNativeResponse(id: id, ok: success, error: error?.localizedDescription, extra: [
                "localIdentifier": localIdentifier ?? "",
                "mediaType": "video"
            ])
        }
    }

    private func requestPhotoAddPermission(_ completion: @escaping (Bool) -> Void) {
        let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
        switch status {
        case .authorized, .limited:
            completion(true)
        case .notDetermined:
            PHPhotoLibrary.requestAuthorization(for: .addOnly) { newStatus in
                completion(newStatus == .authorized || newStatus == .limited)
            }
        default:
            completion(false)
        }
    }

    private func dataFromDataURL(_ dataUrl: String) -> Data? {
        guard let comma = dataUrl.firstIndex(of: ",") else { return nil }
        let base64 = String(dataUrl[dataUrl.index(after: comma)...])
        return Data(base64Encoded: base64, options: .ignoreUnknownCharacters)
    }

    private func defaultFilename(for mediaType: String) -> String {
        mediaType == "video" ? "makaron-video.mp4" : "makaron-image.jpg"
    }

    private func jpegFilename(for filename: String) -> String {
        let trimmed = filename.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return "makaron-image.jpg" }
        let ns = trimmed as NSString
        let base = ns.deletingPathExtension
        return "\(base.isEmpty ? "makaron-image" : base).jpg"
    }

    private func filename(for provider: NSItemProvider, typeIdentifier: String, fallback: String) -> String {
        let baseName = provider.suggestedName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let ext = UTType(typeIdentifier)?.preferredFilenameExtension
        if let baseName, !baseName.isEmpty {
            if (baseName as NSString).pathExtension.isEmpty, let ext {
                return "\(baseName).\(ext)"
            }
            return baseName
        }
        return fallback
    }

    private func mimeType(for typeIdentifier: String, fallback: String) -> String {
        UTType(typeIdentifier)?.preferredMIMEType ?? fallback
    }

    private func sendNativeResponse(id: String, ok: Bool, error: String?, extra: [String: Any] = [:]) {
        DispatchQueue.main.async { [weak self] in
            var detail: [String: Any] = ["id": id, "ok": ok]
            extra.forEach { detail[$0.key] = $0.value }
            if let error, !error.isEmpty {
                detail["error"] = error
            }
            NSLog("[Makaron] native response id=%@ ok=%@ mediaType=%@ error=%@", id, String(ok), detail["mediaType"] as? String ?? "", error ?? "")
            guard let jsonData = try? JSONSerialization.data(withJSONObject: detail),
                  let json = String(data: jsonData, encoding: .utf8) else {
                return
            }
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('makaron-native-response',{detail:\(json)}));")
        }
    }
}

extension MakaronBridgeViewController: ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        view.window ?? ASPresentationAnchor()
    }
}
