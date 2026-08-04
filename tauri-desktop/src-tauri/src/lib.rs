mod db;
mod models;

use db::{
    active_user, backup_app_data, create_initial_account, delete_category, delete_task,
    list_categories, list_tasks, login, logout, needs_setup, open_app_db, reschedule_overdue_tasks,
    reschedule_task, restore_app_data, save_category, save_task, today_string, toggle_task,
};
use models::{
    AccountInput, BootState, Category, CategoryInput, Task, TaskInput, TaskQuery, UserSession,
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
        let matches_status = query.include_completed || task.status != "done";
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
fn toggle_user_task(app: tauri::AppHandle, task_id: String) -> Result<Task, String> {
    let conn = open_app_db(&app)?;
    toggle_task(&conn, &require_user_id(&conn)?, &task_id)
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
            list_user_categories,
            save_user_category,
            remove_user_category,
            list_user_tasks,
            save_user_task,
            remove_user_task,
            toggle_user_task,
            reschedule_user_task,
            backup_app_data_command,
            restore_app_data_command
        ])
        .run(tauri::generate_context!())
        .expect("运行岁岁时光桌面端失败");
}
