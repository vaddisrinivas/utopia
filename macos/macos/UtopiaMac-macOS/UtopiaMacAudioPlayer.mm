#import "UtopiaMacAudioPlayer.h"

#import <AVFoundation/AVFoundation.h>
#import <Cocoa/Cocoa.h>

@interface UtopiaMacAudioPlayer () <AVAudioPlayerDelegate>
@property (nonatomic, strong) AVAudioPlayer *player;
@property (nonatomic, copy) NSString *fileName;
@property (nonatomic, assign) BOOL didJustFinish;
@end

@implementation UtopiaMacAudioPlayer

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_REMAP_METHOD(pickAudioFile,
                 pickAudioFileWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseDirectories = NO;
    panel.canChooseFiles = YES;
    panel.allowsMultipleSelection = NO;
    panel.allowedFileTypes = @[@"aac", @"aif", @"aiff", @"caf", @"m4a", @"mp3", @"mp4", @"wav"];

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || panel.URLs.count == 0) {
        resolve(@{ @"canceled": @YES });
        return;
      }

      NSURL *url = panel.URLs.firstObject;
      resolve(@{
        @"canceled": @NO,
        @"uri": url.absoluteString ?: @"",
        @"name": url.lastPathComponent ?: @"Audio file"
      });
    }];
  });
}

RCT_REMAP_METHOD(pickFile,
                 pickFileWithOptions:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  dispatch_async(dispatch_get_main_queue(), ^{
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    panel.canChooseDirectories = NO;
    panel.canChooseFiles = YES;
    panel.allowsMultipleSelection = [options[@"multiple"] boolValue];
    NSArray<NSString *> *fileTypes = [self fileTypesFromMimeTypes:options[@"mimeTypes"]];
    if (fileTypes.count > 0) {
      panel.allowedFileTypes = fileTypes;
    }

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || panel.URLs.count == 0) {
        resolve(@{ @"canceled": @YES });
        return;
      }

      NSMutableArray *assets = [NSMutableArray array];
      for (NSURL *url in panel.URLs) {
        NSNumber *size = [self fileSize:url];
        [assets addObject:@{
          @"uri": url.absoluteString ?: @"",
          @"name": url.lastPathComponent ?: @"Picked file",
          @"size": size ?: @0
        }];
      }
      resolve(@{ @"canceled": @NO, @"assets": assets });
    }];
  });
}

RCT_REMAP_METHOD(exportTextFile,
                 exportTextFileWithOptions:(NSDictionary *)options
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSString *content = [options[@"content"] isKindOfClass:NSString.class] ? options[@"content"] : @"";
  NSString *fileName = [self sanitizedFileName:options[@"fileName"]];
  dispatch_async(dispatch_get_main_queue(), ^{
    NSSavePanel *panel = [NSSavePanel savePanel];
    panel.nameFieldStringValue = fileName;
    NSArray<NSString *> *fileTypes = [self fileTypesFromMimeTypes:@[options[@"mimeType"] ?: @"text/plain"]];
    if (fileTypes.count > 0) {
      panel.allowedFileTypes = fileTypes;
    }

    [panel beginWithCompletionHandler:^(NSModalResponse result) {
      if (result != NSModalResponseOK || panel.URL == nil) {
        resolve(@{ @"canceled": @YES });
        return;
      }

      NSError *error = nil;
      BOOL ok = [content writeToURL:panel.URL atomically:YES encoding:NSUTF8StringEncoding error:&error];
      if (!ok) {
        reject(@"write_failed", error.localizedDescription ?: @"File could not be saved.", error);
        return;
      }
      resolve(@{
        @"canceled": @NO,
        @"uri": panel.URL.absoluteString ?: @"",
        @"name": panel.URL.lastPathComponent ?: fileName
      });
    }];
  });
}

RCT_REMAP_METHOD(openFile,
                 openFileWithUri:(NSString *)uri
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [self urlFromString:uri];
  if (url == nil) {
    reject(@"bad_uri", @"File URI is invalid.", nil);
    return;
  }
  dispatch_async(dispatch_get_main_queue(), ^{
    BOOL opened = [[NSWorkspace sharedWorkspace] openURL:url];
    if (!opened) {
      reject(@"open_failed", @"File could not be opened.", nil);
      return;
    }
    resolve(@{ @"opened": @YES });
  });
}

