import SherpaMutationApplication

/// A journal store failure. The store reports what happened to its own write;
/// it never decides what happened to the external effect.
public enum JournalStoreError: Error, Equatable {
    case invalidRequest
    case failed
}

extension JournalStoreError: MutationAttemptFailure {
    public var mayHaveApplied: Bool { false }
    public var stableCode: String { String(describing: self) }
}
