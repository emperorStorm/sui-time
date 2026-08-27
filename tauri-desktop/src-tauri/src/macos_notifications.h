#import <stdint.h>

typedef struct {
  const char *identifier;
  const char *title;
  const char *body;
  int64_t trigger_at;
} SuiTimeNotificationRequest;

enum {
  SuiTimeNotificationNotDetermined = 0,
  SuiTimeNotificationDenied = 1,
  SuiTimeNotificationGranted = 2,
  SuiTimeNotificationError = -1,
};

int sui_time_notification_permission(char **error_message);
int sui_time_request_notification_permission(char **error_message);
int sui_time_replace_notifications(const SuiTimeNotificationRequest *requests, uint64_t count);
int sui_time_clear_notifications(void);
int sui_time_send_test_notification(char **error_message);
int sui_time_open_notification_settings(void);
void sui_time_free_error_message(char *error_message);
