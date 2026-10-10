#import <objc/runtime.h>
#import "../src/macos_notifications.m"

// 替换通知中心，验证原生桥接而不触碰用户权限或真实待发通知。
@interface SuiTimeTestSettings : NSObject
@property NSInteger authorizationStatus;
@property NSInteger alertSetting;
@property NSInteger alertStyle;
@property NSInteger soundSetting;
@end
@implementation SuiTimeTestSettings
@end

@interface SuiTimeTestCenter : NSObject
@property (weak) id<UNUserNotificationCenterDelegate> delegate;
@property NSMutableDictionary<NSString *, UNNotificationRequest *> *pending;
@property NSMutableArray<NSString *> *writes;
@property SuiTimeTestSettings *settings;
@property BOOL rejectAdd;
@end
@implementation SuiTimeTestCenter
- (void)getNotificationSettingsWithCompletionHandler:(void (^)(UNNotificationSettings *))completion {
  completion((UNNotificationSettings *)self.settings);
}
- (void)getPendingNotificationRequestsWithCompletionHandler:(void (^)(NSArray<UNNotificationRequest *> *))completion {
  completion(self.pending.allValues);
}
- (void)addNotificationRequest:(UNNotificationRequest *)request withCompletionHandler:(void (^)(NSError *))completion {
  [self.writes addObject:[@"add:" stringByAppendingString:request.identifier]];
  if (self.rejectAdd) {
    completion([NSError errorWithDomain:UNErrorDomain code:1 userInfo:@{NSLocalizedDescriptionKey: @"模拟系统拒绝提醒"}]);
    return;
  }
  self.pending[request.identifier] = request;
  completion(nil);
}
- (void)removePendingNotificationRequestsWithIdentifiers:(NSArray<NSString *> *)identifiers {
  for (NSString *identifier in identifiers) {
    [self.writes addObject:[@"remove:" stringByAppendingString:identifier]];
    [self.pending removeObjectForKey:identifier];
  }
}
@end

static SuiTimeTestCenter *testCenter;
static id test_notification_center(id object, SEL selector) { return testCenter; }

#define CHECK(condition, message) do { if (!(condition)) { NSLog(@"失败：%@", message); return 1; } } while (0)

