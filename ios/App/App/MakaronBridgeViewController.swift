import Capacitor
import Photos
import PhotosUI
import UniformTypeIdentifiers
import UIKit
import WebKit

class MakaronBridgeViewController: CAPBridgeViewController, WKScriptMessageHandler, PHPickerViewControllerDelegate {
    private var nativeBridgeInstalled = false
    private var pendingPickerID: String?

    override func viewDidLoad() {
        super.viewDidLoad()
        configureNativeWebView()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        configureNativeWebView()
    }

    deinit {
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
        case "saveToPhotos":
            handleSaveToPhotos(id: id, body: body)
        case "pickMedia":
            handlePickMedia(id: id, body: body)
        default:
            sendNativeResponse(id: id, ok: false, error: "Unsupported native action")
        }
    }

    private func handlePickMedia(id: String, body: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            guard self.pendingPickerID == nil else {
                self.sendNativeResponse(id: id, ok: false, error: "Photo picker is already open")
                return
            }

            let allowVideo = body["allowVideo"] as? Bool ?? false
            var configuration = PHPickerConfiguration(photoLibrary: .shared())
            configuration.selectionLimit = 1
            configuration.filter = allowVideo ? .any(of: [.images, .videos]) : .images
            configuration.preferredAssetRepresentationMode = .current

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
            guard let result = results.first else {
                self.sendNativeResponse(id: id, ok: false, error: "Photo picker cancelled")
                return
            }
            self.loadPickedMedia(result, id: id)
        }
    }

    private func loadPickedMedia(_ result: PHPickerResult, id: String) {
        let provider = result.itemProvider
        let typeIds = provider.registeredTypeIdentifiers

        if let movieType = typeIds.first(where: { UTType($0)?.conforms(to: .movie) == true }) {
            provider.loadFileRepresentation(forTypeIdentifier: movieType) { [weak self] fileURL, error in
                guard let self else { return }
                if let error {
                    self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                    return
                }
                guard let fileURL else {
                    self.sendNativeResponse(id: id, ok: false, error: "Could not load selected video")
                    return
                }
                do {
                    let data = try Data(contentsOf: fileURL)
                    let filename = self.filename(for: provider, typeIdentifier: movieType, fallback: "makaron-video.mov")
                    let mimeType = self.mimeType(for: movieType, fallback: "video/quicktime")
                    self.sendPickedMediaResponse(id: id, data: data, filename: filename, mimeType: mimeType, mediaType: "video")
                } catch {
                    self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                }
            }
            return
        }

        guard let imageType = typeIds.first(where: { UTType($0)?.conforms(to: .image) == true }) else {
            sendNativeResponse(id: id, ok: false, error: "Selected item is not supported")
            return
        }

        provider.loadDataRepresentation(forTypeIdentifier: imageType) { [weak self] data, error in
            guard let self else { return }
            if let error {
                self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                return
            }
            guard let data else {
                self.sendNativeResponse(id: id, ok: false, error: "Could not load selected image")
                return
            }
            let filename = self.filename(for: provider, typeIdentifier: imageType, fallback: "makaron-photo.jpg")
            let mimeType = self.mimeType(for: imageType, fallback: "image/jpeg")
            self.sendPickedMediaResponse(id: id, data: data, filename: filename, mimeType: mimeType, mediaType: "image")
        }
    }

    private func sendPickedMediaResponse(id: String, data: Data, filename: String, mimeType: String, mediaType: String) {
        let dataUrl = "data:\(mimeType);base64,\(data.base64EncodedString())"
        sendNativeResponse(id: id, ok: true, error: nil, extra: [
            "dataUrl": dataUrl,
            "filename": filename,
            "mimeType": mimeType,
            "mediaType": mediaType
        ])
    }

    private func handleSaveToPhotos(id: String, body: [String: Any]) {
        let mediaType = body["mediaType"] as? String ?? "image"
        let filename = body["filename"] as? String ?? defaultFilename(for: mediaType)

        if let dataUrl = body["dataUrl"] as? String {
            guard let data = dataFromDataURL(dataUrl) else {
                sendNativeResponse(id: id, ok: false, error: "Could not decode media")
                return
            }
            saveMediaData(data, id: id, filename: filename, mediaType: mediaType)
            return
        }

        guard let urlString = body["url"] as? String, let url = URL(string: urlString) else {
            sendNativeResponse(id: id, ok: false, error: "Missing media URL")
            return
        }

        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let self else { return }
            if let error {
                self.sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
                return
            }
            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode >= 400 {
                self.sendNativeResponse(id: id, ok: false, error: "Download failed with status \(httpResponse.statusCode)")
                return
            }
            guard let data, !data.isEmpty else {
                self.sendNativeResponse(id: id, ok: false, error: "Downloaded media is empty")
                return
            }
            self.saveMediaData(data, id: id, filename: filename, mediaType: mediaType)
        }.resume()
    }

    private func saveMediaData(_ data: Data, id: String, filename: String, mediaType: String) {
        requestPhotoAddPermission { [weak self] allowed in
            guard let self else { return }
            guard allowed else {
                self.sendNativeResponse(id: id, ok: false, error: "Photo Library permission denied")
                return
            }

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

        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .photo, data: photoData, options: options)
        }) { [weak self] success, error in
            self?.sendNativeResponse(id: id, ok: success, error: error?.localizedDescription)
        }
    }

    private func saveVideoData(_ data: Data, id: String, filename: String) {
        let ext = (filename as NSString).pathExtension.isEmpty ? "mp4" : (filename as NSString).pathExtension
        let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("\(UUID().uuidString).\(ext)")

        do {
            try data.write(to: tempURL, options: .atomic)
        } catch {
            sendNativeResponse(id: id, ok: false, error: error.localizedDescription)
            return
        }

        let options = PHAssetResourceCreationOptions()
        options.originalFilename = filename

        PHPhotoLibrary.shared().performChanges({
            let request = PHAssetCreationRequest.forAsset()
            request.addResource(with: .video, fileURL: tempURL, options: options)
        }) { [weak self] success, error in
            try? FileManager.default.removeItem(at: tempURL)
            self?.sendNativeResponse(id: id, ok: success, error: error?.localizedDescription)
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
            guard let jsonData = try? JSONSerialization.data(withJSONObject: detail),
                  let json = String(data: jsonData, encoding: .utf8) else {
                return
            }
            self?.webView?.evaluateJavaScript("window.dispatchEvent(new CustomEvent('makaron-native-response',{detail:\(json)}));")
        }
    }
}
