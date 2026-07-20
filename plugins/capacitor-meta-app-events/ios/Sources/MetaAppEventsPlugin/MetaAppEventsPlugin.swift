import Capacitor
import FacebookCore
import Foundation
import UIKit

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
            "anonymousId": AppEvents.shared.anonymousID
        ]
        if let appId = Settings.shared.appID {
            payload["appId"] = appId
        }
        call.resolve(payload)
    }

    @objc func fetchDeferredAppLink(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            #if DEBUG
            let arguments = ProcessInfo.processInfo.arguments
            if let index = arguments.firstIndex(of: "-MakaronDeferredAppLink"),
               arguments.indices.contains(index + 1),
               URL(string: arguments[index + 1]) != nil {
                call.resolve(["url": arguments[index + 1]])
                return
            }
            #endif

            AppLinkUtility.fetchDeferredAppLink { url, error in
                if let error {
                    call.reject("Unable to fetch deferred app link", nil, error)
                    return
                }

                guard let url else {
                    call.resolve(["url": NSNull()])
                    return
                }
                call.resolve(["url": url.absoluteString])
            }
        }
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
