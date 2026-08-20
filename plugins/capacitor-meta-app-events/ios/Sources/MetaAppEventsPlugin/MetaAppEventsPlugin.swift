import Capacitor
import AppTrackingTransparency
import FacebookCore
import Foundation
import UIKit

private enum DeferredAppLinkResolution {
    case resolved(URL)
    case empty
    case failed(NSError)
}

private final class DeferredAppLinkCoordinator {
    static let shared = DeferredAppLinkCoordinator()

    private enum State {
        case idle
        case loading
        case complete(DeferredAppLinkResolution)
    }

    private let lock = NSLock()
    private var state: State = .idle
    private var callbacks: [(DeferredAppLinkResolution) -> Void] = []
    private(set) var startedAt: Date?
    private(set) var completedAt: Date?

    private init() {}

    func start() {
        lock.lock()
        guard case .idle = state else {
            lock.unlock()
            return
        }
        state = .loading
        startedAt = Date()
        lock.unlock()

        #if DEBUG
        let arguments = ProcessInfo.processInfo.arguments
        if let index = arguments.firstIndex(of: "-MakaronDeferredAppLink"),
           arguments.indices.contains(index + 1),
           let url = URL(string: arguments[index + 1]) {
            finish(.resolved(url))
            return
        }
        #endif

        AppLinkUtility.fetchDeferredAppLink { [weak self] url, error in
            if let error {
                self?.finish(.failed(error as NSError))
            } else if let url {
                self?.finish(.resolved(url))
            } else {
                self?.finish(.empty)
            }
        }

        // Meta does not invoke its callback after the first-install lookup has
        // already been consumed. Resolve deterministically instead of leaving
        // the Capacitor promise pending forever on a later app launch.
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in
            let error = NSError(
                domain: "app.makaron.meta.deferred-link",
                code: -1001,
                userInfo: [NSLocalizedDescriptionKey: "Deferred app link lookup timed out"]
            )
            self?.finish(.failed(error))
        }
    }

    func resolve(_ callback: @escaping (DeferredAppLinkResolution) -> Void) {
        lock.lock()
        switch state {
        case .complete(let resolution):
            lock.unlock()
            DispatchQueue.main.async { callback(resolution) }
        case .idle:
            callbacks.append(callback)
            lock.unlock()
            start()
        case .loading:
            callbacks.append(callback)
            lock.unlock()
        }
    }

    private func finish(_ resolution: DeferredAppLinkResolution) {
        lock.lock()
        guard case .loading = state else {
            lock.unlock()
            return
        }
        state = .complete(resolution)
        completedAt = Date()
        let pendingCallbacks = callbacks
        callbacks.removeAll()
        lock.unlock()

        DispatchQueue.main.async {
            pendingCallbacks.forEach { $0(resolution) }
        }
    }
}

public enum MetaAppEventsLifecycle {
    @discardableResult
    public static func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?
    ) -> Bool {
        #if DEBUG
        Settings.shared.loggingBehaviors.insert(.appEvents)
        Settings.shared.loggingBehaviors.insert(.networkRequests)
        #endif
        let initialized = ApplicationDelegate.shared.application(
            application,
            didFinishLaunchingWithOptions: launchOptions
        )
        Settings.shared.isAdvertiserIDCollectionEnabled = false
        Settings.shared.isAutoLogAppEventsEnabled = true
        Settings.shared.isSKAdNetworkReportEnabled = true
        DeferredAppLinkCoordinator.shared.start()
        return initialized
    }
}

