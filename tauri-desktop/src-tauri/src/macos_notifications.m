#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>

#import "macos_notifications.h"

static const int64_t SuiTimeTimeoutNanoseconds = 5LL * NSEC_PER_SEC;

static int sui_time_permission_status(NSInteger status) {
  if (status == 2) return SuiTimeNotificationGranted;
  if (status == 1) return SuiTimeNotificationDenied;
  if (status == 0) return SuiTimeNotificationNotDetermined;
  return SuiTimeNotificationDenied;
}

int sui_time_notification_permission(void) {
  if (@available(macOS 10.14, *)) {
    __block int result = SuiTimeNotificationError;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      result = sui_time_permission_status(settings.authorizationStatus);
      dispatch_semaphore_signal(semaphore);
    }];
    return dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) == 0 ? result : SuiTimeNotificationError;
  }
  return SuiTimeNotificationError;
}

int sui_time_request_notification_permission(void) {
  if (@available(macOS 10.14, *)) {
    __block BOOL granted = NO;
    __block BOOL completed = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
    [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:options completionHandler:^(BOOL allowed, NSError *error) {
      granted = allowed && error == nil;
      completed = YES;
      dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) != 0 || !completed) return SuiTimeNotificationError;
    return granted ? SuiTimeNotificationGranted : SuiTimeNotificationDenied;
  }
  return SuiTimeNotificationError;
}

int sui_time_replace_notifications(const SuiTimeNotificationRequest *requests, uint64_t count) {
  if (@available(macOS 10.14, *)) {
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    [center removeAllPendingNotificationRequests];
    if (count == 0) return 1;

    dispatch_group_t group = dispatch_group_create();
    __block BOOL succeeded = YES;
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    for (uint64_t index = 0; index < count; index += 1) {
      const SuiTimeNotificationRequest request = requests[index];
      if (!request.identifier || !request.title || !request.body || request.trigger_at <= now) {
        succeeded = NO;
        continue;
      }
      UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
      content.title = [NSString stringWithUTF8String:request.title];
      content.body = [NSString stringWithUTF8String:request.body];
      content.sound = [UNNotificationSound defaultSound];
      NSTimeInterval delay = MAX(1, (request.trigger_at - now) / 1000);
      UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:delay repeats:NO];
      UNNotificationRequest *notification = [UNNotificationRequest requestWithIdentifier:[NSString stringWithUTF8String:request.identifier] content:content trigger:trigger];
      dispatch_group_enter(group);
      [center addNotificationRequest:notification withCompletionHandler:^(NSError *error) {
        if (error != nil) succeeded = NO;
        dispatch_group_leave(group);
      }];
    }
    if (dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) != 0) return 0;
    return succeeded ? 1 : 0;
  }
  return 0;
}

int sui_time_clear_notifications(void) {
  if (@available(macOS 10.14, *)) {
    [[UNUserNotificationCenter currentNotificationCenter] removeAllPendingNotificationRequests];
    return 1;
  }
  return 0;
}

int sui_time_send_test_notification(void) {
  if (@available(macOS 10.14, *)) {
    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = @"岁岁时光通知测试";
    content.body = @"系统提醒已经准备就绪。";
    content.sound = [UNNotificationSound defaultSound];
    UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:1 repeats:NO];
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:@"sui-time:notification-test" content:content trigger:trigger];
    __block BOOL succeeded = NO;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:^(NSError *error) {
      succeeded = error == nil;
      dispatch_semaphore_signal(semaphore);
    }];
    return dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) == 0 && succeeded ? 1 : 0;
  }
  return 0;
}

int sui_time_open_notification_settings(void) {
  NSURL *url = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.Notifications-Settings.extension"];
  return [[NSWorkspace sharedWorkspace] openURL:url] ? 1 : 0;
}
