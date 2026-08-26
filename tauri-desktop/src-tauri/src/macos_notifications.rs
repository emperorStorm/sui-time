use crate::models::ReminderNotificationRequest;

#[repr(C)]
struct NativeNotificationRequest {
    identifier: *const std::ffi::c_char,
    title: *const std::ffi::c_char,
    body: *const std::ffi::c_char,
    trigger_at: i64,
}

unsafe extern "C" {
    fn sui_time_notification_permission() -> i32;
    fn sui_time_request_notification_permission() -> i32;
    fn sui_time_replace_notifications(
        requests: *const NativeNotificationRequest,
        count: u64,
    ) -> i32;
    fn sui_time_clear_notifications() -> i32;
    fn sui_time_send_test_notification() -> i32;
    fn sui_time_open_notification_settings() -> i32;
}

const NOT_DETERMINED: i32 = 0;
const DENIED: i32 = 1;
const GRANTED: i32 = 2;

pub fn permission() -> Result<String, String> {
    permission_from_code(unsafe { sui_time_notification_permission() })
}

pub fn request_permission() -> Result<String, String> {
    permission_from_code(unsafe { sui_time_request_notification_permission() })
}

pub fn replace_reminders(requests: Vec<ReminderNotificationRequest>) -> Result<(), String> {
    if requests.len() > 64 {
        return Err("未来 48 小时的提醒过多，请减少提醒后重试".to_string());
    }
    let strings = requests
        .iter()
        .map(|request| {
            if request.identifier.is_empty() || request.title.is_empty() || request.body.is_empty()
            {
                return Err("提醒内容不完整".to_string());
            }
            Ok((
                std::ffi::CString::new(request.identifier.as_str()).map_err(|_| "提醒标识无效")?,
                std::ffi::CString::new(request.title.as_str()).map_err(|_| "提醒标题无效")?,
                std::ffi::CString::new(request.body.as_str()).map_err(|_| "提醒内容无效")?,
            ))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let native_requests = requests
        .iter()
        .zip(strings.iter())
        .map(|(request, strings)| NativeNotificationRequest {
            identifier: strings.0.as_ptr(),
            title: strings.1.as_ptr(),
            body: strings.2.as_ptr(),
            trigger_at: request.trigger_at,
        })
        .collect::<Vec<_>>();
    if unsafe {
        sui_time_replace_notifications(native_requests.as_ptr(), native_requests.len() as u64)
    } == 1
    {
        Ok(())
    } else {
        Err("无法同步 macOS 系统提醒，请检查通知权限后重试".to_string())
    }
}

pub fn clear_reminders() -> Result<(), String> {
    if unsafe { sui_time_clear_notifications() } == 1 {
        Ok(())
    } else {
        Err("无法清除待发提醒".to_string())
    }
}

pub fn send_test_notification() -> Result<(), String> {
    if unsafe { sui_time_send_test_notification() } == 1 {
        Ok(())
    } else {
        Err("测试通知发送失败，请检查系统通知设置".to_string())
    }
}

pub fn open_notification_settings() -> Result<(), String> {
    if unsafe { sui_time_open_notification_settings() } == 1 {
        Ok(())
    } else {
        Err("无法打开 macOS 通知设置".to_string())
    }
}

fn permission_from_code(code: i32) -> Result<String, String> {
    match code {
        NOT_DETERMINED => Ok("not_determined".to_string()),
        DENIED => Ok("denied".to_string()),
        GRANTED => Ok("granted".to_string()),
        _ => Err("无法读取 macOS 通知权限".to_string()),
    }
}
