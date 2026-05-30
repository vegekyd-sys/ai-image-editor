import Capacitor
import UIKit
import WebKit

class MakaronBridgeViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeWebView()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureNativeWebView()
    }

    private func configureNativeWebView() {
        guard let webView else { return }

        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        NSLog("[Makaron] WKWebView app viewport configured")
    }
}
