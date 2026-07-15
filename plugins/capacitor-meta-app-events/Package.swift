// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "MakaronCapacitorMetaAppEvents",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "MakaronCapacitorMetaAppEvents",
            targets: ["MetaAppEventsPlugin"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.3.4"),
        .package(url: "https://github.com/facebook/facebook-ios-sdk.git", exact: "18.0.3")
    ],
    targets: [
        .target(
            name: "MetaAppEventsPlugin",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "FacebookCore", package: "facebook-ios-sdk")
            ],
            path: "ios/Sources/MetaAppEventsPlugin")
    ]
)
