#import "SherpaShimResponse.h"

static NSData *SortedJSON(NSDictionary *response) {
    if (![NSJSONSerialization isValidJSONObject:response]) return nil;
    return [NSJSONSerialization dataWithJSONObject:response options:NSJSONWritingSortedKeys error:nil];
}

NSData *SherpaFittedResponseData(NSDictionary *response, NSUInteger maximumBytes) {
    NSData *data = SortedJSON(response);
    if (data && data.length <= maximumBytes) return data;

    NSDictionary *effect = [response[@"effect"] isKindOfClass:[NSDictionary class]] ? response[@"effect"] : nil;
    BOOL effectStarted = [effect[@"state"] isEqual:@"applied"] || [effect[@"state"] isEqual:@"may_have_applied"];
    NSMutableDictionary *bounded = [response mutableCopy];
    bounded[@"status"] = effectStarted
        ? ([response[@"status"] isEqual:@"uncertain"] ? @"uncertain" : @"partial")
        : @"failed";
    bounded[@"result"] = [NSNull null];
    bounded[@"effect"] = effect ?: @{ @"kind": @"none", @"state": @"not_started" };
    if (!effectStarted) bounded[@"evidence"] = [NSNull null];
    bounded[@"error"] = @{ @"code": @"protocol.result_too_large", @"retry": @"never" };
    bounded[@"warnings"] = @[];
    data = SortedJSON(bounded);
    return data && data.length <= maximumBytes ? data : nil;
}
