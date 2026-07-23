use std::{
    fs,
    fs::OpenOptions,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::{NaiveDate, NaiveTime};
use rand_core::{OsRng, RngCore};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::Manager;
use uuid::Uuid;

use crate::models::{AccountInput, Tag, TagInput, Task, TaskInput, UserSession};

const ACTIVE_USER_KEY: &str = "active_user_id";
const SCHEMA_VERSION: i64 = 2;
const BACKUP_MAGIC: &[u8] = b"SUITIME-BACKUP-1";
const BACKUP_SALT_LENGTH: usize = 16;
const BACKUP_NONCE_LENGTH: usize = 12;
const MAX_BACKUP_SIZE: u64 = 512 * 1024 * 1024;

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
    configure_connection(&conn)?;
    initialize(&conn)?;
    Ok(conn)
}

pub fn initialize(conn: &Connection) -> Result<(), String> {
    configure_connection(conn)?;
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| error.to_string())?;
    if version > SCHEMA_VERSION {
        return Err("本地数据版本高于当前客户端，请升级应用后再打开".to_string());
    }
    if version < 1 {
        migrate_to_v1(conn)?;
    }
    if version < 2 {
        migrate_to_v2(conn)?;
    }
    Ok(())
}

fn configure_connection(conn: &Connection) -> Result<(), String> {
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    conn.execute_batch(
        "PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;",
    )
    .map_err(|error| error.to_string())
}

fn migrate_to_v1(conn: &Connection) -> Result<(), String> {
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch(
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
        .map_err(|error| error.to_string())?;
    transaction
        .execute_batch("PRAGMA user_version = 1;")
        .map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
}

fn migrate_to_v2(conn: &Connection) -> Result<(), String> {
    let transaction = conn.unchecked_transaction().map_err(|error| error.to_string())?;
    transaction.execute_batch(
        "ALTER TABLE tasks ADD COLUMN planned_end_time TEXT;
         ALTER TABLE tasks ADD COLUMN schedule_kind TEXT NOT NULL DEFAULT 'all_day';
         ALTER TABLE tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'not_urgent_not_important';
         ALTER TABLE tasks ADD COLUMN repeat_rule TEXT NOT NULL DEFAULT '{\"kind\":\"none\"}';
         ALTER TABLE tasks ADD COLUMN occurrence_overrides TEXT NOT NULL DEFAULT '{}';
         ALTER TABLE tasks ADD COLUMN parent_task_id TEXT REFERENCES tasks(id) ON DELETE CASCADE;
         CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);",
    ).map_err(|error| error.to_string())?;
    transaction.execute_batch("PRAGMA user_version = 2;").map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())
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
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE tasks SET tag_id = NULL, updated_at = ?1 WHERE owner_id = ?2 AND tag_id = ?3",
            params![now_millis(), owner_id, tag_id],
        )
        .map_err(|error| error.to_string())?;
    let changed = transaction
        .execute(
            "DELETE FROM tags WHERE id = ?1 AND owner_id = ?2",
            params![tag_id, owner_id],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("标签不存在或无权删除".to_string());
    }
    transaction.commit().map_err(|error| error.to_string())
}

