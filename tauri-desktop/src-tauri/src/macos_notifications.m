#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <stdlib.h>
#include <string.h>

#import "macos_notifications.h"

static const int64_t SuiTimeTimeoutNanoseconds = 5LL * NSEC_PER_SEC;

@interface SuiTimeNotificationDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation SuiTimeNotificationDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
      willPresentNotification:(UNNotification *)notification
        withCompletionHandler:(void (^)(UNNotificationPresentationOptions))completionHandler {
  if (@available(macOS 11.0, *)) {
    completionHandler(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList | UNNotificationPresentationOptionSound);
  } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    // macOS 10.14–10.15 仍需使用旧展示选项。
    completionHandler(UNNotificationPresentationOptionAlert | UNNotificationPresentationOptionSound);
#pragma clang diagnostic pop
  }
}
@end

void sui_time_initialize_notifications(void) {
  if (@available(macOS 10.14, *)) {
    // 系统仅弱引用代理，使用进程级强引用保持其生命周期。
    static SuiTimeNotificationDelegate *delegate;
    static dispatch_once_t once;
    dispatch_once(&once, ^{
      delegate = [[SuiTimeNotificationDelegate alloc] init];
      [UNUserNotificationCenter currentNotificationCenter].delegate = delegate;
    });
  }
}

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
    __block UNNotificationSettings *result = nil;
    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
    [[UNUserNotificationCenter currentNotificationCenter] getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
      result = settings;
      dispatch_semaphore_signal(semaphore);
    }];
    if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) == 0 && result) {
      int status = sui_time_permission_status(result.authorizationStatus);
      if (status == SuiTimeNotificationGranted) {
        NSMutableArray<NSString *> *warnings = [NSMutableArray array];
        if (result.alertSetting == UNNotificationSettingDisabled || result.alertStyle == UNAlertStyleNone) [warnings addObject:@"系统横幅未开启，请在通知设置中检查提醒样式"];
        if (result.soundSetting == UNNotificationSettingDisabled) [warnings addObject:@"通知声音已关闭"];
        if (warnings.count) sui_time_set_error(error_message, nil, [warnings componentsJoinedByString:@"；"]);
      }
      return status;
    }
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
    return sui_time_notification_permission(error_message);
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
  return SuiTimeNotificationError;
}

static NSArray<UNNotificationRequest *> *sui_time_pending_notifications(UNUserNotificationCenter *center, char **error_message) {
  __block NSArray<UNNotificationRequest *> *pending = nil;
  dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);
  [center getPendingNotificationRequestsWithCompletionHandler:^(NSArray<UNNotificationRequest *> *requests) {
    pending = requests;
    dispatch_semaphore_signal(semaphore);
  }];
  if (dispatch_semaphore_wait(semaphore, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) != 0) {
    sui_time_set_error(error_message, nil, @"macOS 未及时返回待发提醒，原有排程已保留");
    return nil;
  }
  return pending;
}

static BOOL sui_time_is_task_reminder(NSString *identifier) {
  return [identifier hasPrefix:@"sui-time:"]
      && ![identifier isEqualToString:@"sui-time:notification-test"]
      && ![identifier isEqualToString:@"sui-time:permission-activation"];
}

int sui_time_replace_notifications(const SuiTimeNotificationRequest *requests, uint64_t count, char **error_message) {
  if (error_message) *error_message = NULL;
  if (@available(macOS 10.14, *)) {
    if (count > 64 || (count && !requests)) {
      sui_time_set_error(error_message, nil, @"提醒请求过多或无效，原有排程已保留");
      return 0;
    }
    UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
    NSArray<UNNotificationRequest *> *pending = sui_time_pending_notifications(center, error_message);
    if (!pending) return 0;
    NSMutableDictionary<NSString *, UNNotificationRequest *> *existing = [NSMutableDictionary dictionary];
    for (UNNotificationRequest *request in pending) existing[request.identifier] = request;
    NSMutableDictionary<NSString *, UNNotificationRequest *> *desired = [NSMutableDictionary dictionary];
    NSTimeInterval now = [[NSDate date] timeIntervalSince1970] * 1000;
    NSCalendar *calendar = [[NSCalendar alloc] initWithCalendarIdentifier:NSCalendarIdentifierGregorian];
    calendar.timeZone = [NSTimeZone timeZoneForSecondsFromGMT:0];
    for (uint64_t index = 0; index < count; index += 1) {
      const SuiTimeNotificationRequest request = requests[index];
      NSString *identifier = request.identifier ? [NSString stringWithUTF8String:request.identifier] : nil;
      NSString *title = request.title ? [NSString stringWithUTF8String:request.title] : nil;
      NSString *body = request.body ? [NSString stringWithUTF8String:request.body] : nil;
      if (!sui_time_is_task_reminder(identifier) || !title.length || !body.length || desired[identifier]) {
        sui_time_set_error(error_message, nil, @"提醒标识或内容无效，原有排程已保留");
        return 0;
      }
      if (request.trigger_at <= now) continue;
      UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
      content.title = title;
      content.body = body;
      content.sound = [UNNotificationSound defaultSound];
      content.userInfo = @{ @"suiTimeTriggerAt": @(request.trigger_at) };
      // 按绝对日期排程，避免每次同步都重置倒计时。
      NSDate *date = [NSDate dateWithTimeIntervalSince1970:request.trigger_at / 1000.0];
      NSDateComponents *components = [calendar components:NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay | NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond fromDate:date];
      components.calendar = calendar;
      components.timeZone = calendar.timeZone;
      UNCalendarNotificationTrigger *trigger = [UNCalendarNotificationTrigger triggerWithDateMatchingComponents:components repeats:NO];
      desired[identifier] = [UNNotificationRequest requestWithIdentifier:identifier content:content trigger:trigger];
    }

    dispatch_group_t group = dispatch_group_create();
    NSMutableArray<NSError *> *errors = [NSMutableArray array];
    for (NSString *identifier in desired) {
      UNNotificationRequest *notification = desired[identifier];
      UNNotificationRequest *previous = existing[identifier];
      if ([previous.content.title isEqualToString:notification.content.title]
          && [previous.content.body isEqualToString:notification.content.body]
          && [previous.content.userInfo[@"suiTimeTriggerAt"] isEqual:notification.content.userInfo[@"suiTimeTriggerAt"]]) continue;
      dispatch_group_enter(group);
      [center addNotificationRequest:notification withCompletionHandler:^(NSError *error) {
        if (error) @synchronized (errors) { [errors addObject:error]; }
        dispatch_group_leave(group);
      }];
    }
    if (dispatch_group_wait(group, dispatch_time(DISPATCH_TIME_NOW, SuiTimeTimeoutNanoseconds)) != 0) {
      sui_time_set_error(error_message, nil, @"macOS 未及时确认提醒排程，旧提醒未清理");
      return 0;
    }
    if (errors.count) {
      sui_time_set_error(error_message, errors.firstObject, @"macOS 无法添加提醒，旧提醒未清理");
      return 0;
    }
    NSMutableArray<NSString *> *removed = [NSMutableArray array];
    for (UNNotificationRequest *request in pending) {
      if (sui_time_is_task_reminder(request.identifier) && !desired[request.identifier]) [removed addObject:request.identifier];
    }
    if (removed.count) [center removePendingNotificationRequestsWithIdentifiers:removed];
    return 1;
  }
  sui_time_set_error(error_message, nil, @"当前 macOS 版本不支持系统通知");
  return 0;
}

int sui_time_clear_notifications(char **error_message) {
  return sui_time_replace_notifications(NULL, 0, error_message);
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