RCT_REMAP_METHOD(load,
                 loadWithUri:(NSString *)uri
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  NSURL *url = [self urlFromString:uri];
  if (url == nil) {
    reject(@"bad_uri", @"Audio file URI is invalid.", nil);
    return;
  }

  NSError *error = nil;
  AVAudioPlayer *player = [[AVAudioPlayer alloc] initWithContentsOfURL:url error:&error];
  if (error != nil || player == nil) {
    reject(@"load_failed", error.localizedDescription ?: @"Audio file could not be loaded.", error);
    return;
  }

  self.player = player;
  self.player.delegate = self;
  self.player.numberOfLoops = 0;
  self.fileName = url.lastPathComponent ?: @"Audio file";
  self.didJustFinish = NO;
  [self.player prepareToPlay];
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(playFromStart,
                 playFromStartWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  self.player.currentTime = 0;
  self.didJustFinish = NO;
  [self.player play];
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(resume,
                 resumeWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  self.didJustFinish = NO;
  [self.player play];
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(pause,
                 pauseWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  [self.player pause];
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(stop,
                 stopWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  [self.player stop];
  self.player.currentTime = 0;
  self.didJustFinish = NO;
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(seekTo,
                 seekToSeconds:(nonnull NSNumber *)seconds
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  NSTimeInterval nextTime = MAX(0, MIN(self.player.duration, seconds.doubleValue));
  self.player.currentTime = nextTime;
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(setVolume,
                 setVolumeValue:(nonnull NSNumber *)volume
                 resolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  self.player.volume = MAX(0, MIN(1, volume.floatValue));
  resolve([self statusDictionary]);
}

RCT_REMAP_METHOD(getStatus,
                 getStatusWithResolver:(RCTPromiseResolveBlock)resolve
                 rejecter:(RCTPromiseRejectBlock)reject)
{
  if (![self requirePlayer:reject]) return;
  resolve([self statusDictionary]);
}

- (NSURL *)urlFromString:(NSString *)uri
{
  if (uri.length == 0) return nil;
  NSURL *url = [NSURL URLWithString:uri];
  if (url != nil && url.scheme != nil) return url;
  return [NSURL fileURLWithPath:uri];
}

- (NSArray<NSString *> *)fileTypesFromMimeTypes:(id)value
{
  if (![value isKindOfClass:NSArray.class]) return @[];
  NSMutableOrderedSet<NSString *> *types = [NSMutableOrderedSet orderedSet];
  for (id raw in (NSArray *)value) {
    if (![raw isKindOfClass:NSString.class]) continue;
    NSString *mime = [(NSString *)raw lowercaseString];
    if ([mime isEqualToString:@"*/*"]) return @[];
    if ([mime isEqualToString:@"application/pdf"]) [types addObject:@"pdf"];
    else if ([mime isEqualToString:@"application/json"]) [types addObject:@"json"];
    else if ([mime hasPrefix:@"text/"]) {
      [types addObject:@"txt"];
      [types addObject:@"text"];
      [types addObject:@"md"];
      [types addObject:@"csv"];
      [types addObject:@"json"];
    } else if ([mime hasPrefix:@"image/"]) {
      [types addObject:@"png"];
      [types addObject:@"jpg"];
      [types addObject:@"jpeg"];
      [types addObject:@"webp"];
      [types addObject:@"gif"];
    } else if ([mime hasPrefix:@"audio/"]) {
      [types addObject:@"aac"];
      [types addObject:@"aif"];
      [types addObject:@"aiff"];
      [types addObject:@"caf"];
      [types addObject:@"m4a"];
      [types addObject:@"mp3"];
      [types addObject:@"mp4"];
      [types addObject:@"wav"];
    }
  }
  return types.array;
}

- (NSNumber *)fileSize:(NSURL *)url
{
  NSNumber *size = nil;
  [url getResourceValue:&size forKey:NSURLFileSizeKey error:nil];
  return size;
}

- (NSString *)sanitizedFileName:(id)value
{
  NSString *raw = [value isKindOfClass:NSString.class] && [(NSString *)value length] > 0 ? value : @"utopia-export.txt";
  NSCharacterSet *invalid = [NSCharacterSet characterSetWithCharactersInString:@"/\\?%*:|\"<>"];
  NSArray<NSString *> *parts = [raw componentsSeparatedByCharactersInSet:invalid];
  NSString *joined = [parts componentsJoinedByString:@"-"];
  return joined.length > 0 ? joined : @"utopia-export.txt";
}

- (BOOL)requirePlayer:(RCTPromiseRejectBlock)reject
{
  if (self.player != nil) return YES;
  reject(@"not_loaded", @"Choose an audio file first.", nil);
  return NO;
}

- (NSDictionary *)statusDictionary
{
  if (self.player == nil) {
    return @{
      @"loaded": @NO,
      @"playing": @NO,
      @"currentTime": @0,
      @"duration": @0,
      @"didJustFinish": @NO,
      @"fileName": @""
    };
  }

  return @{
    @"loaded": @YES,
    @"playing": @(self.player.isPlaying),
    @"currentTime": @(self.player.currentTime),
    @"duration": @(self.player.duration),
    @"didJustFinish": @(self.didJustFinish),
    @"fileName": self.fileName ?: @"Audio file"
  };
}

- (void)audioPlayerDidFinishPlaying:(AVAudioPlayer *)player successfully:(BOOL)flag
{
  self.didJustFinish = YES;
}

@end