pub fn list_tasks(conn: &Connection, owner_id: &str) -> Result<Vec<Task>, String> {
    let mut statement = conn.prepare(
        "SELECT tasks.id, tasks.title, tasks.tag_id, tags.name, tags.color, tasks.planned_date, tasks.planned_time, tasks.planned_end_time, tasks.schedule_kind, tasks.priority, tasks.repeat_rule, tasks.occurrence_overrides, tasks.parent_task_id, tasks.status, tasks.notes, tasks.created_at, tasks.completed_at, tasks.updated_at
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
    validate_time(input.planned_end_time.as_deref())?;
    validate_task_options(&input)?;
    let tag_id = verify_tag(conn, owner_id, input.tag_id.as_deref())?;
    let now = now_millis();
    let id = input.id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let changed = conn.execute(
        "INSERT INTO tasks (id, owner_id, title, tag_id, planned_date, planned_time, planned_end_time, schedule_kind, priority, repeat_rule, occurrence_overrides, parent_task_id, status, notes, created_at, completed_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'todo', ?13, ?14, NULL, ?14)
         ON CONFLICT(id) DO UPDATE SET title = excluded.title, tag_id = excluded.tag_id, planned_date = excluded.planned_date, planned_time = excluded.planned_time, planned_end_time = excluded.planned_end_time, schedule_kind = excluded.schedule_kind, priority = excluded.priority, repeat_rule = excluded.repeat_rule, occurrence_overrides = excluded.occurrence_overrides, parent_task_id = excluded.parent_task_id, notes = excluded.notes, updated_at = excluded.updated_at WHERE tasks.owner_id = excluded.owner_id",
        params![id, owner_id, title, tag_id, input.planned_date, input.planned_time, input.planned_end_time, input.schedule_kind, input.priority, input.repeat_rule, input.occurrence_overrides, input.parent_task_id, input.notes.trim(), now],
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
        "SELECT tasks.id, tasks.title, tasks.tag_id, tags.name, tags.color, tasks.planned_date, tasks.planned_time, tasks.planned_end_time, tasks.schedule_kind, tasks.priority, tasks.repeat_rule, tasks.occurrence_overrides, tasks.parent_task_id, tasks.status, tasks.notes, tasks.created_at, tasks.completed_at, tasks.updated_at
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
        planned_end_time: row.get(7)?,
        schedule_kind: row.get(8)?,
        priority: row.get(9)?,
        repeat_rule: row.get(10)?,
        occurrence_overrides: row.get(11)?,
        parent_task_id: row.get(12)?,
        status: row.get(13)?,
        notes: row.get(14)?,
        created_at: row.get(15)?,
        completed_at: row.get(16)?,
        updated_at: row.get(17)?,
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
    if NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok() {
        Ok(())
    } else {
        Err("计划日期格式无效".to_string())
    }
}

fn validate_time(value: Option<&str>) -> Result<(), String> {
    let Some(value) = value.filter(|value| !value.trim().is_empty()) else {
        return Ok(());
    };
    if NaiveTime::parse_from_str(value, "%H:%M").is_ok() {
        Ok(())
    } else {
        Err("计划时间格式无效".to_string())
    }
}

fn validate_task_options(input: &TaskInput) -> Result<(), String> {
    if !["all_day", "point", "range"].contains(&input.schedule_kind.as_str()) {
        return Err("时间类型无效".to_string());
    }
    if !["urgent_important", "important_not_urgent", "urgent_not_important", "not_urgent_not_important"].contains(&input.priority.as_str()) {
        return Err("优先级无效".to_string());
    }
    if input.schedule_kind == "range" && (input.planned_time.is_none() || input.planned_end_time.is_none() || input.planned_time >= input.planned_end_time) {
        return Err("时间段的结束时间必须晚于开始时间".to_string());
    }
    if input.repeat_rule.len() > 4000 || input.occurrence_overrides.len() > 20000 {
        return Err("重复事项配置过长".to_string());
    }
    Ok(())
}

pub fn backup_app_data(
    app: &tauri::AppHandle,
    backup_path: String,
    password: String,
) -> Result<String, String> {
    let database_path = app_db_path(app)?;
    create_encrypted_backup(&database_path, Path::new(&backup_path), &password)?;
    Ok(backup_path)
}

pub fn restore_app_data(
    app: &tauri::AppHandle,
    backup_path: String,
    password: String,
) -> Result<String, String> {
    let database_path = app_db_path(app)?;
    let restored_bytes = decrypt_backup_file(Path::new(&backup_path), &password)?;
    let restore_path = temporary_database_path(&database_path, "restore");
    write_new_file(&restore_path, &restored_bytes)?;
    if let Err(error) = validate_database_file(&restore_path) {
        let _ = fs::remove_file(&restore_path);
        return Err(error);
    }

    let rollback_path =
        backup_directory(app)?.join(format!("before-restore-{}.suitime-backup", now_millis()));
    if let Err(error) = create_encrypted_backup(&database_path, &rollback_path, &password) {
        let _ = fs::remove_file(&restore_path);
        return Err(error);
    }
    replace_database_file(&database_path, &restore_path)?;
    Ok(format!(
        "数据已恢复，恢复前备份已保存到 {}",
        rollback_path.display()
    ))
}

fn backup_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app_db_path(app)?
        .parent()
        .ok_or_else(|| "无法确定本地数据目录".to_string())?
        .join("backups");
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    Ok(directory)
}

fn create_encrypted_backup(
    source: &Path,
    destination: &Path,
    password: &str,
) -> Result<(), String> {
    let snapshot = snapshot_database(source)?;
    let encrypted = encrypt_backup(&snapshot, password)?;
    write_new_file(destination, &encrypted)
}

fn snapshot_database(source: &Path) -> Result<Vec<u8>, String> {
    if !source.is_file() {
        return Err("当前没有可备份的本地数据".to_string());
    }
    let snapshot_path = temporary_database_path(source, "snapshot");
    let result = (|| {
        let conn = Connection::open(source).map_err(|error| error.to_string())?;
        configure_connection(&conn)?;
        let target = snapshot_path.to_string_lossy().replace('\'', "''");
        conn.execute_batch(&format!("VACUUM INTO '{target}'"))
            .map_err(|error| error.to_string())?;
        fs::read(&snapshot_path).map_err(|error| error.to_string())
    })();
    let _ = fs::remove_file(&snapshot_path);
    result
}

fn encrypt_backup(snapshot: &[u8], password: &str) -> Result<Vec<u8>, String> {
    validate_backup_password(password)?;
    if snapshot.len() as u64 > MAX_BACKUP_SIZE {
        return Err("本地数据过大，暂不支持导出".to_string());
    }
    let mut salt = [0_u8; BACKUP_SALT_LENGTH];
    let mut nonce = [0_u8; BACKUP_NONCE_LENGTH];
    OsRng.fill_bytes(&mut salt);
    OsRng.fill_bytes(&mut nonce);
    let cipher = Aes256Gcm::new_from_slice(&backup_key(password, &salt)?)
        .map_err(|_| "无法创建备份加密器".to_string())?;
    let encrypted = cipher
        .encrypt(Nonce::from_slice(&nonce), snapshot)
        .map_err(|_| "备份加密失败".to_string())?;
    let mut result =
        Vec::with_capacity(BACKUP_MAGIC.len() + salt.len() + nonce.len() + encrypted.len());
    result.extend_from_slice(BACKUP_MAGIC);
    result.extend_from_slice(&salt);
    result.extend_from_slice(&nonce);
    result.extend_from_slice(&encrypted);
    Ok(result)
}

fn decrypt_backup_file(path: &Path, password: &str) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|_| "无法读取备份文件".to_string())?;
    if metadata.len()
        > MAX_BACKUP_SIZE
            + BACKUP_MAGIC.len() as u64
            + BACKUP_SALT_LENGTH as u64
            + BACKUP_NONCE_LENGTH as u64
            + 16
    {
        return Err("备份文件过大，已拒绝恢复".to_string());
    }
    let encrypted = fs::read(path).map_err(|_| "无法读取备份文件".to_string())?;
    decrypt_backup(&encrypted, password)
}

