import Capacitor
import SafariServices
import WebKit

@objc(MakaronExternalLinkPlugin)
class MakaronExternalLinkPlugin: CAPPlugin, CAPBridgedPlugin, SFSafariViewControllerDelegate {
    let identifier = "MakaronExternalLinkPlugin"
    let jsName = "MakaronExternalLink"
    let pluginMethods: [CAPPluginMethod] = []

    private weak var safariViewController: SFSafariViewController?

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url,
              shouldOpenInAppBrowser(url, navigationAction: navigationAction) else {
            return nil
        }

        DispatchQueue.main.async { [weak self] in
            self?.openInAppBrowser(url)
        }
        return true
    }

    private func shouldOpenInAppBrowser(_ url: URL, navigationAction: WKNavigationAction) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return false
        }

        let isTopLevelNavigation = navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true
        guard isTopLevelNavigation else {
            return false
        }

        if let host = url.host, bridge?.config.shouldAllowNavigation(to: host) == true {
            return false
        }

        if let config = bridge?.config {
            let absolute = url.absoluteString
            if absolute.hasPrefix(config.serverURL.absoluteString) || absolute.hasPrefix(config.localURL.absoluteString) {
                return false
            }
        }

        return true
    }

    private func openInAppBrowser(_ url: URL) {
        safariViewController?.dismiss(animated: true)

        let controller = SFSafariViewController(url: url)
        controller.delegate = self
        controller.modalPresentationStyle = .pageSheet
        safariViewController = controller
        bridge?.viewController?.present(controller, animated: true)
    }

    func safariViewControllerDidFinish(_ controller: SFSafariViewController) {
        if safariViewController === controller {
            safariViewController = nil
        }
    }
}