@objc(MetaAppEventsPlugin)
public class MetaAppEventsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MetaAppEventsPlugin"
    public let jsName = "MetaAppEvents"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "initialize", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "fetchDeferredAppLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "trackEvent", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "flush", returnType: CAPPluginReturnPromise)
    ]

    private let automaticallyManagedEvents = Set([
        "AppFirstOpen",
        "StartTrial",
        "Subscribe",
        "Purchase"
    ])

    @objc func initialize(_ call: CAPPluginCall) {
        // Flush the automatic activation/install event as soon as the web bridge is ready.
        AppEvents.shared.flush()
        var payload: JSObject = [
            "initialized": true,
            "anonymousId": AppEvents.shared.anonymousID,
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "appBuild": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "",
            "advertiserTrackingStatus": advertiserTrackingStatus(),
            "advertiserIDCollectionEnabled": Settings.shared.isAdvertiserIDCollectionEnabled
        ]
        if let appId = Settings.shared.appID {
            payload["appId"] = appId
        }
        call.resolve(payload)
    }

    private func advertiserTrackingStatus() -> String {
        switch ATTrackingManager.trackingAuthorizationStatus {
        case .authorized:
            return "authorized"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "notDetermined"
        @unknown default:
            return "unknown"
        }
    }

    @objc func fetchDeferredAppLink(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            DeferredAppLinkCoordinator.shared.resolve { resolution in
                var payload = self.deferredAppLinkDiagnostics()
                switch resolution {
                case .resolved(let url):
                    payload["status"] = "resolved"
                    payload["url"] = url.absoluteString
                case .empty:
                    payload["status"] = "empty"
                    payload["url"] = NSNull()
                case .failed(let error):
                    payload["status"] = "error"
                    payload["url"] = NSNull()
                    payload["errorDomain"] = error.domain
                    payload["errorCode"] = error.code
                    payload["errorDescription"] = error.localizedDescription
                }
                call.resolve(payload)
            }
        }
    }

    private func deferredAppLinkDiagnostics() -> JSObject {
        var payload: JSObject = [
            "advertiserTrackingStatus": advertiserTrackingStatus(),
            "advertiserIDCollectionEnabled": Settings.shared.isAdvertiserIDCollectionEnabled,
            "appVersion": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            "appBuild": Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? ""
        ]
        let coordinator = DeferredAppLinkCoordinator.shared
        if let startedAt = coordinator.startedAt {
            payload["nativeFetchStartedAt"] = ISO8601DateFormatter().string(from: startedAt)
        }
        if let startedAt = coordinator.startedAt, let completedAt = coordinator.completedAt {
            payload["nativeFetchLatencyMs"] = Int(completedAt.timeIntervalSince(startedAt) * 1_000)
        }
        return payload
    }

    @objc func trackEvent(_ call: CAPPluginCall) {
        guard let eventName = call.getString("eventName"), !eventName.isEmpty else {
            call.reject("eventName is required")
            return
        }

        // Install/session and StoreKit revenue events are auto-logged by Meta.
        guard !automaticallyManagedEvents.contains(eventName) else {
            call.resolve(["tracked": false, "managedAutomatically": true])
            return
        }

        var parameters = eventParameters(call.getObject("params") ?? [:])
        if let eventId = call.getString("eventId"), !eventId.isEmpty {
            parameters[AppEvents.ParameterName(rawValue: "event_id")] = eventId
        }
        if let currency = call.getString("currency"), !currency.isEmpty {
            parameters[AppEvents.ParameterName.currency] = currency
        }

        let name = mappedEventName(eventName)
        if let value = call.getDouble("value") {
            AppEvents.shared.logEvent(name, valueToSum: value, parameters: parameters)
        } else {
            AppEvents.shared.logEvent(name, parameters: parameters)
        }
        // Funnel events are low-volume and should reach Meta before the app is suspended.
        AppEvents.shared.flush()
        call.resolve(["tracked": true])
    }

    @objc func flush(_ call: CAPPluginCall) {
        AppEvents.shared.flush()
        call.resolve()
    }

    private func mappedEventName(_ eventName: String) -> AppEvents.Name {
        switch eventName {
        case "ViewContent":
            return AppEvents.Name.viewedContent
        case "CompleteRegistration":
            return AppEvents.Name.completedRegistration
        case "CustomizeProduct":
            return AppEvents.Name.customizeProduct
        case "InitiateCheckout":
            return AppEvents.Name.initiatedCheckout
        default:
            return AppEvents.Name(rawValue: eventName)
        }
    }

    private func eventParameters(_ values: JSObject) -> [AppEvents.ParameterName: Any] {
        var result: [AppEvents.ParameterName: Any] = [:]
        for (key, value) in values {
            guard let value = supportedParameterValue(value) else { continue }
            result[mappedParameterName(key)] = value
        }
        return result
    }

    private func mappedParameterName(_ key: String) -> AppEvents.ParameterName {
        switch key {
        case "currency":
            return AppEvents.ParameterName.currency
        case "content_id", "skill_id":
            return AppEvents.ParameterName.contentID
        case "content_type", "media_type":
            return AppEvents.ParameterName.contentType
        case "registration_method":
            return AppEvents.ParameterName.registrationMethod
        default:
            return AppEvents.ParameterName(rawValue: key)
        }
    }

    private func supportedParameterValue(_ value: Any) -> Any? {
        switch value {
        case let string as String:
            return string
        case let number as NSNumber:
            return number
        default:
            return nil
        }
    }
}
