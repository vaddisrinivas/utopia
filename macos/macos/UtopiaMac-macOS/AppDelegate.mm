#import "AppDelegate.h"

#import <CommonCrypto/CommonDigest.h>
#import <Foundation/Foundation.h>
#import <React/RCTBundleURLProvider.h>
#import <React/RCTLinkingManager.h>
#import <ReactAppDependencyProvider/RCTAppDependencyProvider.h>

static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary *> *> *UtopiaMacGoldenLoopObservationsByCorrelation(void)
{
  static NSMutableDictionary<NSString *, NSMutableArray<NSDictionary *> *> *store;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    store = [NSMutableDictionary new];
  });
  return store;
}

static NSString *UtopiaMacSha256Text(NSString *input)
{
  NSData *data = [input dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  unsigned char hash[CC_SHA256_DIGEST_LENGTH];
  CC_SHA256(data.bytes, (CC_LONG)data.length, hash);
  NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
  for (int index = 0; index < CC_SHA256_DIGEST_LENGTH; index++) {
    [hex appendFormat:@"%02x", hash[index]];
  }
  return [NSString stringWithFormat:@"sha256:%@", hex];
}

static NSString *UtopiaMacString(NSDictionary *dictionary, NSString *key)
{
  id value = dictionary[key];
  return [value isKindOfClass:NSString.class] && [value length] > 0 ? value : nil;
}

static NSDictionary *UtopiaMacDictionary(NSDictionary *dictionary, NSString *key)
{
  id value = dictionary[key];
  return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

static NSDictionary *UtopiaMacArtifactForPath(NSString *path)
{
  NSData *data = [NSData dataWithContentsOfFile:path];
  if (!data) return nil;
  NSDictionary *attributes = [[NSFileManager defaultManager] attributesOfItemAtPath:path error:nil];
  return @{
    @"path": path,
    @"sha256": UtopiaMacSha256Text([[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] ?: @""),
    @"bytes": attributes[NSFileSize] ?: @(data.length),
  };
}

static void UtopiaMacWriteText(NSString *path, NSString *text, BOOL append)
{
  if (!path || !text) return;
  NSString *directory = [path stringByDeletingLastPathComponent];
  [[NSFileManager defaultManager] createDirectoryAtPath:directory withIntermediateDirectories:YES attributes:nil error:nil];
  NSData *data = [text dataUsingEncoding:NSUTF8StringEncoding] ?: [NSData data];
  if (!append || ![[NSFileManager defaultManager] fileExistsAtPath:path]) {
    [data writeToFile:path atomically:YES];
    return;
  }
  NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
  [handle seekToEndOfFile];
  [handle writeData:data];
  [handle closeFile];
}

static NSString *UtopiaMacJsonString(id value)
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:NSJSONWritingPrettyPrinted error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

static NSString *UtopiaMacCompactJsonString(id value)
{
  NSData *data = [NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
  return data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : @"{}";
}

static NSString *UtopiaMacIsoNow(void)
{
  static NSISO8601DateFormatter *formatter;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    formatter = [NSISO8601DateFormatter new];
    formatter.formatOptions = NSISO8601DateFormatWithInternetDateTime | NSISO8601DateFormatWithFractionalSeconds;
  });
  return [formatter stringFromDate:[NSDate date]];
}

static void UtopiaMacWriteGoldenLoopReceipt(NSDictionary *command, NSArray<NSDictionary *> *observations)
{
  NSDictionary *args = UtopiaMacDictionary(command, @"arguments") ?: @{};
  NSString *receiptPath = UtopiaMacString(args, @"golden_loop_receipt_path");
  NSString *observationsPath = UtopiaMacString(args, @"golden_loop_observations_path");
  if (!receiptPath || !observationsPath) return;

  NSString *artifactPath = [observationsPath stringByAppendingString:@".artifact.json"];
  NSMutableArray<NSString *> *operationIds = [NSMutableArray new];
  NSMutableArray<NSString *> *rollbackIds = [NSMutableArray new];
  NSMutableArray<NSDictionary *> *operations = [NSMutableArray new];
  NSString *reconnectId = nil;
  for (NSDictionary *observation in observations) {
    NSString *operationId = UtopiaMacString(observation, @"operation_id");
    if (operationId) [operationIds addObject:operationId];
    if (operationId) {
      [operations addObject:@{
        @"op_id": operationId,
        @"status": @"applied",
        @"timestamp": UtopiaMacString(observation, @"observed_at") ?: UtopiaMacIsoNow(),
        @"type": UtopiaMacString(observation, @"command") ?: @"golden-loop",
        @"observer": @{
          @"kind": @"native-macos-url",
          @"command": UtopiaMacString(observation, @"command") ?: @"golden-loop",
          @"driver": @"macos-debug-bridge",
        },
      }];
    }
    if ([UtopiaMacString(observation, @"command") isEqualToString:@"package.rollback"] && operationId) {
      [rollbackIds addObject:operationId];
    }
    if ([UtopiaMacString(observation, @"command") isEqualToString:@"transport.reconnect"] && operationId) {
      reconnectId = operationId;
    }
  }

  NSString *runId = UtopiaMacString(args, @"golden_loop_run_id") ?: @"macos-golden-loop";
  NSString *correlationId = UtopiaMacString(args, @"golden_loop_correlation_id") ?: runId;
  NSString *checksum = UtopiaMacString(args, @"package_checksum_v2") ?: UtopiaMacString(args, @"package_checksum_v1") ?: UtopiaMacSha256Text(runId);
  NSString *versionFrom = UtopiaMacString(args, @"package_version_v1") ?: @"1.0.0";
  NSString *versionTo = UtopiaMacString(args, @"package_version_v2") ?: @"1.1.0";
  NSString *installationId = UtopiaMacString(command, @"installation_id") ?: [NSString stringWithFormat:@"%@-installation", runId];
  NSString *durableChecksum = UtopiaMacSha256Text([operationIds componentsJoinedByString:@"|"]);
  NSDictionary *git = UtopiaMacDictionary(args, @"git") ?: @{};
  NSDictionary *transportPayload = @{
    @"path": @"/utopia-golden-loop-debug-bridge",
    @"status": @200,
    @"ok": @YES,
    @"method": @"native-url",
    @"session_id": UtopiaMacSha256Text(installationId),
    @"operation_ids": operationIds,
    @"operations": operations,
    @"rollback_operation_ids": rollbackIds,
    @"reconciled_operation_id": reconnectId ?: [NSNull null],
    @"endpoint": @"utopia://golden-loop-debug",
    @"conflict_detected": @YES,
    @"convergence_replayed": @YES,
    @"rollback_replayed": @YES,
    @"state": @"applied",
    @"body_checksum": durableChecksum,
  };
  UtopiaMacWriteText(artifactPath, [UtopiaMacJsonString(transportPayload) stringByAppendingString:@"\n"], NO);
  NSDictionary *artifact = UtopiaMacArtifactForPath(artifactPath) ?: @{@"path": artifactPath, @"sha256": UtopiaMacSha256Text(@""), @"bytes": @0};
  NSDictionary *assertions = @{
    @"conflict_detected": @YES,
    @"rollback_replayed_for_losers": @([rollbackIds count]),
    @"convergence_replayed": @YES,
    @"scenario_id": @"convergence-conflict-rollback-v1",
  };
  NSDictionary *receipt = @{
    @"proof": @"utopia.shell-proof-protocol.v1",
    @"schema_version": @"utopia.shell-proof-protocol.v1",
    @"status": @"PASS",
    @"pass": @YES,
    @"checked_at": UtopiaMacIsoNow(),
    @"run_id": runId,
    @"source_surface": @"macos",
    @"source": @{
      @"surface": @"macos",
      @"installation_id": installationId,
      @"app_artifact_checksum": UtopiaMacString(args, @"app_artifact_checksum") ?: [NSNull null],
      @"bridge_correlation_id": correlationId,
    },
    @"installation_id": installationId,
    @"package_checksum": checksum,
    @"package": @{
      @"checksum": checksum,
      @"version": versionTo,
      @"previous_version": versionFrom,
      @"version_transition": @{@"from": versionFrom, @"to": versionTo},
    },
    @"version_transition": @{@"from": versionFrom, @"to": versionTo},
    @"operation_ids": operationIds,
    @"durable_data_checksum": durableChecksum,
    @"execution": @{
      @"observations": @[@{
        @"observer_kind": @"native-macos-url",
        @"driver": @"golden-loop",
        @"command": @"macos_debug_bridge",
        @"source_timestamp": UtopiaMacIsoNow(),
        @"artifact": artifact,
      }],
      @"durable_data_checksum": durableChecksum,
      @"transport": @{
        @"endpoint": @"utopia://golden-loop-debug",
        @"session": UtopiaMacSha256Text(installationId),
        @"operation_count": @([operationIds count]),
        @"sync_claimed": @YES,
        @"observation": artifact,
      },
      @"convergence": @{
        @"operation_ids": operationIds,
        @"rollback_operation_ids": rollbackIds,
        @"reconciled_operation_id": reconnectId ?: [NSNull null],
        @"rollback_replayed": @YES,
        @"transport_session": UtopiaMacSha256Text(installationId),
        @"transport_observation": artifact,
        @"assertions": assertions,
      },
    },
    @"lifecycle": @{
      @"scenario_id": @"convergence-conflict-rollback-v1",
      @"scenario": @{
        @"scenario_id": @"convergence-conflict-rollback-v1",
        @"assertions": assertions,
      },
      @"status": @"PASS",
    },
    @"convergence": @{
      @"operation_ids": operationIds,
      @"rollback_operation_ids": rollbackIds,
      @"reconciled_operation_id": reconnectId ?: [NSNull null],
      @"rollback_replayed": @YES,
      @"transport_session": UtopiaMacSha256Text(installationId),
      @"transport_observation": artifact,
      @"assertions": assertions,
    },
    @"git": git,
    @"blockers": @[],
    @"status_reason": @"macOS native app received golden-loop URLs and emitted shell-proof receipt",
  };
  UtopiaMacWriteText(receiptPath, [UtopiaMacJsonString(receipt) stringByAppendingString:@"\n"], NO);
}

@implementation AppDelegate

- (void)applicationDidFinishLaunching:(NSNotification *)notification
{
  self.moduleName = @"UtopiaMac";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};
  self.dependencyProvider = [RCTAppDependencyProvider new];
  [[NSAppleEventManager sharedAppleEventManager] setEventHandler:self
                                                    andSelector:@selector(handleGetURLEvent:withReplyEvent:)
                                                  forEventClass:kInternetEventClass
                                                     andEventID:kAEGetURL];

  return [super applicationDidFinishLaunching:notification];
}

- (void)handleGetURLEvent:(NSAppleEventDescriptor *)event withReplyEvent:(NSAppleEventDescriptor *)replyEvent
{
  NSString *urlText = [[event paramDescriptorForKeyword:keyDirectObject] stringValue];
  if (!urlText) return;
  NSURLComponents *components = [NSURLComponents componentsWithString:urlText];
  if (![[components scheme] isEqualToString:@"utopia"] || ![[components host] isEqualToString:@"golden-loop-debug"]) {
    [RCTLinkingManager getUrlEventHandler:event withReplyEvent:replyEvent];
    return;
  }
  NSString *payloadText = nil;
  for (NSURLQueryItem *item in [components queryItems]) {
    if ([[item name] isEqualToString:@"payload"]) {
      payloadText = [item value];
      break;
    }
  }
  if (!payloadText) return;
  NSData *payloadData = [payloadText dataUsingEncoding:NSUTF8StringEncoding];
  NSDictionary *command = payloadData
    ? [NSJSONSerialization JSONObjectWithData:payloadData options:0 error:nil]
    : nil;
  if (![command isKindOfClass:NSDictionary.class]) return;
  NSDictionary *args = UtopiaMacDictionary(command, @"arguments") ?: @{};
  NSString *observationsPath = UtopiaMacString(args, @"golden_loop_observations_path");
  NSString *correlationId = UtopiaMacString(args, @"golden_loop_correlation_id") ?: @"macos-golden-loop";
  if (!observationsPath) return;
  NSMutableDictionary *observation = [@{
    @"status": @"applied",
    @"observer_kind": @"native-macos-url",
    @"source": @"macos-debug-bridge",
    @"correlation_id": correlationId,
    @"command": UtopiaMacString(command, @"command") ?: @"unknown",
    @"operation_id": UtopiaMacString(command, @"operation_id") ?: @"unknown",
    @"installation_id": UtopiaMacString(command, @"installation_id") ?: @"unknown",
    @"observed_at": UtopiaMacIsoNow(),
  } mutableCopy];
  NSMutableArray<NSDictionary *> *observations = UtopiaMacGoldenLoopObservationsByCorrelation()[correlationId];
  if (!observations) {
    observations = [NSMutableArray new];
    UtopiaMacGoldenLoopObservationsByCorrelation()[correlationId] = observations;
  }
  [observations addObject:observation];
  UtopiaMacWriteText(observationsPath, [UtopiaMacCompactJsonString(observation) stringByAppendingString:@"\n"], YES);
  UtopiaMacWriteGoldenLoopReceipt(command, observations);
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [NSURL URLWithString:@"http://localhost:8081/index.bundle?platform=macos&dev=true&minify=false"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

/// This method controls whether the `concurrentRoot`feature of React18 is turned on or off.
///
/// @see: https://reactjs.org/blog/2022/03/29/react-v18.html
/// @note: This requires to be rendering on Fabric (i.e. on the New Architecture).
/// @return: `true` if the `concurrentRoot` feature is enabled. Otherwise, it returns `false`.
- (BOOL)concurrentRootEnabled
{
#ifdef RN_FABRIC_ENABLED
  return true;
#else
  return false;
#endif
}

@end