fn decrypt_backup(encrypted: &[u8], password: &str) -> Result<Vec<u8>, String> {
    validate_backup_password(password)?;
    let header_length = BACKUP_MAGIC.len() + BACKUP_SALT_LENGTH + BACKUP_NONCE_LENGTH;
    if encrypted.len() <= header_length || !encrypted.starts_with(BACKUP_MAGIC) {
        return Err("备份文件格式无效".to_string());
    }
    let salt_start = BACKUP_MAGIC.len();
    let nonce_start = salt_start + BACKUP_SALT_LENGTH;
    let cipher =
        Aes256Gcm::new_from_slice(&backup_key(password, &encrypted[salt_start..nonce_start])?)
            .map_err(|_| "无法创建备份解密器".to_string())?;
    cipher
        .decrypt(
            Nonce::from_slice(&encrypted[nonce_start..header_length]),
            &encrypted[header_length..],
        )
        .map_err(|_| "备份密码错误或文件已损坏".to_string())
}

fn backup_key(password: &str, salt: &[u8]) -> Result<[u8; 32], String> {
    let mut key = [0_u8; 32];
    Argon2::default()
        .hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|_| "无法生成备份密钥".to_string())?;
    Ok(key)
}

fn validate_backup_password(password: &str) -> Result<(), String> {
    if password.chars().count() < 8 {
        return Err("备份密码至少需要 8 个字符".to_string());
    }
    Ok(())
}

fn validate_database_file(path: &Path) -> Result<(), String> {
    let conn = Connection::open(path).map_err(|_| "备份中的数据库无法打开".to_string())?;
    let check: String = conn
        .query_row("PRAGMA quick_check", [], |row| row.get(0))
        .map_err(|_| "备份中的数据库无法校验".to_string())?;
    if check != "ok" {
        return Err("备份中的数据库已损坏".to_string());
    }
    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|_| "备份中的数据库无法校验".to_string())?;
    if version > SCHEMA_VERSION {
        return Err("备份来自更高版本的客户端，请升级应用后再恢复".to_string());
    }
    for table in ["users", "app_settings", "tags", "tasks"] {
        let exists = conn
            .query_row(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
                [table],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "备份中的数据库无法校验".to_string())?
            .is_some();
        if !exists {
            return Err("备份不属于岁岁时光或版本过旧".to_string());
        }
    }
    Ok(())
}

