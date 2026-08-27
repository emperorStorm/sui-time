mod db;
#[cfg(target_os = "macos")]
mod macos_notifications;
mod models;

use db::{
    active_user, backup_app_data, complete_task_with_children, count_unfinished_task_children,
    create_initial_account, delete_category, delete_task, list_categories, list_task_children,
    list_tasks, login, logout, needs_setup, open_app_db, reschedule_overdue_tasks, reschedule_task,
    restore_app_data, save_category, save_show_completed, save_task, set_task_status,
    sync_task_children, today_string,
};
use models::{
    AccountInput, BootState, Category, CategoryInput, ReminderNotificationRequest,
    ReminderPermissionResult, Task, TaskChildrenInput, TaskInput, TaskQuery, UserSession,
};

#[tauri::command]
fn get_boot_state(app: tauri::AppHandle) -> Result<BootState, String> {
    let conn = open_app_db(&app)?;
    Ok(BootState {
        needs_setup: needs_setup(&conn)?,
        session: active_user(&conn)?,
    })
}

#[tauri::command]
fn create_account(app: tauri::AppHandle, input: AccountInput) -> Result<UserSession, String> {
    create_initial_account(&open_app_db(&app)?, &input)
}

#[tauri::command]
fn login_user(app: tauri::AppHandle, input: AccountInput) -> Result<UserSession, String> {
    login(&open_app_db(&app)?, &input)
}

#[tauri::command]
fn logout_user(app: tauri::AppHandle) -> Result<(), String> {
    logout(&open_app_db(&app)?)
}

#[tauri::command]
fn save_user_show_completed(app: tauri::AppHandle, show_completed: bool) -> Result<bool, String> {
    let conn = open_app_db(&app)?;
    save_show_completed(&conn, &require_user_id(&conn)?, show_completed)
}

#[tauri::command]
fn list_user_categories(app: tauri::AppHandle) -> Result<Vec<Category>, String> {
    let conn = open_app_db(&app)?;
    list_categories(&conn, &require_user_id(&conn)?)
}

#[tauri::command]
fn save_user_category(app: tauri::AppHandle, input: CategoryInput) -> Result<Category, String> {
    let conn = open_app_db(&app)?;
    save_category(&conn, &require_user_id(&conn)?, input)
}

#[tauri::command]
fn remove_user_category(app: tauri::AppHandle, category_id: String) -> Result<(), String> {
    let conn = open_app_db(&app)?;
    delete_category(&conn, &require_user_id(&conn)?, &category_id)
}

#[tauri::command]
fn list_user_tasks(app: tauri::AppHandle, query: TaskQuery) -> Result<Vec<Task>, String> {
    let conn = open_app_db(&app)?;
    let owner_id = require_user_id(&conn)?;
    reschedule_overdue_tasks(&conn, &owner_id, &today_string())?;
    let mut tasks = list_tasks(&conn, &owner_id)?;
    let search = query.search.unwrap_or_default().trim().to_lowercase();
    tasks.retain(|task| {
        let matches_status = query.include_completed || task.status == "todo";
        let matches_search = search.is_empty()
            || task.title.to_lowercase().contains(&search)
            || task.notes.to_lowercase().contains(&search);
        let matches_start = query.start_date.as_ref().is_none_or(|date| {
            task.planned_date
                .as_ref()
                .is_some_and(|value| value >= date)
        });
        let matches_end = query.end_date.as_ref().is_none_or(|date| {
            task.planned_date
                .as_ref()
                .is_some_and(|value| value <= date)
        });
        matches_status && matches_search && matches_start && matches_end
    });
    Ok(tasks)
}

#[tauri::command]
fn save_user_task(app: tauri::AppHandle, input: TaskInput) -> Result<Task, String> {
    let conn = open_app_db(&app)?;
    save_task(&conn, &require_user_id(&conn)?, input)
}

#[tauri::command]
fn remove_user_task(app: tauri::AppHandle, task_id: String) -> Result<(), String> {
    let conn = open_app_db(&app)?;
    delete_task(&conn, &require_user_id(&conn)?, &task_id)
}

#[tauri::command]
fn list_user_task_children(
    app: tauri::AppHandle,
    parent_task_id: String,
) -> Result<Vec<Task>, String> {
    let conn = open_app_db(&app)?;
    list_task_children(&conn, &require_user_id(&conn)?, &parent_task_id)
}

#[tauri::command]
fn sync_user_task_children(
    app: tauri::AppHandle,
    input: TaskChildrenInput,
) -> Result<Vec<Task>, String> {
    let conn = open_app_db(&app)?;
    sync_task_children(&conn, &require_user_id(&conn)?, input)
}

