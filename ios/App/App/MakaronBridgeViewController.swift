import Capacitor
import UIKit
import WebKit

class MakaronBridgeViewController: CAPBridgeViewController, UIGestureRecognizerDelegate {
    private let interactiveBackEdgeWidth: CGFloat = 44
    private var interactiveBackEdgeView: UIView?
    private var interactiveBackGesture: UIPanGestureRecognizer?
    private var backSnapshotView: UIView?
    private var currentBackTranslation: CGFloat = 0

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeWebView()
        installInteractiveBackGesture()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureNativeWebView()
        installInteractiveBackGesture()
    }

    private func configureNativeWebView() {
        guard let webView else { return }

        webView.allowsBackForwardNavigationGestures = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        NSLog("[Makaron] WKWebView app viewport configured")
    }

    private func installInteractiveBackGesture() {
        if let edgeView = interactiveBackEdgeView {
            view.bringSubviewToFront(edgeView)
            return
        }

        guard interactiveBackGesture == nil else { return }

        let edgeView = UIView(frame: CGRect(x: 0, y: 0, width: interactiveBackEdgeWidth, height: view.bounds.height))
        edgeView.autoresizingMask = [.flexibleHeight, .flexibleRightMargin]
        edgeView.backgroundColor = .clear
        edgeView.isUserInteractionEnabled = true

        let gesture = UIPanGestureRecognizer(target: self, action: #selector(handleInteractiveBackGesture(_:)))
        gesture.delegate = self
        gesture.cancelsTouchesInView = true
        gesture.delaysTouchesBegan = false
        gesture.delaysTouchesEnded = false
        edgeView.addGestureRecognizer(gesture)
        view.addSubview(edgeView)

        interactiveBackEdgeView = edgeView
        interactiveBackGesture = gesture
        NSLog("[Makaron] Native interactive back gesture installed")
    }

    @objc private func handleInteractiveBackGesture(_ gesture: UIPanGestureRecognizer) {
        guard webView != nil else { return }

        let translation = gesture.translation(in: view)
        let velocity = gesture.velocity(in: view)

        switch gesture.state {
        case .began:
            beginInteractiveBack()
        case .changed:
            updateInteractiveBack(distance: translation.x)
        case .ended:
            let width = max(view.bounds.width, 1)
            let progress = max(0, translation.x) / width
            if progress > 0.32 || velocity.x > 520 {
                finishInteractiveBack(initialVelocity: velocity.x)
            } else {
                cancelInteractiveBack()
            }
        case .cancelled, .failed:
            cancelInteractiveBack()
        default:
            break
        }
    }

    private func beginInteractiveBack() {
        guard let webView, backSnapshotView == nil else { return }

        currentBackTranslation = 0

        let snapshot = webView.snapshotView(afterScreenUpdates: false) ?? makeRenderedWebViewSnapshot(webView)
        snapshot.frame = view.bounds
        snapshot.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        snapshot.isUserInteractionEnabled = false
        snapshot.layer.shadowColor = UIColor.black.cgColor
        snapshot.layer.shadowOpacity = 0.24
        snapshot.layer.shadowRadius = 18
        snapshot.layer.shadowOffset = CGSize(width: -6, height: 0)
        view.addSubview(snapshot)
        backSnapshotView = snapshot

        navigateHistoryBack()
        NSLog("[Makaron] Interactive back begin")
    }

    private func makeRenderedWebViewSnapshot(_ webView: WKWebView) -> UIView {
        let renderer = UIGraphicsImageRenderer(bounds: webView.bounds)
        let image = renderer.image { _ in
            webView.drawHierarchy(in: webView.bounds, afterScreenUpdates: false)
        }
        let imageView = UIImageView(image: image)
        imageView.contentMode = .scaleToFill
        imageView.clipsToBounds = true
        return imageView
    }

    private func updateInteractiveBack(distance: CGFloat) {
        currentBackTranslation = min(max(0, distance), view.bounds.width)
        backSnapshotView?.transform = CGAffineTransform(translationX: currentBackTranslation, y: 0)
    }

    private func finishInteractiveBack(initialVelocity: CGFloat) {
        guard let snapshot = backSnapshotView else {
            resetInteractiveBackState()
            return
        }

        let remaining = max(0, view.bounds.width - currentBackTranslation)
        let duration = max(0.12, min(0.28, TimeInterval(remaining / max(abs(initialVelocity), 900))))

        UIView.animate(
            withDuration: duration,
            delay: 0,
            options: [.curveEaseOut, .beginFromCurrentState],
            animations: {
                snapshot.transform = CGAffineTransform(translationX: self.view.bounds.width, y: 0)
                snapshot.alpha = 0.92
            },
            completion: { _ in
                snapshot.removeFromSuperview()
                self.resetInteractiveBackState()
                NSLog("[Makaron] Interactive back finish")
            }
        )
    }

    private func cancelInteractiveBack() {
        navigateHistoryForward()

        guard let snapshot = backSnapshotView else {
            resetInteractiveBackState()
            return
        }

        UIView.animate(
            withDuration: 0.2,
            delay: 0,
            options: [.curveEaseOut, .beginFromCurrentState],
            animations: {
                snapshot.transform = .identity
            },
            completion: { _ in
                snapshot.removeFromSuperview()
                self.resetInteractiveBackState()
                NSLog("[Makaron] Interactive back cancel")
            }
        )
    }

    private func resetInteractiveBackState() {
        backSnapshotView = nil
        currentBackTranslation = 0
    }

    private func navigateHistoryBack() {
        webView?.evaluateJavaScript("window.history.back();")
    }

    private func navigateHistoryForward() {
        webView?.evaluateJavaScript("window.history.forward();")
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard gestureRecognizer === interactiveBackGesture,
              let panGesture = gestureRecognizer as? UIPanGestureRecognizer else {
            return true
        }

        let velocity = panGesture.velocity(in: view)
        return velocity.x >= abs(velocity.y)
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gestureRecognizer === interactiveBackGesture else { return true }
        return touch.location(in: interactiveBackEdgeView).x <= interactiveBackEdgeWidth
    }

    func gestureRecognizer(_ gestureRecognizer: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith otherGestureRecognizer: UIGestureRecognizer) -> Bool {
        false
    }
}