fn replace_database_file(database_path: &Path, restored_path: &Path) -> Result<(), String> {
    let displaced_path = temporary_database_path(database_path, "previous");
    fs::rename(database_path, &displaced_path).map_err(|error| error.to_string())?;
    remove_sqlite_sidecars(database_path);
    if let Err(error) = fs::rename(restored_path, database_path) {
        let _ = fs::rename(&displaced_path, database_path);
        return Err(error.to_string());
    }
    let _ = fs::remove_file(displaced_path);
    Ok(())
}

fn temporary_database_path(database_path: &Path, purpose: &str) -> PathBuf {
    let parent = database_path.parent().unwrap_or_else(|| Path::new("."));
    parent.join(format!(".sui-time-{purpose}-{}.sqlite3", Uuid::new_v4()))
}

fn remove_sqlite_sidecars(database_path: &Path) {
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(format!("{}{}", database_path.display(), suffix));
    }
}

fn write_new_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
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
    fn migration_records_current_schema_version() {
        let conn = memory_db();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .unwrap();
        assert_eq!(version, SCHEMA_VERSION);
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
                planned_end_time: None, schedule_kind: "all_day".to_string(), priority: "not_urgent_not_important".to_string(), repeat_rule: "{\"kind\":\"none\"}".to_string(), occurrence_overrides: "{}".to_string(), parent_task_id: None,
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
    fn failed_tag_deletion_keeps_task_association() {
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
                planned_date: None,
                planned_time: None,
                planned_end_time: None, schedule_kind: "all_day".to_string(), priority: "not_urgent_not_important".to_string(), repeat_rule: "{\"kind\":\"none\"}".to_string(), occurrence_overrides: "{}".to_string(), parent_task_id: None,
                notes: String::new(),
            },
        )
        .unwrap();
        conn.execute_batch("CREATE TRIGGER block_tag_delete BEFORE DELETE ON tags BEGIN SELECT RAISE(ABORT, 'blocked'); END;").unwrap();

        assert!(delete_tag(&conn, &user.id, &tag.id).is_err());
        assert_eq!(
            get_task(&conn, &user.id, &task.id).unwrap().unwrap().tag_id,
            Some(tag.id)
        );
    }

    #[test]
    fn invalid_dates_and_times_are_rejected() {
        assert!(validate_date(Some("2026-02-29")).is_err());
        assert!(validate_date(Some("2026/07/17")).is_err());
        assert!(validate_time(Some("24:00")).is_err());
        assert!(validate_time(Some("12:60")).is_err());
    }

    #[test]
    fn time_ranges_and_task_options_are_validated() {
        let mut input = TaskInput {
            id: None, title: "时间段事项".to_string(), tag_id: None, planned_date: Some("2026-07-23".to_string()), planned_time: Some("18:00".to_string()), planned_end_time: Some("17:00".to_string()), schedule_kind: "range".to_string(), priority: "not_urgent_not_important".to_string(), repeat_rule: "{\"kind\":\"daily\"}".to_string(), occurrence_overrides: "{}".to_string(), parent_task_id: None, notes: String::new(),
        };
        assert!(validate_task_options(&input).is_err());
        input.planned_end_time = Some("19:00".to_string());
        assert!(validate_task_options(&input).is_ok());
        input.priority = "invalid".to_string();
        assert!(validate_task_options(&input).is_err());
    }

    #[test]
    fn encrypted_backup_can_be_verified_and_wrong_password_is_rejected() {
        let directory = tempfile::tempdir().unwrap();
        let source_path = directory.path().join("source.sqlite3");
        let conn = Connection::open(&source_path).unwrap();
        initialize(&conn).unwrap();
        create_initial_account(&conn, &account("备份用户")).unwrap();

        let snapshot = snapshot_database(&source_path).unwrap();
        let encrypted = encrypt_backup(&snapshot, "backup-password").unwrap();
        assert!(decrypt_backup(&encrypted, "wrong-password").is_err());

        let restored_path = directory.path().join("restored.sqlite3");
        write_new_file(
            &restored_path,
            &decrypt_backup(&encrypted, "backup-password").unwrap(),
        )
        .unwrap();
        validate_database_file(&restored_path).unwrap();
        let restored = Connection::open(restored_path).unwrap();
        assert_eq!(
            restored
                .query_row("SELECT COUNT(*) FROM users", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            1
        );
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
                planned_end_time: None, schedule_kind: "all_day".to_string(), priority: "not_urgent_not_important".to_string(), repeat_rule: "{\"kind\":\"none\"}".to_string(), occurrence_overrides: "{}".to_string(), parent_task_id: None,
                notes: String::new(),
            },
        )
        .unwrap();
        conn.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES ('user-b', '用户乙', 'unused', 0)", []).unwrap();
        assert!(delete_task(&conn, "user-b", &task.id).is_err());
    }
}
