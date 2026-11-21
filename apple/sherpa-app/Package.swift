// swift-tools-version: 6.2

import PackageDescription

let workerProtocol: Target.Dependency = .product(name: "SherpaWorkerProtocol", package: "worker-protocol")

let package = Package(
    name: "sherpa-app",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Sherpa", targets: ["SherpaApp"]),
        .executable(name: "sherpa-relay", targets: ["SherpaRelay"]),
        // Test programs. They are never copied into Sherpa.app.
        .executable(name: "sherpa-app-testhost", targets: ["SherpaAppTestHost"]),
        .executable(name: "sherpa-fake-core", targets: ["SherpaFakeCore"]),
        .executable(name: "sherpa-fake-app", targets: ["SherpaFakeApp"]),
    ],
    dependencies: [
        .package(path: "../worker-protocol"),
        .package(path: "../eventkit-service"),
    ],
    targets: [
        // The boundary both sides of the socket share: signing identities, the socket
        // location, the app preface, the frame grammar and the peer signature check.
        .target(
            name: "SherpaAppConnection",
            dependencies: [workerProtocol],
            linkerSettings: [.linkedLibrary("bsm"), .linkedFramework("Security")]
        ),
        .target(name: "SherpaRelayKit", dependencies: ["SherpaAppConnection"]),
        .executableTarget(name: "SherpaRelay", dependencies: ["SherpaRelayKit"]),
        // Socket server, core supervision and multiplexing. No AppKit, no EventKit.
        .target(name: "SherpaAppServer", dependencies: ["SherpaAppConnection", workerProtocol]),
        // Binds the server's worker port to the helper's in-process planner handling.
        .target(
            name: "SherpaAppPlanner",
            dependencies: [
                "SherpaAppServer",
                workerProtocol,
                .product(name: "SherpaPlannerService", package: "eventkit-service"),
            ]
        ),
        .executableTarget(
            name: "SherpaApp",
            dependencies: ["SherpaAppConnection", "SherpaAppServer", "SherpaAppPlanner", workerProtocol],
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("EventKit"),
                .linkedFramework("CoreServices"),
            ]
        ),
        .executableTarget(
            name: "SherpaAppTestHost",
            dependencies: ["SherpaAppConnection", "SherpaAppServer", "SherpaAppPlanner"]
        ),
        .executableTarget(name: "SherpaFakeCore", dependencies: ["SherpaAppConnection", workerProtocol]),
        .executableTarget(name: "SherpaFakeApp", dependencies: ["SherpaAppConnection"]),
        .testTarget(
            name: "SherpaAppConnectionTests",
            dependencies: ["SherpaAppConnection", "SherpaRelayKit"]
        ),
        .testTarget(
            name: "SherpaAppServerTests",
            dependencies: ["SherpaAppServer", "SherpaAppConnection", workerProtocol]
        ),
        // Starts the programs above as `swift build` wrote them (contract §13.2).
        .testTarget(name: "SherpaAppProcessTests", dependencies: ["SherpaAppConnection"]),
    ]
)
