use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use uuid::Uuid;

use crate::sync_merge::incoming_wins;

pub const ENTITY_CATEGORY: &str = "category";
pub const ENTITY_TASK: &str = "task";
pub const ENTITY_ANNIVERSARY: &str = "anniversary";
pub const ENTITY_ANNIVERSARY_RECORD: &str = "anniversary_record";
pub const ENTITY_SETTING: &str = "setting";

pub const SETTING_SHOW_TASKS: &str = "show_completed.tasks";
pub const SETTING_SHOW_WEEK: &str = "show_completed.week";
pub const SETTING_SHOW_MONTH: &str = "show_completed.month";
pub const SETTING_LAST_CATEGORY: &str = "desktop.last_task_category";
pub const SETTING_LAST_PRIORITY: &str = "desktop.last_task_priority";

const SYNC_DEVICE_KEY: &str = "sync_device_id";
const SYNC_ACCOUNT_PREFIX: &str = "sync_account:";

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncAccount {
    #[serde(default)]
    pub server_user_id: String,
    #[serde(default)]
    pub username: String,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub cursor: i64,
    #[serde(default)]
    pub last_sync_at: Option<i64>,
    #[serde(default)]
    pub bound: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncChange {
    pub entity: String,
    pub id: String,
    pub updated_at: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
    pub device_id: String,
    pub data: Value,
}

pub fn enqueue_outbox(
    conn: &Connection,
    owner_id: &str,
    entity: &str,
    entity_id: &str,
    updated_at: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO sync_outbox (owner_id, entity, entity_id, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(owner_id, entity, entity_id) DO UPDATE SET updated_at = excluded.updated_at",
        params![owner_id, entity, entity_id, updated_at],
    )
    .map_err(|error| error.to_string())?;
    if entity == ENTITY_SETTING {
        save_setting_version(
            conn,
            owner_id,
            entity_id,
            updated_at,
            &local_device_id(conn)?,
        )?;
    }
    Ok(())
}

pub fn pending_entries(
    conn: &Connection,
    owner_id: &str,
) -> Result<Vec<(String, String, i64)>, String> {
    let mut statement = conn
        .prepare("SELECT entity, entity_id, updated_at FROM sync_outbox WHERE owner_id = ?1 ORDER BY updated_at, entity_id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([owner_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn pending_count(conn: &Connection, owner_id: &str) -> Result<i64, String> {
    conn.query_row(
        "SELECT COUNT(*) FROM sync_outbox WHERE owner_id = ?1",
        [owner_id],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub fn clear_outbox_entry(
    conn: &Connection,
    owner_id: &str,
    entity: &str,
    entity_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM sync_outbox WHERE owner_id = ?1 AND entity = ?2 AND entity_id = ?3",
        params![owner_id, entity, entity_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn local_device_id(conn: &Connection) -> Result<String, String> {
    let existing = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
            [SYNC_DEVICE_KEY],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    if let Some(value) = existing {
        return Ok(value);
    }
    let device_id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (?1, ?2)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
        params![SYNC_DEVICE_KEY, device_id],
    )
    .map_err(|error| error.to_string())?;
    Ok(device_id)
}

fn account_key(owner_id: &str) -> String {
    format!("{SYNC_ACCOUNT_PREFIX}{owner_id}")
}

pub fn read_account(conn: &Connection, owner_id: &str) -> Result<Option<SyncAccount>, String> {
    let raw = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
            [account_key(owner_id)],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let Some(raw) = raw else { return Ok(None) };
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|_| "同步账号配置已损坏，请解绑后重新绑定".to_string())
}

pub fn save_account(
    conn: &Connection,
    owner_id: &str,
    account: &SyncAccount,
) -> Result<(), String> {
    let raw = serde_json::to_string(account).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (?1, ?2)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
        params![account_key(owner_id), raw],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn clear_account(conn: &Connection, owner_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM app_settings WHERE setting_key = ?1",
        [account_key(owner_id)],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

/// 恢复备份后同步上下文作废：保留本地数据，要求重新绑定账号。
pub fn reset_sync_state(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM sync_outbox", [])
        .map_err(|error| error.to_string())?;
    conn.execute(
        "DELETE FROM app_settings WHERE setting_key LIKE 'sync_account:%'",
        [],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn read_change(
    conn: &Connection,
    owner_id: &str,
    entity: &str,
    entity_id: &str,
    device_id: &str,
    fallback_updated_at: i64,
) -> Result<Option<SyncChange>, String> {
    match entity {
        ENTITY_CATEGORY => read_category_change(conn, owner_id, entity_id, device_id),
        ENTITY_TASK => read_task_change(conn, owner_id, entity_id, device_id),
        ENTITY_ANNIVERSARY => read_anniversary_change(conn, owner_id, entity_id, device_id),
        ENTITY_ANNIVERSARY_RECORD => read_record_change(conn, owner_id, entity_id, device_id),
        ENTITY_SETTING => Ok(read_setting_change(
            conn,
            owner_id,
            entity_id,
            device_id,
            fallback_updated_at,
        )?),
        _ => Ok(None),
    }
}

fn read_category_change(
    conn: &Connection,
    owner: &str,
    id: &str,
    device_id: &str,
) -> Result<Option<SyncChange>, String> {
    conn.query_row(
        "SELECT name, color, icon, sort_order, created_at, updated_at, deleted_at, device_id
         FROM categories WHERE owner_id = ?1 AND id = ?2",
        params![owner, id],
        |row| {
            let updated_at: i64 = row.get(5)?;
            Ok(SyncChange {
                entity: ENTITY_CATEGORY.to_string(),
                id: id.to_string(),
                updated_at,
                deleted_at: row.get(6)?,
                device_id: row_device_id(row, 7, device_id)?,
                data: json!({
                    "name": row.get::<_, String>(0)?,
                    "color": row.get::<_, String>(1)?,
                    "icon": row.get::<_, String>(2)?,
                    "sortOrder": row.get::<_, i64>(3)?,
                    "createdAt": row.get::<_, i64>(4)?,
                }),
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn read_task_change(
    conn: &Connection,
    owner: &str,
    id: &str,
    device_id: &str,
) -> Result<Option<SyncChange>, String> {
    conn.query_row(
        "SELECT title, category_id, planned_date, planned_time, planned_end_time, schedule_kind,
                priority, repeat_rule, occurrence_overrides, reminder_offsets, sort_order,
                parent_task_id, status, failure_reason, notes, created_at, completed_at, updated_at, deleted_at, device_id
         FROM tasks WHERE owner_id = ?1 AND id = ?2",
        params![owner, id],
        |row| {
            let offsets: String = row.get(9)?;
            let updated_at: i64 = row.get(17)?;
            Ok(SyncChange {
                entity: ENTITY_TASK.to_string(),
                id: id.to_string(),
                updated_at,
                deleted_at: row.get(18)?,
                device_id: row_device_id(row, 19, device_id)?,
                data: json!({
                    "title": row.get::<_, String>(0)?,
                    "categoryId": row.get::<_, Option<String>>(1)?,
                    "plannedDate": row.get::<_, Option<String>>(2)?,
                    "plannedTime": row.get::<_, Option<String>>(3)?,
                    "plannedEndTime": row.get::<_, Option<String>>(4)?,
                    "scheduleKind": row.get::<_, String>(5)?,
                    "priority": row.get::<_, String>(6)?,
                    "repeatRule": row.get::<_, String>(7)?,
                    "occurrenceOverrides": row.get::<_, String>(8)?,
                    "reminderOffsets": serde_json::from_str::<Value>(&offsets).unwrap_or(json!([])),
                    "sortOrder": row.get::<_, i64>(10)?,
                    "parentTaskId": row.get::<_, Option<String>>(11)?,
                    "status": row.get::<_, String>(12)?,
                    "failureReason": row.get::<_, Option<String>>(13)?,
                    "notes": row.get::<_, String>(14)?,
                    "createdAt": row.get::<_, i64>(15)?,
                    "completedAt": row.get::<_, Option<i64>>(16)?,
                }),
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn read_anniversary_change(
    conn: &Connection,
    owner: &str,
    id: &str,
    device_id: &str,
) -> Result<Option<SyncChange>, String> {
    conn.query_row(
        "SELECT kind, title, date, notes, pinned, theme, photos_json, cover_index,
                created_at, updated_at, deleted_at, device_id
         FROM anniversaries WHERE owner_id = ?1 AND id = ?2",
        params![owner, id],
        |row| {
            let photos: String = row.get(6)?;
            let updated_at: i64 = row.get(9)?;
            Ok(SyncChange {
                entity: ENTITY_ANNIVERSARY.to_string(),
                id: id.to_string(),
                updated_at,
                deleted_at: row.get(10)?,
                device_id: row_device_id(row, 11, device_id)?,
                data: json!({
                    "kind": row.get::<_, String>(0)?,
                    "title": row.get::<_, String>(1)?,
                    "date": row.get::<_, String>(2)?,
                    "notes": row.get::<_, String>(3)?,
                    "pinned": row.get::<_, bool>(4)?,
                    "theme": row.get::<_, String>(5)?,
                    "photos": serde_json::from_str::<Value>(&photos).unwrap_or(json!([])),
                    "coverIndex": row.get::<_, i64>(7)?,
                    "createdAt": row.get::<_, i64>(8)?,
                }),
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn read_record_change(
    conn: &Connection,
    owner: &str,
    id: &str,
    device_id: &str,
) -> Result<Option<SyncChange>, String> {
    let Some((anniversary_id, date)) = id.rsplit_once('@') else {
        return Ok(None);
    };
    conn.query_row(
        "SELECT notes, confirmed_at, title, kind, original_date, created_at, updated_at, deleted_at, device_id
         FROM anniversary_records WHERE owner_id = ?1 AND anniversary_id = ?2 AND date = ?3",
        params![owner, anniversary_id, date],
        |row| {
            let updated_at: i64 = row.get(6)?;
            Ok(SyncChange {
                entity: ENTITY_ANNIVERSARY_RECORD.to_string(),
                id: id.to_string(),
                updated_at,
                deleted_at: row.get(7)?,
                device_id: row_device_id(row, 8, device_id)?,
                data: json!({
                    "anniversaryId": anniversary_id,
                    "date": date,
                    "notes": row.get::<_, String>(0)?,
                    "confirmedAt": row.get::<_, Option<i64>>(1)?,
                    "title": row.get::<_, String>(2)?,
                    "kind": row.get::<_, String>(3)?,
                    "originalDate": row.get::<_, String>(4)?,
                    "createdAt": row.get::<_, i64>(5)?,
                }),
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
}

fn row_device_id(
    row: &rusqlite::Row<'_>,
    index: usize,
    fallback: &str,
) -> rusqlite::Result<String> {
    Ok(row
        .get::<_, Option<String>>(index)?
        .filter(|id| !id.is_empty())
        .unwrap_or_else(|| fallback.to_string()))
}

fn setting_version_key(owner: &str, key: &str) -> String {
    format!("sync_setting_version:{owner}:{key}")
}

fn save_setting_version(
    conn: &Connection,
    owner: &str,
    key: &str,
    updated: i64,
    device: &str,
) -> Result<(), String> {
    let raw = serde_json::to_string(&(updated, device)).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO app_settings (setting_key, setting_value) VALUES (?1, ?2)
         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
        params![setting_version_key(owner, key), raw],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn setting_version(
    conn: &Connection,
    owner: &str,
    key: &str,
    device: &str,
    fallback: i64,
) -> Result<(i64, String), String> {
    let raw: Option<String> = conn
        .query_row(
            "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
            [setting_version_key(owner, key)],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let saved: Option<(i64, String)> = raw
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(|error| format!("同步设置版本无效：{error}"))?;
    let pending: Option<i64> = conn.query_row(
        "SELECT updated_at FROM sync_outbox WHERE owner_id = ?1 AND entity = ?2 AND entity_id = ?3",
        params![owner, ENTITY_SETTING, key], |row| row.get(0),
    ).optional().map_err(|error| error.to_string())?;
    // 待上传值属于本机，必须与其 outbox 版本一起参与冲突比较。
    if let Some(updated) = pending {
        return Ok((updated, device.to_string()));
    }
    Ok(saved.unwrap_or_else(|| (fallback, device.to_string())))
}

fn read_setting_change(
    conn: &Connection,
    owner: &str,
    key: &str,
    device_id: &str,
    updated_at: i64,
) -> Result<Option<SyncChange>, String> {
    let (updated_at, device_id) = setting_version(conn, owner, key, device_id, updated_at)?;
    let (value, deleted_at) = match key {
        SETTING_SHOW_TASKS | SETTING_SHOW_WEEK | SETTING_SHOW_MONTH => {
            let column = match key {
                SETTING_SHOW_TASKS => "show_completed_all",
                SETTING_SHOW_WEEK => "show_completed_week",
                _ => "show_completed_month",
            };
            let value: Option<bool> = conn
                .query_row(
                    &format!("SELECT {column} FROM users WHERE id = ?1"),
                    [owner],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            (value.map(Value::Bool), None)
        }
        SETTING_LAST_CATEGORY | SETTING_LAST_PRIORITY => {
            let storage_key = if key == SETTING_LAST_CATEGORY {
                format!("last_task_category:{owner}")
            } else {
                format!("last_task_priority:{owner}")
            };
            let value: Option<String> = conn
                .query_row(
                    "SELECT setting_value FROM app_settings WHERE setting_key = ?1",
                    [storage_key],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|error| error.to_string())?;
            match value {
                Some(text) => (Some(Value::String(text)), None),
                None => (None, Some(updated_at)),
            }
        }
        _ => return Ok(None),
    };
    if value.is_none() && deleted_at.is_none() {
        return Ok(None);
    }
    save_setting_version(conn, owner, key, updated_at, &device_id)?;
    Ok(Some(SyncChange {
        entity: ENTITY_SETTING.to_string(),
        id: key.to_string(),
        updated_at,
        deleted_at,
        device_id: device_id.to_string(),
        data: json!({ "value": value, "createdAt": updated_at }),
    }))
}

pub fn read_all_changes(
    conn: &Connection,
    owner_id: &str,
    device_id: &str,
) -> Result<Vec<SyncChange>, String> {
    let mut changes = Vec::new();
    collect_changes(
        conn,
        owner_id,
        ENTITY_CATEGORY,
        "SELECT id FROM categories WHERE owner_id = ?1 ORDER BY id",
        device_id,
        &mut changes,
    )?;
    collect_changes(
        conn,
        owner_id,
        ENTITY_ANNIVERSARY,
        "SELECT id FROM anniversaries WHERE owner_id = ?1 ORDER BY id",
        device_id,
        &mut changes,
    )?;
    collect_changes(
        conn,
        owner_id,
        ENTITY_TASK,
        "SELECT id FROM tasks WHERE owner_id = ?1 ORDER BY id",
        device_id,
        &mut changes,
    )?;
    collect_changes(conn, owner_id, ENTITY_ANNIVERSARY_RECORD, "SELECT anniversary_id || '@' || date FROM anniversary_records WHERE owner_id = ?1 ORDER BY anniversary_id, date", device_id, &mut changes)?;
    // 历史设置没有版本时使用稳定的零版本，不在全量读取时伪造新修改。
    for key in [
        SETTING_SHOW_TASKS,
        SETTING_SHOW_WEEK,
        SETTING_SHOW_MONTH,
        SETTING_LAST_CATEGORY,
        SETTING_LAST_PRIORITY,
    ] {
        if let Some(change) = read_setting_change(conn, owner_id, key, device_id, 0)? {
            changes.push(change);
        }
    }
    Ok(changes)
}

fn collect_changes(
    conn: &Connection,
    owner_id: &str,
    entity: &str,
    sql: &str,
    device_id: &str,
    changes: &mut Vec<SyncChange>,
) -> Result<(), String> {
    let mut statement = conn.prepare(sql).map_err(|error| error.to_string())?;
    let ids = statement
        .query_map([owner_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    for id in ids {
        let id = id.map_err(|error| error.to_string())?;
        if let Some(change) = read_change(conn, owner_id, entity, &id, device_id, 0)? {
            changes.push(change);
        }
    }
    Ok(())
}

pub fn apply_changes(
    conn: &Connection,
    owner_id: &str,
    changes: &[SyncChange],
) -> Result<usize, String> {
    require_transaction(conn)?;
    conn.execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    let mut applied = 0;
    for change in changes {
        if apply_change(conn, owner_id, change)? {
            applied += 1;
        }
    }
    Ok(applied)
}

pub fn apply_change(
    conn: &Connection,
    owner_id: &str,
    change: &SyncChange,
) -> Result<bool, String> {
    if change.entity == ENTITY_SETTING {
        return apply_setting(conn, owner_id, change);
    }
    validate_entity_owner(conn, owner_id, change)?;
    if let Some((updated_at, device_id)) = local_version(conn, owner_id, change)? {
        let device_id = if device_id.is_empty() {
            local_device_id(conn)?
        } else {
            device_id
        };
        if !incoming_wins(change.updated_at, &change.device_id, updated_at, &device_id) {
            return Ok(false);
        }
    }
    match change.entity.as_str() {
        ENTITY_CATEGORY => apply_category(conn, owner_id, change)?,
        ENTITY_TASK => return apply_task(conn, owner_id, change),
        ENTITY_ANNIVERSARY => apply_anniversary(conn, owner_id, change)?,
        ENTITY_ANNIVERSARY_RECORD => return apply_record(conn, owner_id, change),
        _ => return Ok(false),
    }
    Ok(true)
}

fn require_transaction(conn: &Connection) -> Result<(), String> {
    if conn.is_autocommit() {
        return Err("同步写入必须由调用方开启事务".to_string());
    }
    Ok(())
}

fn validate_entity_owner(
    conn: &Connection,
    owner: &str,
    change: &SyncChange,
) -> Result<(), String> {
    let table = match change.entity.as_str() {
        ENTITY_CATEGORY => "categories",
        ENTITY_TASK => "tasks",
        ENTITY_ANNIVERSARY => "anniversaries",
        ENTITY_ANNIVERSARY_RECORD => {
            let anniversary_id = text(&change.data, "anniversaryId").unwrap_or_default();
            let date = text(&change.data, "date").unwrap_or_default();
            if anniversary_id.is_empty()
                || date.is_empty()
                || change.id != format!("{anniversary_id}@{date}")
            {
                return Err("纪念记录标识与数据不一致".to_string());
            }
            let other: bool = conn.query_row(
                "SELECT EXISTS(SELECT 1 FROM anniversary_records WHERE anniversary_id = ?1 AND date = ?2 AND owner_id <> ?3)",
                params![anniversary_id, date, owner], |row| row.get(0),
            ).map_err(|error| error.to_string())?;
            if other {
                return Err("纪念记录属于其他账号".to_string());
            }
            return Ok(());
        }
        _ => return Ok(()),
    };
    let other: bool = conn
        .query_row(
            &format!("SELECT EXISTS(SELECT 1 FROM {table} WHERE id = ?1 AND owner_id <> ?2)"),
            params![change.id, owner],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if other {
        return Err(format!("同步实体 {} 属于其他账号", change.id));
    }
    // 依赖可能先写入：补入目标时也校验引用方，避免跨账号前向引用。
    let reference = match change.entity.as_str() {
        ENTITY_CATEGORY => Some(("tasks", "category_id")),
        ENTITY_TASK => Some(("tasks", "parent_task_id")),
        ENTITY_ANNIVERSARY => Some(("anniversary_records", "anniversary_id")),
        _ => None,
    };
    if let Some((table, column)) = reference {
        let other: bool = conn
            .query_row(
                &format!(
                    "SELECT EXISTS(SELECT 1 FROM {table} WHERE {column} = ?1 AND owner_id <> ?2)"
                ),
                params![change.id, owner],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if other {
            return Err("同步依赖被其他账号引用".to_string());
        }
    }
    Ok(())
}

fn validate_task_reference(
    conn: &Connection,
    owner: &str,
    table: &str,
    id: &str,
) -> Result<(), String> {
    let target_owner: Option<String> = conn
        .query_row(
            &format!("SELECT owner_id FROM {table} WHERE id = ?1"),
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match target_owner {
        Some(target) if target != owner => Err("事项依赖属于其他账号".to_string()),
        None => {
            require_transaction(conn)?;
            conn.execute_batch("PRAGMA defer_foreign_keys = ON;")
                .map_err(|error| error.to_string())
        }
        _ => Ok(()),
    }
}

fn local_version(
    conn: &Connection,
    owner_id: &str,
    change: &SyncChange,
) -> Result<Option<(i64, String)>, String> {
    let query = match change.entity.as_str() {
        ENTITY_CATEGORY => {
            "SELECT updated_at, device_id FROM categories WHERE owner_id = ?1 AND id = ?2"
        }
        ENTITY_TASK => "SELECT updated_at, device_id FROM tasks WHERE owner_id = ?1 AND id = ?2",
        ENTITY_ANNIVERSARY => {
            "SELECT updated_at, device_id FROM anniversaries WHERE owner_id = ?1 AND id = ?2"
        }
        ENTITY_ANNIVERSARY_RECORD => {
            let Some((anniversary_id, date)) = change.id.rsplit_once('@') else {
                return Ok(None);
            };
            return conn
                .query_row(
                    "SELECT updated_at, device_id FROM anniversary_records WHERE owner_id = ?1 AND anniversary_id = ?2 AND date = ?3",
                    params![owner_id, anniversary_id, date],
                    |row| Ok((row.get(0)?, row.get(1)?)),
                )
                .optional()
                .map_err(|error| error.to_string());
        }
        _ => return Ok(None),
    };
    conn.query_row(query, params![owner_id, change.id], |row| {
        Ok((row.get(0)?, row.get(1)?))
    })
    .optional()
    .map_err(|error| error.to_string())
}

fn apply_category(conn: &Connection, owner: &str, change: &SyncChange) -> Result<(), String> {
    let data = &change.data;
    conn.execute(
        "INSERT INTO categories (id, owner_id, name, color, icon, sort_order, created_at, updated_at, deleted_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, color = excluded.color, icon = excluded.icon,
           sort_order = excluded.sort_order, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, device_id = excluded.device_id
         WHERE categories.owner_id = excluded.owner_id",
        params![
            change.id,
            owner,
            text(data, "name"),
            text(data, "color"),
            text(data, "icon").unwrap_or_else(|| "tags".to_string()),
            int(data, "sortOrder").unwrap_or(0),
            int(data, "createdAt").unwrap_or(change.updated_at),
            change.updated_at,
            change.deleted_at,
            change.device_id,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_task(conn: &Connection, owner: &str, change: &SyncChange) -> Result<bool, String> {
    let data = &change.data;
    let category_id = text(data, "categoryId");
    let parent_task_id = text(data, "parentTaskId");
    if parent_task_id.as_deref() == Some(change.id.as_str()) {
        return Err("事项不能引用自身作为父事项".to_string());
    }
    if let Some(id) = &category_id {
        validate_task_reference(conn, owner, "categories", id)?;
    }
    if let Some(id) = &parent_task_id {
        validate_task_reference(conn, owner, "tasks", id)?;
    }
    let offsets = data.get("reminderOffsets").cloned().unwrap_or(json!([]));
    conn.execute(
        "INSERT INTO tasks (id, owner_id, title, category_id, planned_date, planned_time, planned_end_time,
            schedule_kind, priority, repeat_rule, occurrence_overrides, reminder_offsets, sort_order,
            parent_task_id, status, failure_reason, notes, created_at, completed_at, updated_at, deleted_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title, category_id = excluded.category_id,
           planned_date = excluded.planned_date, planned_time = excluded.planned_time,
           planned_end_time = excluded.planned_end_time, schedule_kind = excluded.schedule_kind,
           priority = excluded.priority, repeat_rule = excluded.repeat_rule,
           occurrence_overrides = excluded.occurrence_overrides,
           reminder_offsets = excluded.reminder_offsets, sort_order = excluded.sort_order,
           parent_task_id = excluded.parent_task_id, status = excluded.status,
           failure_reason = excluded.failure_reason, notes = excluded.notes,
           completed_at = excluded.completed_at, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, device_id = excluded.device_id
         WHERE tasks.owner_id = excluded.owner_id",
        params![
            change.id,
            owner,
            text(data, "title").unwrap_or_default(),
            category_id,
            text(data, "plannedDate"),
            text(data, "plannedTime"),
            text(data, "plannedEndTime"),
            text(data, "scheduleKind").unwrap_or_else(|| "all_day".to_string()),
            text(data, "priority").unwrap_or_else(|| "not_urgent_not_important".to_string()),
            text(data, "repeatRule").unwrap_or_else(|| "{\"kind\":\"none\"}".to_string()),
            text(data, "occurrenceOverrides").unwrap_or_else(|| "{}".to_string()),
            offsets.to_string(),
            int(data, "sortOrder").unwrap_or(0),
            parent_task_id,
            text(data, "status").unwrap_or_else(|| "todo".to_string()),
            text(data, "failureReason"),
            text(data, "notes").unwrap_or_default(),
            int(data, "createdAt").unwrap_or(change.updated_at),
            int(data, "completedAt"),
            change.updated_at,
            change.deleted_at,
            change.device_id,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(true)
}

fn apply_anniversary(conn: &Connection, owner: &str, change: &SyncChange) -> Result<(), String> {
    let data = &change.data;
    let photos = data.get("photos").cloned().unwrap_or(json!([])).to_string();
    conn.execute(
        "INSERT INTO anniversaries (id, owner_id, kind, title, date, notes, pinned, theme, photos_json,
            cover_index, created_at, updated_at, deleted_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(id) DO UPDATE SET
           kind = excluded.kind, title = excluded.title, date = excluded.date,
           notes = excluded.notes, pinned = excluded.pinned, theme = excluded.theme,
           photos_json = excluded.photos_json, cover_index = excluded.cover_index,
           updated_at = excluded.updated_at, deleted_at = excluded.deleted_at,
           device_id = excluded.device_id
         WHERE anniversaries.owner_id = excluded.owner_id",
        params![
            change.id,
            owner,
            text(data, "kind").unwrap_or_else(|| "anniversary".to_string()),
            text(data, "title").unwrap_or_default(),
            text(data, "date").unwrap_or_default(),
            text(data, "notes").unwrap_or_default(),
            bool_value(data, "pinned"),
            text(data, "theme").unwrap_or_else(|| "sky".to_string()),
            photos,
            int(data, "coverIndex").unwrap_or(0),
            int(data, "createdAt").unwrap_or(change.updated_at),
            change.updated_at,
            change.deleted_at,
            change.device_id,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn apply_record(conn: &Connection, owner: &str, change: &SyncChange) -> Result<bool, String> {
    let data = &change.data;
    let anniversary_id = text(data, "anniversaryId").unwrap_or_default();
    let date = text(data, "date").unwrap_or_default();
    if anniversary_id.is_empty() || date.is_empty() {
        return Err("纪念记录缺少纪念日或日期".to_string());
    }
    let exists = conn
        .query_row(
            "SELECT 1 FROM anniversaries WHERE owner_id = ?1 AND id = ?2",
            params![owner, anniversary_id],
            |_| Ok(()),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .is_some();
    if !exists {
        return Err("纪念记录的纪念日不存在或属于其他账号".to_string());
    }
    conn.execute(
        "INSERT INTO anniversary_records (anniversary_id, owner_id, date, notes, confirmed_at, title,
            kind, original_date, created_at, updated_at, deleted_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(anniversary_id, date) DO UPDATE SET
           notes = excluded.notes, confirmed_at = excluded.confirmed_at,
           title = excluded.title, kind = excluded.kind,
           original_date = excluded.original_date, updated_at = excluded.updated_at,
           deleted_at = excluded.deleted_at, device_id = excluded.device_id
         WHERE anniversary_records.owner_id = excluded.owner_id",
        params![
            anniversary_id,
            owner,
            date,
            text(data, "notes").unwrap_or_default(),
            int(data, "confirmedAt"),
            text(data, "title").unwrap_or_default(),
            text(data, "kind").unwrap_or_else(|| "anniversary".to_string()),
            text(data, "originalDate").unwrap_or_else(|| date.clone()),
            int(data, "createdAt").unwrap_or(change.updated_at),
            change.updated_at,
            change.deleted_at,
            change.device_id,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(true)
}

fn apply_setting(conn: &Connection, owner: &str, change: &SyncChange) -> Result<bool, String> {
    if !matches!(
        change.id.as_str(),
        SETTING_SHOW_TASKS
            | SETTING_SHOW_WEEK
            | SETTING_SHOW_MONTH
            | SETTING_LAST_CATEGORY
            | SETTING_LAST_PRIORITY
    ) {
        return Ok(false);
    }
    require_transaction(conn)?;
    let exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM users WHERE id = ?1)",
            [owner],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !exists {
        return Err("同步设置的账号不存在".to_string());
    }
    let device = local_device_id(conn)?;
    let (updated, local_device) = setting_version(conn, owner, &change.id, &device, 0)?;
    if !incoming_wins(change.updated_at, &change.device_id, updated, &local_device) {
        return Ok(false);
    }
    let value = change.data.get("value").cloned().unwrap_or(Value::Null);
    let deleted = change.deleted_at.is_some();
    match change.id.as_str() {
        SETTING_SHOW_TASKS | SETTING_SHOW_WEEK | SETTING_SHOW_MONTH => {
            let column = match change.id.as_str() {
                SETTING_SHOW_TASKS => "show_completed_all",
                SETTING_SHOW_WEEK => "show_completed_week",
                _ => "show_completed_month",
            };
            let flag = !deleted && value.as_bool().unwrap_or(false);
            conn.execute(
                &format!("UPDATE users SET {column} = ?1 WHERE id = ?2"),
                params![flag, owner],
            )
            .map_err(|error| error.to_string())?;
        }
        SETTING_LAST_CATEGORY | SETTING_LAST_PRIORITY => {
            let storage_key = if change.id == SETTING_LAST_CATEGORY {
                format!("last_task_category:{owner}")
            } else {
                format!("last_task_priority:{owner}")
            };
            match value.as_str() {
                Some(text) if !deleted && !text.is_empty() => {
                    conn.execute(
                        "INSERT INTO app_settings (setting_key, setting_value) VALUES (?1, ?2)
                         ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value",
                        params![storage_key, text],
                    )
                    .map_err(|error| error.to_string())?;
                }
                _ => {
                    conn.execute(
                        "DELETE FROM app_settings WHERE setting_key = ?1",
                        [storage_key],
                    )
                    .map_err(|error| error.to_string())?;
                }
            }
        }
        _ => return Ok(false),
    }
    save_setting_version(
        conn,
        owner,
        &change.id,
        change.updated_at,
        &change.device_id,
    )?;
    clear_outbox_entry(conn, owner, ENTITY_SETTING, &change.id)?;
    Ok(true)
}

/// 以远端为准：清空本机同步实体与待上传队列，保留账号与平台本机数据。
pub fn clear_user_synced_data(conn: &Connection, owner_id: &str) -> Result<(), String> {
    require_transaction(conn)?;
    conn.execute_batch("PRAGMA defer_foreign_keys = ON;")
        .map_err(|error| error.to_string())?;
    let transaction = conn;
    transaction
        .execute(
            "DELETE FROM anniversary_records WHERE owner_id = ?1",
            [owner_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM anniversaries WHERE owner_id = ?1", [owner_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM tasks WHERE owner_id = ?1", [owner_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM categories WHERE owner_id = ?1", [owner_id])
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "UPDATE users SET show_completed_all = 0, show_completed_week = 0, show_completed_month = 0 WHERE id = ?1",
            [owner_id],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute(
            "DELETE FROM app_settings WHERE setting_key IN (?1, ?2)",
            params![
                format!("last_task_category:{owner_id}"),
                format!("last_task_priority:{owner_id}")
            ],
        )
        .map_err(|error| error.to_string())?;
    transaction
        .execute("DELETE FROM sync_outbox WHERE owner_id = ?1", [owner_id])
        .map_err(|error| error.to_string())?;
    for key in [
        SETTING_SHOW_TASKS,
        SETTING_SHOW_WEEK,
        SETTING_SHOW_MONTH,
        SETTING_LAST_CATEGORY,
        SETTING_LAST_PRIORITY,
    ] {
        conn.execute(
            "DELETE FROM app_settings WHERE setting_key = ?1",
            [setting_version_key(owner_id, key)],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn text(data: &Value, key: &str) -> Option<String> {
    data.get(key).and_then(Value::as_str).map(str::to_string)
}

fn int(data: &Value, key: &str) -> Option<i64> {
    data.get(key).and_then(Value::as_i64)
}

fn bool_value(data: &Value, key: &str) -> bool {
    data.get(key).and_then(Value::as_bool).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::initialize(&conn).unwrap();
        conn.execute("INSERT INTO users (id, username, password_hash, created_at) VALUES ('owner', 'owner', '', 1), ('other', 'other', '', 1)", []).unwrap();
        conn.execute(
            "INSERT INTO app_settings VALUES (?1, 'local')",
            [SYNC_DEVICE_KEY],
        )
        .unwrap();
        conn
    }

    fn change(entity: &str, id: &str, data: Value) -> SyncChange {
        SyncChange {
            entity: entity.into(),
            id: id.into(),
            updated_at: 100,
            deleted_at: None,
            device_id: "remote".into(),
            data,
        }
    }

    fn category(id: &str) -> SyncChange {
        change(ENTITY_CATEGORY, id, json!({"name": id, "color": "#ffffff"}))
    }

    fn anniversary() -> SyncChange {
        change(ENTITY_ANNIVERSARY, "ann", json!({"date": "2026-01-01"}))
    }

    fn record() -> SyncChange {
        change(
            ENTITY_ANNIVERSARY_RECORD,
            "ann@2026-01-01",
            json!({"anniversaryId": "ann", "date": "2026-01-01"}),
        )
    }

    #[test]
    fn reads_preserve_entity_devices_and_legacy_fallback() {
        let conn = database();
        let items = [
            category("cat"),
            change(ENTITY_TASK, "task", json!({})),
            anniversary(),
            record(),
        ];
        for item in &items {
            assert!(apply_change(&conn, "owner", item).unwrap());
            let read = read_change(&conn, "owner", &item.entity, &item.id, "fallback", 0)
                .unwrap()
                .unwrap();
            assert_eq!(read.device_id, "remote");
        }
        for table in [
            "categories",
            "tasks",
            "anniversaries",
            "anniversary_records",
        ] {
            conn.execute(&format!("UPDATE {table} SET device_id = ''"), [])
                .unwrap();
        }
        for item in &items {
            assert_eq!(
                read_change(&conn, "owner", &item.entity, &item.id, "fallback", 0)
                    .unwrap()
                    .unwrap()
                    .device_id,
                "fallback"
            );
        }
    }

    #[test]
    fn setting_versions_survive_upload_and_obey_lww() {
        let conn = database();
        conn.execute(
            "UPDATE users SET show_completed_all = 1 WHERE id = 'owner'",
            [],
        )
        .unwrap();
        enqueue_outbox(&conn, "owner", ENTITY_SETTING, SETTING_SHOW_TASKS, 200).unwrap();
        let mut remote = change(ENTITY_SETTING, SETTING_SHOW_TASKS, json!({"value": false}));
        let tx = conn.unchecked_transaction().unwrap();
        assert!(!apply_change(&tx, "owner", &remote).unwrap());
        assert_eq!(pending_count(&tx, "owner").unwrap(), 1);
        clear_outbox_entry(&tx, "owner", ENTITY_SETTING, SETTING_SHOW_TASKS).unwrap();
        assert!(!apply_change(&tx, "owner", &remote).unwrap());
        remote.updated_at = 200;
        remote.device_id = "aaa".into();
        assert!(!apply_change(&tx, "owner", &remote).unwrap());
        remote.device_id = "zzz".into();
        assert!(apply_change(&tx, "owner", &remote).unwrap());
        assert!(!apply_change(&tx, "owner", &remote).unwrap());
        tx.commit().unwrap();
        let first = read_all_changes(&conn, "owner", "local").unwrap();
        let second = read_all_changes(&conn, "owner", "different").unwrap();
        let version = |items: Vec<SyncChange>| {
            items
                .into_iter()
                .find(|item| item.id == SETTING_SHOW_TASKS)
                .unwrap()
        };
        let first = version(first);
        let second = version(second);
        assert_eq!((first.updated_at, first.device_id), (200, "zzz".into()));
        assert_eq!((second.updated_at, second.device_id), (200, "zzz".into()));
    }

    #[test]
    fn settings_pending_version_and_tombstone_are_stable() {
        let conn = database();
        enqueue_outbox(&conn, "owner", ENTITY_SETTING, SETTING_LAST_CATEGORY, 300).unwrap();
        let first = read_all_changes(&conn, "owner", "local").unwrap();
        clear_outbox_entry(&conn, "owner", ENTITY_SETTING, SETTING_LAST_CATEGORY).unwrap();
        let second = read_all_changes(&conn, "owner", "local").unwrap();
        for items in [first, second] {
            let setting = items
                .iter()
                .find(|item| item.id == SETTING_LAST_CATEGORY)
                .unwrap();
            assert_eq!(setting.updated_at, 300);
            assert_eq!(setting.deleted_at, Some(300));
        }
        let mut tombstone = change(
            ENTITY_SETTING,
            SETTING_LAST_CATEGORY,
            json!({"value": null}),
        );
        tombstone.updated_at = 400;
        tombstone.deleted_at = Some(400);
        let tx = conn.unchecked_transaction().unwrap();
        assert!(apply_change(&tx, "owner", &tombstone).unwrap());
        assert!(!apply_change(&tx, "owner", &tombstone).unwrap());
        tx.commit().unwrap();
        assert_eq!(
            read_change(
                &conn,
                "owner",
                ENTITY_SETTING,
                SETTING_LAST_CATEGORY,
                "local",
                0
            )
            .unwrap()
            .unwrap()
            .deleted_at,
            Some(400)
        );
    }

    #[test]
    fn reversed_dependencies_are_retained_in_callers_transaction() {
        let conn = database();
        let tx = conn.unchecked_transaction().unwrap();
        let child = change(
            ENTITY_TASK,
            "child",
            json!({"parentTaskId": "parent", "categoryId": "cat"}),
        );
        assert!(apply_change(&tx, "owner", &child).unwrap());
        assert!(apply_change(&tx, "owner", &change(ENTITY_TASK, "parent", json!({}))).unwrap());
        assert!(apply_change(&tx, "owner", &category("cat")).unwrap());
        tx.commit().unwrap();
        let read = read_task_change(&conn, "owner", "child", "local")
            .unwrap()
            .unwrap();
        assert_eq!(read.data["parentTaskId"], "parent");
        assert_eq!(read.data["categoryId"], "cat");
    }

    #[test]
    fn unresolved_dependencies_fail_commit_and_rollback() {
        let conn = database();
        let tx = conn.unchecked_transaction().unwrap();
        assert!(apply_change(
            &tx,
            "owner",
            &change(ENTITY_TASK, "child", json!({"parentTaskId": "missing"}))
        )
        .unwrap());
        assert!(tx.commit().is_err());
        assert!(read_task_change(&conn, "owner", "child", "local")
            .unwrap()
            .is_none());
        assert!(apply_change(&conn, "owner", &record()).is_err());
    }

    #[test]
    fn owner_collisions_and_cross_owner_dependencies_are_errors() {
        let conn = database();
        for item in [
            category("cat"),
            change(ENTITY_TASK, "parent", json!({})),
            anniversary(),
            record(),
        ] {
            assert!(apply_change(&conn, "other", &item).unwrap());
            assert!(apply_change(&conn, "owner", &item).is_err());
        }
        for data in [
            json!({"categoryId": "cat"}),
            json!({"parentTaskId": "parent"}),
        ] {
            assert!(apply_change(&conn, "owner", &change(ENTITY_TASK, "child", data)).is_err());
        }
        let tx = conn.unchecked_transaction().unwrap();
        assert!(apply_change(
            &tx,
            "owner",
            &change(ENTITY_TASK, "child", json!({"parentTaskId": "future"}))
        )
        .unwrap());
        assert!(apply_change(&tx, "other", &change(ENTITY_TASK, "future", json!({}))).is_err());
        tx.rollback().unwrap();
    }

    #[test]
    fn dependency_query_sql_errors_are_propagated() {
        let conn = database();
        conn.execute_batch("PRAGMA foreign_keys = OFF; DROP TABLE categories;")
            .unwrap();
        assert!(apply_change(
            &conn,
            "owner",
            &change(ENTITY_TASK, "child", json!({"categoryId": "cat"}))
        )
        .is_err());
    }

    #[test]
    fn batch_helpers_reuse_callers_transaction() {
        let conn = database();
        let tx = conn.unchecked_transaction().unwrap();
        assert_eq!(apply_changes(&tx, "owner", &[category("cat")]).unwrap(), 1);
        clear_user_synced_data(&tx, "owner").unwrap();
        tx.rollback().unwrap();
        assert!(apply_changes(&conn, "owner", &[]).is_err());
    }
}