int main(void) {
  @autoreleasepool {
    testCenter = [[SuiTimeTestCenter alloc] init];
    testCenter.pending = [NSMutableDictionary dictionary];
    testCenter.writes = [NSMutableArray array];
    testCenter.settings = [[SuiTimeTestSettings alloc] init];
    testCenter.settings.authorizationStatus = UNAuthorizationStatusAuthorized;
    testCenter.settings.alertSetting = UNNotificationSettingEnabled;
    testCenter.settings.alertStyle = UNAlertStyleBanner;
    testCenter.settings.soundSetting = UNNotificationSettingEnabled;
    Method method = class_getClassMethod([UNUserNotificationCenter class], @selector(currentNotificationCenter));
    IMP original = method_setImplementation(method, (IMP)test_notification_center);

    sui_time_initialize_notifications();
    CHECK(testCenter.delegate != nil, @"前台通知代理必须被强引用");
    __block UNNotificationPresentationOptions presentation = 0;
    [testCenter.delegate userNotificationCenter:(UNUserNotificationCenter *)testCenter willPresentNotification:(UNNotification *)[[NSObject alloc] init] withCompletionHandler:^(UNNotificationPresentationOptions options) { presentation = options; }];
    CHECK((presentation & UNNotificationPresentationOptionSound) != 0, @"前台通知应请求声音");
    CHECK((presentation & UNNotificationPresentationOptionBanner) != 0, @"前台通知应请求横幅");

    char *error = NULL;
    CHECK(sui_time_notification_permission(&error) == SuiTimeNotificationGranted && error == NULL, @"读取允许状态");
    testCenter.settings.soundSetting = UNNotificationSettingDisabled;
    testCenter.settings.alertStyle = UNAlertStyleNone;
    CHECK(sui_time_notification_permission(&error) == SuiTimeNotificationGranted, @"声音或横幅关闭不应误判为拒绝权限");
    NSString *detail = [NSString stringWithUTF8String:error];
    CHECK([detail containsString:@"横幅"] && [detail containsString:@"声音"], @"应返回横幅及声音的关闭提示");
    sui_time_free_error_message(error);
    error = NULL;
    testCenter.settings.authorizationStatus = UNAuthorizationStatusDenied;
    CHECK(sui_time_notification_permission(&error) == SuiTimeNotificationDenied, @"拒绝状态应独立识别");
    testCenter.settings.authorizationStatus = UNAuthorizationStatusNotDetermined;
    CHECK(sui_time_notification_permission(&error) == SuiTimeNotificationNotDetermined, @"未授权状态应独立识别");

    int64_t trigger = (int64_t)([[NSDate date] timeIntervalSince1970] + 600) * 1000;
    SuiTimeNotificationRequest first = {"sui-time:user:task:date:0:time", "测试事项", "日期时间", trigger};
    CHECK(sui_time_replace_notifications(&first, 1, &error) == 1, @"首次排程成功");
    UNNotificationRequest *saved = testCenter.pending[@"sui-time:user:task:date:0:time"];
    CHECK(fabs([[(UNCalendarNotificationTrigger *)saved.trigger nextTriggerDate] timeIntervalSince1970] * 1000 - trigger) < 1, @"绝对触发时间必须匹配");
    CHECK(sui_time_replace_notifications(&first, 1, &error) == 1 && testCenter.writes.count == 1, @"重复同步不能重建未变化请求");

    UNMutableNotificationContent *content = [[UNMutableNotificationContent alloc] init];
    testCenter.pending[@"sui-time:notification-test"] = [UNNotificationRequest requestWithIdentifier:@"sui-time:notification-test" content:content trigger:nil];
    testCenter.pending[@"sui-time:permission-activation"] = [UNNotificationRequest requestWithIdentifier:@"sui-time:permission-activation" content:content trigger:nil];
    testCenter.pending[@"unrelated"] = [UNNotificationRequest requestWithIdentifier:@"unrelated" content:content trigger:nil];

    SuiTimeNotificationRequest changed = {"sui-time:user:task:date:0:time", "修改标题", "日期时间", trigger};
    CHECK(sui_time_replace_notifications(&changed, 1, &error) == 1 && testCenter.writes.count == 2, @"同标识内容变化应更新");
    CHECK(testCenter.pending.count == 4, @"测试通知和其他请求不应被误清理");

    SuiTimeNotificationRequest next = {"sui-time:user:next:date:0:time", "新事项", "日期时间", trigger};
    testCenter.rejectAdd = YES;
    CHECK(sui_time_replace_notifications(&next, 1, &error) == 0, @"添加失败应报告失败");
    CHECK(testCenter.pending[@"sui-time:user:task:date:0:time"] != nil, @"添加失败必须保留旧排程");
    CHECK([[NSString stringWithUTF8String:error] containsString:@"模拟系统拒绝"], @"应透传系统错误");
    sui_time_free_error_message(error);
    error = NULL;
    testCenter.rejectAdd = NO;
    CHECK(sui_time_replace_notifications(&next, 1, &error) == 1, @"失败后可重试");
    CHECK(testCenter.pending[@"sui-time:user:task:date:0:time"] == nil, @"成功后删除失效请求");
    CHECK([testCenter.writes[testCenter.writes.count - 2] hasPrefix:@"add:"] && [testCenter.writes.lastObject hasPrefix:@"remove:"], @"应先添加成功再删除旧请求");

    CHECK(sui_time_replace_notifications(&next, 65, &error) == 0 && testCenter.pending.count == 4, @"超过容量时不得清空旧排程");
    sui_time_free_error_message(error);
    error = NULL;
    SuiTimeNotificationRequest invalid = {NULL, "新事项", "日期时间", trigger};
    CHECK(sui_time_replace_notifications(&invalid, 1, &error) == 0 && testCenter.pending.count == 4, @"无效请求不得影响旧排程");
    sui_time_free_error_message(error);
    error = NULL;
    CHECK(sui_time_clear_notifications(&error) == 1, @"清理任务提醒成功");
    CHECK(testCenter.pending.count == 3 && testCenter.pending[@"sui-time:notification-test"] != nil, @"清理仅限任务提醒");
    SuiTimeNotificationRequest past = {"sui-time:user:past:date:0:time", "已过期", "日期时间", trigger - 1200000};
    CHECK(sui_time_replace_notifications(&past, 1, &error) == 1 && testCenter.pending.count == 3, @"已过去的触发点不能补发");
    method_setImplementation(method, original);
    NSLog(@"原生通知桥接回归检查全部通过");
  }
  return 0;
}
