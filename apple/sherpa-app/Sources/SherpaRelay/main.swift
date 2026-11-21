import Foundation
import SherpaRelayKit

Relay.main(arguments: Array(CommandLine.arguments.dropFirst()), environment: ProcessInfo.processInfo.environment)
