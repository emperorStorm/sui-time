use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use rand_core::OsRng;
use rusqlite::{params, Connection, OptionalExtension};
use tauri::Manager;
use uuid::Uuid;

use crate::models::{AccountInput, Tag, TagInput, Task, TaskInput, UserSession};

const ACTIVE_USER_KEY: &str = "active_user_id";

pub fn app_db_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir.join("sui-time.sqlite3"))
}

pub fn open_app_db(app: &tauri::AppHandle) -> Result<Connection, String> {
    let conn = Connection::open(app_db_path(app)?).map_err(|error| error.to_string())?;
    initialize(&conn)?;
    Ok(conn)
}

pub fn initialize(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         CREATE TABLE IF NOT EXISTS users (
           id TEXT PRIMARY KEY,
           username TEXT NOT NULL UNIQUE COLLATE NOCASE,
           password_hash TEXT NOT NULL,
           created_at INTEGER NOT NULL
         );
         CREATE TABLE IF NOT EXISTS app_settings (
           setting_key TEXT PRIMARY KEY,
           setting_value TEXT NOT NULL
         );
         CREATE TABLE IF NOT EXISTS tags (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           name TEXT NOT NULL,
           color TEXT NOT NULL,
           sort_order INTEGER NOT NULL DEFAULT 0,
           created_at INTEGER NOT NULL,
           updated_at INTEGER NOT NULL,
           UNIQUE(owner_id, name)
         );
         CREATE TABLE IF NOT EXISTS tasks (
           id TEXT PRIMARY KEY,
           owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
           title TEXT NOT NULL,
           tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
           planned_date TEXT,
           planned_time TEXT,
           status TEXT NOT NULL CHECK(status IN ('todo', 'done')),
           notes TEXT NOT NULL DEFAULT '',
           created_at INTEGER NOT NULL,
           completed_at INTEGER,
           updated_at INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_tasks_owner_date ON tasks(owner_id, planned_date);
         CREATE INDEX IF NOT EXISTS idx_tags_owner_sort ON tags(owner_id, sort_order);",
    )
    .map_err(|error| error.to_string())
}

pub fn needs_setup(conn: &Connection) -> Result<bool, String> {
    let count: i64 = conn
        .query_row("SELECT COUNT(*) FROM users", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    Ok(count == 0)
}

pub fn create_initial_account(
    conn: &Connection,
    input: &AccountInput,
) -> Result<UserSession, String> {
    if !needs_setup(conn)? {
        return Err("本机账号已创建，请直接登录".to_string());
    }
    validate_account(input)?;
    let now = now_millis();
    let user = UserSession {
        id: Uuid::new_v4().to_string(),
        username: input.username.trim().to_string(),
        display_name: input.username.trim().to_string(),
    };
    let hash = password_hash(&input.password)?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![user.id, user.username, hash, now],
    )
    .map_err(map_user_error)?;
    set_active_user(conn, &user.id)?;
    Ok(user)
}

pub fn login(conn: &Connection, input: &AccountInput) -> Result<UserSession, String> {
    validate_login(input)?;
    let row = conn
        .query_row(
            "SELECT id, username, password_hash FROM users WHERE username = ?1 COLLATE NOCASE",
            [input.username.trim()],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let (id, username, hash) = row.ok_or_else(|| "用户名或密码错误".to_string())?;
    let parsed = PasswordHash::new(&hash).map_err(|_| "本地账号数据异常".to_string())?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| "用户名或密码错误".to_string())?;
    set_active_user(conn, &id)?;
    Ok(UserSession {
        id,
        display_name: username.clone(),
        username,
    })
}