#[tauri::command]
fn set_user_task_status(
    app: tauri::AppHandle,
    task_id: String,
    status: String,
    failure_reason: Option<String>,
) -> Result<Task, String> {
    let conn = open_app_db(&app)?;
    set_task_status(
        &conn,
        &require_user_id(&conn)?,
        &task_id,
        &status,
        failure_reason.as_deref(),
    )
}

#[tauri::command]
fn count_unfinished_user_task_children(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<usize, String> {
    let conn = open_app_db(&app)?;
    count_unfinished_task_children(&conn, &require_user_id(&conn)?, &task_id)
}

#[tauri::command]
fn complete_user_task_with_children(
    app: tauri::AppHandle,
    task_id: String,
) -> Result<Task, String> {
    let conn = open_app_db(&app)?;
    complete_task_with_children(&conn, &require_user_id(&conn)?, &task_id)
}

#[tauri::command]
fn reschedule_user_task(
    app: tauri::AppHandle,
    task_id: String,
    planned_date: Option<String>,
) -> Result<Task, String> {
    let conn = open_app_db(&app)?;
    reschedule_task(&conn, &require_user_id(&conn)?, &task_id, planned_date)
}

#[tauri::command]
fn backup_app_data_command(
    app: tauri::AppHandle,
    backup_path: String,
    password: String,
) -> Result<String, String> {
    backup_app_data(&app, backup_path, password)
}

#[tauri::command]
fn restore_app_data_command(
    app: tauri::AppHandle,
    backup_path: String,
    password: String,
) -> Result<String, String> {
    restore_app_data(&app, backup_path, password)
}

#[tauri::command]
async fn get_native_reminder_permission() -> ReminderPermissionResult {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(macos_notifications::permission)
        .await
        .unwrap_or_else(|error| ReminderPermissionResult {
            status: "error".to_string(),
            detail: Some(format!("无法读取 macOS 通知权限：{error}")),
        });
    #[cfg(not(target_os = "macos"))]
    ReminderPermissionResult {
        status: "unsupported".to_string(),
        detail: None,
    }
}

#[tauri::command]
async fn request_native_reminder_permission() -> ReminderPermissionResult {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(macos_notifications::request_permission)
        .await
        .unwrap_or_else(|error| ReminderPermissionResult {
            status: "error".to_string(),
            detail: Some(format!("无法请求 macOS 通知权限：{error}")),
        });
    #[cfg(not(target_os = "macos"))]
    ReminderPermissionResult {
        status: "unsupported".to_string(),
        detail: None,
    }
}

#[tauri::command]
async fn replace_native_reminders(
    requests: Vec<ReminderNotificationRequest>,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(move || {
        macos_notifications::replace_reminders(requests)
    })
    .await
    .map_err(|error| format!("无法同步 macOS 系统提醒：{error}"))?;
    #[cfg(not(target_os = "macos"))]
    {
        let _ = requests;
        Err("当前系统不支持原生提醒排程".to_string())
    }
}

#[tauri::command]
async fn clear_native_reminders() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(macos_notifications::clear_reminders)
        .await
        .map_err(|error| format!("无法清除待发提醒：{error}"))?;
    #[cfg(not(target_os = "macos"))]
    Ok(())
}

#[tauri::command]
async fn send_native_reminder_test_notification() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(macos_notifications::send_test_notification)
        .await
        .map_err(|error| format!("测试通知发送失败：{error}"))?;
    #[cfg(not(target_os = "macos"))]
    Err("当前系统不支持原生测试通知".to_string())
}

#[tauri::command]
async fn open_native_reminder_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    return tauri::async_runtime::spawn_blocking(macos_notifications::open_notification_settings)
        .await
        .map_err(|error| format!("无法打开 macOS 通知设置：{error}"))?;
    #[cfg(not(target_os = "macos"))]
    Err("当前系统不支持打开通知设置".to_string())
}

fn require_user_id(conn: &rusqlite::Connection) -> Result<String, String> {
    active_user(conn)?
        .map(|user| user.id)
        .ok_or_else(|| "当前未登录，请重新登录".to_string())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_boot_state,
            create_account,
            login_user,
            logout_user,
            save_user_show_completed,
            list_user_categories,
            save_user_category,
            remove_user_category,
            list_user_tasks,
            save_user_task,
            remove_user_task,
            list_user_task_children,
            sync_user_task_children,
            set_user_task_status,
            count_unfinished_user_task_children,
            complete_user_task_with_children,
            reschedule_user_task,
            backup_app_data_command,
            restore_app_data_command,
            get_native_reminder_permission,
            request_native_reminder_permission,
            replace_native_reminders,
            clear_native_reminders,
            send_native_reminder_test_notification,
            open_native_reminder_notification_settings
        ])
        .run(tauri::generate_context!())
        .expect("运行岁岁时光桌面端失败");
}
