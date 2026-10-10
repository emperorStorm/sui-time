use crate::models::{ReminderNotificationRequest, ReminderPermissionResult};

#[repr(C)]
struct NativeNotificationRequest {
    identifier: *const std::ffi::c_char,
    title: *const std::ffi::c_char,
    body: *const std::ffi::c_char,
    trigger_at: i64,
}

unsafe extern "C" {
    fn sui_time_initialize_notifications();
    fn sui_time_notification_permission(error_message: *mut *mut std::ffi::c_char) -> i32;
    fn sui_time_request_notification_permission(error_message: *mut *mut std::ffi::c_char) -> i32;
    fn sui_time_replace_notifications(
        requests: *const NativeNotificationRequest,
        count: u64,
        error_message: *mut *mut std::ffi::c_char,
    ) -> i32;
    fn sui_time_clear_notifications(error_message: *mut *mut std::ffi::c_char) -> i32;
    fn sui_time_send_test_notification(error_message: *mut *mut std::ffi::c_char) -> i32;
    fn sui_time_open_notification_settings() -> i32;
    fn sui_time_free_error_message(error_message: *mut std::ffi::c_char);
}

const NOT_DETERMINED: i32 = 0;
const DENIED: i32 = 1;
const GRANTED: i32 = 2;
const ERROR: i32 = -1;
static REMINDER_WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

pub fn initialize() {
    unsafe { sui_time_initialize_notifications() };
}

pub fn permission() -> ReminderPermissionResult {
    let mut error_message = std::ptr::null_mut();
    let code = unsafe { sui_time_notification_permission(&mut error_message) };
    permission_result(code, take_error_message(error_message))
}

pub fn request_permission() -> ReminderPermissionResult {
    let mut error_message = std::ptr::null_mut();
    let code = unsafe { sui_time_request_notification_permission(&mut error_message) };
    permission_result(code, take_error_message(error_message))
}

pub fn replace_reminders(requests: Vec<ReminderNotificationRequest>) -> Result<(), String> {
    let _guard = REMINDER_WRITE_LOCK
        .lock()
        .map_err(|_| "系统提醒排程锁不可用")?;
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
    let mut error_message = std::ptr::null_mut();
    if unsafe {
        sui_time_replace_notifications(
            native_requests.as_ptr(),
            native_requests.len() as u64,
            &mut error_message,
        )
    } == 1
    {
        Ok(())
    } else {
        Err(take_error_message(error_message)
            .unwrap_or_else(|| "无法同步 macOS 系统提醒，请检查通知权限后重试".to_string()))
    }
}

pub fn clear_reminders() -> Result<(), String> {
    let _guard = REMINDER_WRITE_LOCK
        .lock()
        .map_err(|_| "系统提醒排程锁不可用")?;
    let mut error_message = std::ptr::null_mut();
    if unsafe { sui_time_clear_notifications(&mut error_message) } == 1 {
        Ok(())
    } else {
        Err(take_error_message(error_message).unwrap_or_else(|| "无法清除待发提醒".to_string()))
    }
}

pub fn send_test_notification() -> Result<(), String> {
    let mut error_message = std::ptr::null_mut();
    if unsafe { sui_time_send_test_notification(&mut error_message) } == 1 {
        Ok(())
    } else {
        Err(take_error_message(error_message)
            .unwrap_or_else(|| "测试通知发送失败，请检查系统通知设置".to_string()))
    }
}

pub fn open_notification_settings() -> Result<(), String> {
    if unsafe { sui_time_open_notification_settings() } == 1 {
        Ok(())
    } else {
        Err("无法打开 macOS 通知设置".to_string())
    }
}

fn permission_result(code: i32, detail: Option<String>) -> ReminderPermissionResult {
    match code {
        NOT_DETERMINED => ReminderPermissionResult {
            status: "not_determined".to_string(),
            detail,
        },
        DENIED => ReminderPermissionResult {
            status: "denied".to_string(),
            detail,
        },
        GRANTED => ReminderPermissionResult {
            status: "granted".to_string(),
            detail,
        },
        ERROR | _ => ReminderPermissionResult {
            status: "error".to_string(),
            detail: Some(detail.unwrap_or_else(|| "无法读取 macOS 通知权限".to_string())),
        },
    }
}

fn take_error_message(error_message: *mut std::ffi::c_char) -> Option<String> {
    if error_message.is_null() {
        return None;
    }
    let detail = unsafe { std::ffi::CStr::from_ptr(error_message) }
        .to_string_lossy()
        .into_owned();
    unsafe { sui_time_free_error_message(error_message) };
    Some(detail)
}

#[cfg(test)]
mod tests {
    use super::{permission_result, DENIED, ERROR, GRANTED, NOT_DETERMINED};

    #[test]
    fn native_bridge_preserves_pending_requests_and_presents_foreground_notifications() {
        let directory = tempfile::tempdir().expect("创建原生通知测试目录");
        let executable = directory.path().join("notification-bridge-test");
        let compilation = std::process::Command::new("clang")
            .current_dir(env!("CARGO_MANIFEST_DIR"))
            .args([
                "-fobjc-arc",
                "-fblocks",
                "-framework",
                "Foundation",
                "-framework",
                "AppKit",
                "-framework",
                "UserNotifications",
                "tests/macos_notifications_test.m",
                "-o",
            ])
            .arg(&executable)
            .output()
            .expect("编译原生通知桥接测试");
        assert!(
            compilation.status.success(),
            "原生测试编译失败：{}",
            String::from_utf8_lossy(&compilation.stderr)
        );
        let result = std::process::Command::new(&executable)
            .output()
            .expect("执行原生通知桥接测试");
        assert!(
            result.status.success(),
            "原生通知桥接测试失败：{}",
            String::from_utf8_lossy(&result.stderr)
        );
    }

    #[test]
    fn maps_native_permission_statuses_without_treating_unknown_as_denied() {
        assert_eq!(
            permission_result(NOT_DETERMINED, None).status,
            "not_determined"
        );
        assert_eq!(permission_result(DENIED, None).status, "denied");
        assert_eq!(permission_result(GRANTED, None).status, "granted");
        let result = permission_result(ERROR, Some("原生调用失败".to_string()));
        assert_eq!(result.status, "error");
        assert_eq!(result.detail.as_deref(), Some("原生调用失败"));
    }
}
