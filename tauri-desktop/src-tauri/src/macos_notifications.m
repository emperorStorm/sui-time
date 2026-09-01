#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdlib.h>
#include <string.h>

#import "macos_notifications.h"

static const int64_t SuiTimeTimeoutNanoseconds = 5LL * NSEC_PER_SEC;

static int sui_time_permission_status(NSInteger status) {
  if (status == 2) return SuiTimeNotificationGranted;
  if (status == 1) return SuiTimeNotificationDenied;
  if (status == 0) return SuiTimeNotificationNotDetermined;
  return SuiTimeNotificationError;
}

static void sui_time_set_error(char **error_message, NSError *error, NSString *fallback) {
  if (!error_message) return;
  NSString *message = error.localizedDescription.length ? error.localizedDescription : fallback;
  if (!message.length) return;
  *error_message = strdup(message.UTF8String);
}

static int sui_time_add_notification(NSString *identifier, NSString *title, NSString *body, char **error_message) {
  if (@available(macOS 10.14, *)) {
    __block NSError *requestError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    content.title = title;
    content.body = body;
    content.sound = [UNNotificationSound defaultSound];
    UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:1 repeats:NO];
    UNNotificationRequest *request = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:trigger];
    [[UNUserNotificationCenter currentNotificationCenter] addNotificationRequest:request withCompletionHandler:^(NSError *error) {
      requestError = error;
      dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) != 0) {
      sui_time_set_error(error_message, nil, @"macOS 未及时确认通知请求");
      return 0;
    }
    if (requestError != nil) {
      sui_time_set_error(error_message, requestError, @"macOS 无法添加通知请求");
      return 0;
    }
    return 1;
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
  return 0;
}

int sui_time_notification_permission(char **error_message) {
  if (error_message) *error_message = NULL;
  if (@available(macOS 10.14, *)) {
    __block int result = SuiTimeNotificationError;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      result = sui_time_permission_status(settings.authorizationStatus);
      dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) == 0) return result;
    sui_time_set_error(error_message, nil, @"macOS 未及时返回通知权限状态");
    return SuiTimeNotificationError;
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
  return SuiTimeNotificationError;
}

int sui_time_request_notification_permission(char **error_message) {
  if (error_message) *error_message = NULL;
  if (@available(macOS 10.14, *)) {
    __block BOOL granted = NO;
    __block NSError *requestError = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge;
    dispatch_async(dispatch_get_main_queue(), ^{
      [[UNUserNotificationCenter currentNotificationCenter] requestAuthorizationWithOptions:options completionHandler:^(BOOL allowed, NSError *error) {
        granted = allowed;
        requestError = error;
        dispatch_semaphore_signal(semaphore);
      }];
    });
    dispatch_semaphore_wait(semaphore, DISPATCH_TIME_FOREVER);
    if ([requestError.domain isEqualToString:UNErrorDomain]
        && requestError.code == UNErrorCodeNotificationsNotAllowed) {
      return SuiTimeNotificationDenied;
    }
    if (requestError != nil) {
      sui_time_set_error(error_message, requestError, @"macOS 无法请求通知权限");
      return SuiTimeNotificationError;
    }
    if (!granted) return SuiTimeNotificationDenied;
    if (!sui_time_add_notification(@"sui-time:permission-activation", @"岁岁时光通知已开启", @"系统提醒已准备就绪。", error_message)) return SuiTimeNotificationError;
    return SuiTimeNotificationGranted;
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
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

int sui_time_send_test_notification(char **error_message) {
  if (error_message) *error_message = NULL;
  if (@available(macOS 10.14, *)) {
    return sui_time_add_notification(@"sui-time:notification-test", @"岁岁时光通知测试", @"系统提醒已经准备就绪。", error_message);
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
  return 0;
}

int sui_time_open_notification_settings(void) {
  NSURL *url = [NSURL URLWithString:@"x-apple.systempreferences:com.apple.Notifications-Settings.extension"];
  return [[NSWorkspace sharedWorkspace] openURL:url] ? 1 : 0;
}

void sui_time_free_error_message(char *error_message) {
  free(error_message);
}