pub fn active_user(conn: &Connection) -> Result<Option<UserSession>, String> {
    let id = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
            [ACTIVE_USER_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(id) = id else { return Ok(None) };
    conn.query_row(
        "SELECT id, username FROM users WHERE id = ?1",
        [id],
        |row| {
            let username: String = row.get(1)?;
            Ok(UserSession {
                id: row.get(0)?,
                display_name: username.clone(),
                username,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

pub fn logout(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM app_settings WHERE setting_key = ?1",
        [ACTIVE_USER_KEY],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn list_tags(conn: &Connection, owner_id: &str) -> Result<Vec<Tag>, String> {
    let mut statement = conn.prepare("SELECT id, name, color, sort_order FROM tags WHERE owner_id = ?1 ORDER BY sort_order, name COLLATE NOCASE")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([owner_id], |row| {
            Ok(Tag {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                sort_order: row.get(3)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn save_tag(conn: &Connection, owner_id: &str, input: TagInput) -> Result<Tag, String> {
    let name = input.name.trim();
    if name.is_empty() || name.chars().count() > 20 {
        return Err("标签名称需为 1 至 20 个字符".to_string());
    }
    if !is_hex_color(&input.color) {
        return Err("请选择有效的标签颜色".to_string());
    }
    let now = now_millis();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let changed = conn.execute(
        "INSERT INTO tags (id, owner_id, name, color, sort_order, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, sort_order = excluded.sort_order, updated_at = excluded.updated_at WHERE tags.owner_id = excluded.owner_id",
        params![id, owner_id, name, input.color, input.sort_order, now],
    ).map_err(map_tag_error)?;
    if changed == 0 {
        return Err("标签不存在或无权修改".to_string());
    }
    Ok(Tag {
        id,
        name: name.to_string(),
        color: input.color,
        sort_order: input.sort_order,
    })
}

pub fn delete_tag(conn: &Connection, owner_id: &str, tag_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE tasks SET tag_id = NULL, updated_at = ?1 WHERE owner_id = ?2 AND tag_id = ?3",
        params![now_millis(), owner_id, tag_id],
    )
    .map_err(|error| error.to_string())?;
    let changed = conn
        .execute(
            "DELETE FROM tags WHERE id = ?1 AND owner_id = ?2",
            params![tag_id, owner_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("标签不存在或无权删除".to_string());
    }
    Ok(())
}

pub fn list_tasks(conn: &Connection, owner_id: &str) -> Result<Vec<Task>, String> {
    let mut statement = conn.prepare(
        "SELECT tasks.id, tasks.title, tasks.tag_id, tags.name, tags.color, tasks.planned_date, tasks.planned_time, tasks.status, tasks.notes, tasks.created_at, tasks.completed_at, tasks.updated_at
         FROM tasks LEFT JOIN tags ON tags.id = tasks.tag_id AND tags.owner_id = tasks.owner_id
         WHERE tasks.owner_id = ?1
         ORDER BY CASE WHEN tasks.planned_date IS NULL THEN 1 ELSE 0 END, tasks.planned_date, tasks.planned_time, tasks.created_at DESC",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([owner_id], task_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn save_task(conn: &Connection, owner_id: &str, input: TaskInput) -> Result<Task, String> {
    let title = input.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err("事项标题需为 1 至 120 个字符".to_string());
    }
    validate_date(input.planned_date.as_deref())?;
    validate_time(input.planned_time.as_deref())?;
    let tag_id = verify_tag(conn, owner_id, input.tag_id.as_deref())?;
    let now = now_millis();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let changed = conn.execute(
        "INSERT INTO tasks (id, owner_id, title, tag_id, planned_date, planned_time, status, notes, created_at, completed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'todo', ?7, ?8, NULL, ?8)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, tag_id = excluded.tag_id, planned_date = excluded.planned_date, planned_time = excluded.planned_time, notes = excluded.notes, updated_at = excluded.updated_at WHERE tasks.owner_id = excluded.owner_id",
        params![id, owner_id, title, tag_id, input.planned_date, input.planned_time, input.notes.trim(), now],
    ).map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("事项不存在或无权修改".to_string());
    }
    get_task(conn, owner_id, &id)?.ok_or_else(|| "事项保存失败".to_string())
}

pub fn delete_task(conn: &Connection, owner_id: &str, task_id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM tasks WHERE id = ?1 AND owner_id = ?2",
            params![task_id, owner_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("事项不存在或无权删除".to_string());
    }
    Ok(())
}

pub fn toggle_task(conn: &Connection, owner_id: &str, task_id: &str) -> Result<Task, String> {
    let current =
        get_task(conn, owner_id, task_id)?.ok_or_else(|| "事项不存在或无权修改".to_string())?;
    let done = current.status != "done";
    conn.execute("UPDATE tasks SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4 AND owner_id = ?5", params![if done { "done" } else { "todo" }, if done { Some(now_millis()) } else { None }, now_millis(), task_id, owner_id])
        .map_err(|error| error.to_string())?;
    get_task(conn, owner_id, task_id)?.ok_or_else(|| "事项修改失败".to_string())
}

pub fn reschedule_task(
    conn: &Connection,
    owner_id: &str,
    task_id: &str,
    planned_date: Option<String>,
) -> Result<Task, String> {
    validate_date(planned_date.as_deref())?;
    let changed = conn
        .execute(
            "UPDATE tasks SET planned_date = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4",
            params![planned_date, now_millis(), task_id, owner_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("事项不存在或无权修改".to_string());
    }
    get_task(conn, owner_id, task_id)?.ok_or_else(|| "事项修改失败".to_string())
}

fn get_task(conn: &Connection, owner_id: &str, task_id: &str) -> Result<Option<Task>, String> {
    conn.query_row(
        "SELECT tasks.id, tasks.title, tasks.tag_id, tags.name, tags.color, tasks.planned_date, tasks.planned_time, tasks.status, tasks.notes, tasks.created_at, tasks.completed_at, tasks.updated_at
         FROM tasks LEFT JOIN tags ON tags.id = tasks.tag_id AND tags.owner_id = tasks.owner_id WHERE tasks.id = ?1 AND tasks.owner_id = ?2",
        params![task_id, owner_id], task_from_row,
    ).optional().map_err(|error| error.to_string())
}

fn task_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        title: row.get(1)?,
        tag_id: row.get(2)?,
        tag_name: row.get(3)?,
        tag_color: row.get(4)?,
        planned_date: row.get(5)?,
        planned_time: row.get(6)?,
        status: row.get(7)?,
        notes: row.get(8)?,
        created_at: row.get(9)?,
        completed_at: row.get(10)?,
        updated_at: row.get(11)?,
    })
}

fn set_active_user(conn: &Connection, user_id: &str) -> Result<(), String> {
    conn.execute("INSERT INTO app_settings (setting_key, setting_value) VALUES (?1, ?2) ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value", params![ACTIVE_USER_KEY, user_id]).map_err(|error| error.to_string())?;
    Ok(())
}

fn verify_tag(
    conn: &Connection,
    owner_id: &str,
    tag_id: Option<&str>,
) -> Result<Option<String>, String> {
    let Some(tag_id) = tag_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let exists = conn
        .query_row(
            "SELECT 1 FROM tags WHERE id = ?1 AND owner_id = ?2",
            params![tag_id, owner_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if !exists {
        return Err("所选标签不存在或无权使用".to_string());
    }
    Ok(Some(tag_id.to_string()))
}

fn validate_account(input: &AccountInput) -> Result<(), String> {
    if input.username.trim().chars().count() < 2 || input.username.trim().chars().count() > 24 {
        return Err("用户名需为 2 至 24 个字符".to_string());
    }
    if input.password.chars().count() < 6 {
        return Err("密码至少需要 6 个字符".to_string());
    }
    Ok(())
}

fn validate_login(input: &AccountInput) -> Result<(), String> {
    if input.username.trim().is_empty() || input.password.is_empty() {
        return Err("用户名和密码不能为空".to_string());
    }
    Ok(())
}

fn password_hash(value: &str) -> Result<String, String> {
    let salt = SaltString::generate(&mut OsRng);
    Argon2::default()
        .hash_password(value.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| error.to_string())
}

fn validate_date(value: Option<&str>) -> Result<(), String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let valid = value.len() == 10
        && value.as_bytes().get(4) == Some(&b'-')
        && value.as_bytes().get(7) == Some(&b'-')
        && value
            .chars()
            .all(|char| char.is_ascii_digit() || char == '-');
    if valid {
        Ok(())
    } else {
        Err("计划日期格式无效".to_string())
    }
}

fn validate_time(value: Option<&str>) -> Result<(), String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    let valid = value.len() == 5
        && value.as_bytes().get(2) == Some(&b':')
        && value
            .chars()
            .all(|char| char.is_ascii_digit() || char == ':');
    if valid {
        Ok(())
    } else {
        Err("计划时间格式无效".to_string())
    }
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.chars().skip(1).all(|char| char.is_ascii_hexdigit())
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn map_user_error(error: rusqlite::Error) -> String {
    if error.to_string().contains("UNIQUE constraint failed") {
        "该用户名已存在".to_string()
    } else {
        error.to_string()
    }
}

fn map_tag_error(error: rusqlite::Error) -> String {
    if error.to_string().contains("UNIQUE constraint failed") {
        "已存在同名标签".to_string()
    } else {
        error.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        initialize(&conn).unwrap();
        conn
    }
    fn account(name: &str) -> AccountInput {
        AccountInput {
            username: name.to_string(),
            password: "password123".to_string(),
        }
    }

    #[test]
    fn setup_login_and_session_work() {
        let conn = memory_db();
        assert!(needs_setup(&conn).unwrap());
        let user = create_initial_account(&conn, &account("岁岁")).unwrap();
        assert_eq!(active_user(&conn).unwrap().unwrap().id, user.id);
        logout(&conn).unwrap();
        assert!(active_user(&conn).unwrap().is_none());
        assert_eq!(login(&conn, &account("岁岁")).unwrap().username, "岁岁");
    }

    #[test]
    fn deleting_tag_detaches_tasks() {
        let conn = memory_db();
        let user = create_initial_account(&conn, &account("用户甲")).unwrap();
        let tag = save_tag(
            &conn,
            &user.id,
            TagInput {
                id: None,
                name: "工作".to_string(),
                color: "#4F8EF7".to_string(),
                sort_order: 0,
            },
        )
        .unwrap();
        let task = save_task(
            &conn,
            &user.id,
            TaskInput {
                id: None,
                title: "完成方案".to_string(),
                tag_id: Some(tag.id.clone()),
                planned_date: Some("2026-07-16".to_string()),
                planned_time: None,
                notes: String::new(),
            },
        )
        .unwrap();
        delete_tag(&conn, &user.id, &tag.id).unwrap();
        assert!(get_task(&conn, &user.id, &task.id)
            .unwrap()
            .unwrap()
            .tag_id
            .is_none());
    }

    #[test]
    fn task_owner_cannot_be_spoofed() {
        let conn = memory_db();
        let first = create_initial_account(&conn, &account("用户甲")).unwrap();
        let task = save_task(
            &conn,
            &first.id,
            TaskInput {
                id: None,
                title: "私人事项".to_string(),
                tag_id: None,
                planned_date: None,
                planned_time: None,
                notes: String::new(),
            },
        )
        .unwrap();
        conn.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES ('user-b', '用户乙', 'unused', 0)", []).unwrap();
        assert!(delete_task(&conn, "user-b", &task.id).is_err());
    }
}
