// swift-tools-version: 6.2

import PackageDescription

let infoPlist = Context.packageDirectory + "/Resources/Info.plist"

let package = Package(
    name: "sherpa",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "sherpa-apple", targets: ["SherpaNative"]),
        .library(name: "SherpaPlannerService", targets: ["SherpaPlannerService"]),
        .executable(
            name: "sherpa-eventkit-live-verify",
            targets: ["SherpaEventKitLiveVerifier"]
        ),
    ],
    dependencies: [
        .package(path: "../worker-protocol")
    ],
    targets: [
        .target(
            name: "SherpaPlannerContract",
            dependencies: [
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol")
            ]
        ),
        .target(
            name: "SherpaPlannerApplication",
            dependencies: ["SherpaPlannerContract"]
        ),
        .target(
            name: "SherpaEventKitAdapter",
            dependencies: [
                "SherpaPlannerApplication",
                "SherpaPlannerContract",
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol"),
            ]
        ),
        .target(name: "SherpaMutationApplication"),
        .target(
            name: "SherpaJournalStore",
            dependencies: ["SherpaMutationApplication"],
            linkerSettings: [.linkedLibrary("sqlite3")]
        ),
        .target(
            name: "SherpaShimResponse",
            publicHeadersPath: "include",
            linkerSettings: [.linkedFramework("Foundation")]
        ),
        .target(
            name: "SherpaMailShim",
            dependencies: ["SherpaShimResponse"],
            publicHeadersPath: "include",
            cSettings: [.define("SHERPA_MAIL_LIBRARY")],
            linkerSettings: [
                .linkedFramework("Foundation"),
                .linkedFramework("AppKit"),
                .linkedFramework("CoreServices"),
            ]
        ),
        .target(
            name: "SherpaReminderKitShim",
            dependencies: ["SherpaShimResponse"],
            publicHeadersPath: "include",
            cSettings: [.define("SHERPA_REMINDER_KIT_LIBRARY")],
            linkerSettings: [
                .linkedFramework("Foundation"),
                .linkedFramework("EventKit"),
                .linkedFramework("ImageIO"),
                .linkedLibrary("dl"),
            ]
        ),
        .target(
            name: "SherpaPlannerService",
            dependencies: [
                "SherpaEventKitAdapter",
                "SherpaMutationApplication",
                "SherpaJournalStore",
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol"),
            ]
        ),
        .executableTarget(
            name: "SherpaNative",
            dependencies: [
                "SherpaPlannerService",
                "SherpaJournalStore",
                "SherpaMailShim",
                "SherpaReminderKitShim",
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol"),
            ],
            linkerSettings: [
                .unsafeFlags([
                    "-Xlinker", "-sectcreate",
                    "-Xlinker", "__TEXT",
                    "-Xlinker", "__info_plist",
                    "-Xlinker", infoPlist,
                ])
            ]
        ),
        .target(
            name: "SherpaEventKitLiveVerifierSupport",
            dependencies: [
                "SherpaPlannerContract",
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol"),
            ]
        ),
        .executableTarget(
            name: "SherpaEventKitLiveVerifier",
            dependencies: ["SherpaEventKitLiveVerifierSupport"]
        ),
        .testTarget(
            name: "SherpaEventKitTests",
            dependencies: [
                "SherpaPlannerContract",
                "SherpaEventKitAdapter",
                .product(name: "SherpaWorkerProtocol", package: "worker-protocol"),
            ]
        ),
        .testTarget(
            name: "SherpaEventKitLiveVerifierTests",
            dependencies: ["SherpaEventKitLiveVerifierSupport"]
        ),
        .testTarget(
            name: "SherpaJournalStoreTests",
            dependencies: [
                "SherpaMutationApplication", "SherpaJournalStore", "SherpaMailShim",
                "SherpaReminderKitShim", "SherpaShimResponse",
            ]
        ),
    ]
)
