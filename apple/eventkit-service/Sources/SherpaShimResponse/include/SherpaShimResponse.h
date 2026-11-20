#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Encodes a Worker Protocol V2 response as sorted JSON within `maximumBytes`.
/// A response that does not fit drops its result and warnings but keeps its
/// correlation and effect: an applied or possibly applied effect stays `uncertain`
/// or becomes `partial`, with its evidence; anything else becomes `failed`. Both
/// carry `protocol.result_too_large` with `retry: never`, so a caller cannot repeat
/// an effect that already happened. Returns nil only when even that does not fit.
FOUNDATION_EXPORT NSData *_Nullable SherpaFittedResponseData(NSDictionary *response, NSUInteger maximumBytes);

NS_ASSUME_NONNULL_END
