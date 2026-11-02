use crate::{
    db,
    sync_http::{self, HttpError, Route},
    sync_repo::{self, SyncAccount, SyncChange},
};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::Emitter;

static LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);
static LAST_ERROR: Mutex<Option<(String, String, bool)>> = Mutex::new(None);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatus {
    configured: bool,
    bound: bool,
    username: String,
    remote_empty: Option<bool>,
    last_sync_at: Option<i64>,
    pending_count: i64,
    needs_reauth: bool,
    syncing: bool,
    error: Option<String>,
}

#[derive(Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}

fn owner(conn: &rusqlite::Connection) -> Result<String, String> {
    db::active_user(conn)?
        .map(|user| user.id)
        .ok_or_else(|| "当前未登录，请重新登录".into())
}

fn status(app: &tauri::AppHandle, remote_empty: Option<bool>) -> Result<SyncStatus, String> {
    let conn = db::open_app_db(app)?;
    let owner = owner(&conn)?;
    let account = sync_repo::read_account(&conn, &owner)?.unwrap_or_default();
    let errors = LAST_ERROR.lock().map_err(|_| "同步状态不可用")?;
    let error = errors.as_ref().filter(|(id, _, _)| id == &owner);
    Ok(SyncStatus {
        configured: sync_http::base_url().is_ok(),
        bound: account.bound,
        username: account.username,
        remote_empty,
        last_sync_at: account.last_sync_at,
        pending_count: sync_repo::pending_count(&conn, &owner)?,
        needs_reauth: error.is_some_and(|(_, _, expired)| *expired),
        syncing: false,
        error: error.map(|(_, message, _)| message.clone()),
    })
}

fn publish(
    app: &tauri::AppHandle,
    result: Result<SyncStatus, HttpError>,
) -> Result<SyncStatus, String> {
    match result {
        Ok(mut value) => {
            if let Ok(mut error) = LAST_ERROR.lock() {
                *error = None;
            }
            value.error = None;
            value.needs_reauth = false;
            let _ = app.emit("sync:state", &value);
            Ok(value)
        }
        Err(mut error) => {
            if error.code == "clock_skew" {
                if let Some(time) = error
                    .server_time
                    .and_then(chrono::DateTime::from_timestamp_millis)
                {
                    error.message = format!(
                        "请校准系统时间后重试，服务器时间为 {}",
                        time.with_timezone(&chrono::Local)
                            .format("%Y-%m-%d %H:%M:%S")
                    );
                }
            }
            if let Ok(conn) = db::open_app_db(app) {
                if let Ok(owner) = owner(&conn) {
                    if let Ok(mut state) = LAST_ERROR.lock() {
                        *state = Some((
                            owner,
                            error.message.clone(),
                            matches!(error.code.as_str(), "token_expired" | "unauthorized"),
                        ));
                    }
                }
            }
            if let Ok(value) = status(app, None) {
                let _ = app.emit("sync:state", value);
            }
            Err(error.message)
        }
    }
}

#[tauri::command]
pub fn sync_get_status(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    status(&app, None)
}

async fn authenticate(
    app: &tauri::AppHandle,
    input: Credentials,
    register: bool,
) -> Result<SyncStatus, HttpError> {
    let (owner, device, previous) = {
        let conn = db::open_app_db(app)?;
        let owner = owner(&conn)?;
        let previous = sync_repo::read_account(&conn, &owner)?;
        (owner, sync_repo::local_device_id(&conn)?, previous)
    };
    let response: Value = sync_http::request(
        Route::Auth,
        Method::POST,
        if register { "/register" } else { "/login" },
        "",
        Some(&json!({
            "username": input.username, "password": input.password, "deviceId": device,
            "deviceName": "岁岁时光桌面端", "platform": std::env::consts::OS
        })),
    )
    .await?;
    let user_id = response["user"]["id"]
        .as_str()
        .ok_or("账号响应无效".to_string())?;
    if previous
        .as_ref()
        .is_some_and(|a| a.bound && a.server_user_id != user_id)
    {
        return Err("请先解绑当前同步账号".to_string().into());
    }
    let token = response["token"]
        .as_str()
        .ok_or("账号响应缺少令牌".to_string())?;
    let remote: Value = sync_http::request(Route::Sync, Method::GET, "/state", token, None).await?;
    let account = SyncAccount {
        server_user_id: user_id.into(),
        username: response["user"]["username"].as_str().unwrap_or("").into(),
        token: token.into(),
        ..previous
            .filter(|a| a.server_user_id == user_id)
            .unwrap_or_default()
    };
    let conn = db::open_app_db(app)?;
    sync_repo::save_account(&conn, &owner, &account)?;
    status(app, remote["remoteEmpty"].as_bool()).map_err(Into::into)
}

#[tauri::command]
pub async fn sync_register(
    app: tauri::AppHandle,
    input: Credentials,
) -> Result<SyncStatus, String> {
    let _guard = LOCK.lock().await;
    let result = authenticate(&app, input, true).await;
    publish(&app, result)
}

#[tauri::command]
pub async fn sync_login(app: tauri::AppHandle, input: Credentials) -> Result<SyncStatus, String> {
    let _guard = LOCK.lock().await;
    let result = authenticate(&app, input, false).await;
    publish(&app, result)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PullPage {
    changes: Vec<SyncChange>,
    next_cursor: i64,
    has_more: bool,
}

async fn pull(account: &SyncAccount, cursor: i64) -> Result<(Vec<SyncChange>, i64), HttpError> {
    let mut cursor = cursor;
    let mut changes = Vec::new();
    loop {
        let page: PullPage = sync_http::request(
            Route::Sync,
            Method::GET,
            &format!("/pull?cursor={cursor}&limit=500"),
            &account.token,
            None,
        )
        .await?;
        if page.next_cursor < cursor || (page.has_more && page.next_cursor == cursor) {
            return Err("同步服务返回了无效游标".to_string().into());
        }
        changes.extend(page.changes);
        cursor = page.next_cursor;
        if !page.has_more {
            break;
        }
    }
    Ok((changes, cursor))
}

async fn push(
    account: &SyncAccount,
    device: &str,
    changes: &[SyncChange],
    require_empty: bool,
) -> Result<Vec<SyncChange>, HttpError> {
    let mut superseded = Vec::new();
    let mut first = true;
    for chunk in crate::sync_merge::push_batches(changes, device)? {
        let body =
            json!({ "deviceId": device, "requireEmpty": require_empty && first, "changes": chunk });
        let response: Value = sync_http::request(
            Route::Sync,
            Method::POST,
            "/push",
            &account.token,
            Some(&body),
        )
        .await?;
        if let Some(items) = response["superseded"].as_array() {
            for item in items {
                superseded.push(
                    serde_json::from_value(item["server"].clone())
                        .map_err(|_| "同步冲突响应无效".to_string())?,
                );
            }
        }
        first = false;
    }
    if changes.is_empty() && require_empty {
        let _: Value = sync_http::request(
            Route::Sync,
            Method::POST,
            "/push",
            &account.token,
            Some(&json!({"deviceId":device,"requireEmpty":true,"changes":[]})),
        )
        .await?;
    }
    Ok(superseded)
}

async fn synchronize(
    app: &tauri::AppHandle,
    strategy: Option<&str>,
) -> Result<SyncStatus, HttpError> {
    let (owner_id, device, mut account, pending, local) = {
        let conn = db::open_app_db(app)?;
        let owner_id = owner(&conn)?;
        let account =
            sync_repo::read_account(&conn, &owner_id)?.ok_or("请先登录同步账号".to_string())?;
        if !account.bound && strategy.is_none() {
            return status(app, None).map_err(Into::into);
        }
        let device = sync_repo::local_device_id(&conn)?;
        let pending = sync_repo::pending_entries(&conn, &owner_id)?;
        let local = if strategy == Some("merge") || strategy == Some("upload") {
            sync_repo::read_all_changes(&conn, &owner_id, &device)?
        } else {
            let mut changes = Vec::new();
            for (entity, id, updated) in &pending {
                if let Some(change) =
                    sync_repo::read_change(&conn, &owner_id, entity, id, &device, *updated)?
                {
                    changes.push(change);
                }
            }
            changes
        };
        (owner_id, device, account, pending, local)
    };
    let (mut remote, cursor) = if strategy == Some("remote") || strategy == Some("merge") {
        let (remote, cursor) = pull(&account, 0).await?;
        if strategy != Some("remote") {
            push(&account, &device, &local, false).await?;
        }
        let (mut latest, final_cursor) = pull(&account, cursor).await?;
        let mut remote = remote;
        remote.append(&mut latest);
        (remote, final_cursor)
    } else {
        let mut superseded = push(&account, &device, &local, strategy == Some("upload")).await?;
        let (mut remote, cursor) = pull(&account, account.cursor).await?;
        superseded.append(&mut remote);
        (superseded, cursor)
    };
    crate::sync_merge::sort_for_apply(&mut remote);
    let conn = db::open_app_db(app)?;
    if owner(&conn)? != owner_id {
        return Err("本地账号已切换，请重新同步".to_string().into());
    }
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    if strategy == Some("remote") && sync_repo::pending_entries(&tx, &owner_id)? != pending {
        return Err("拉取期间本机数据发生变化，请重新确认后再使用远端替换"
            .to_string()
            .into());
    }
    tx.execute_batch("PRAGMA defer_foreign_keys = ON")
        .map_err(|e| e.to_string())?;
    if strategy == Some("remote") {
        sync_repo::clear_user_synced_data(&tx, &owner_id)?;
    }
    sync_repo::apply_changes(&tx, &owner_id, &remote)?;
    for (entity, id, updated) in &pending {
        tx.execute("DELETE FROM sync_outbox WHERE owner_id=?1 AND entity=?2 AND entity_id=?3 AND updated_at=?4", rusqlite::params![owner_id, entity, id, updated]).map_err(|e| e.to_string())?;
    }
    account.cursor = cursor;
    account.bound = true;
    account.last_sync_at = Some(db::now_millis());
    sync_repo::save_account(&tx, &owner_id, &account)?;
    tx.commit().map_err(|e| e.to_string())?;
    status(app, None).map_err(Into::into)
}

#[tauri::command]
pub async fn sync_bind(app: tauri::AppHandle, strategy: String) -> Result<SyncStatus, String> {
    if !matches!(strategy.as_str(), "upload" | "merge" | "remote") {
        return Err("绑定方式无效".into());
    }
    let _guard = LOCK.lock().await;
    let result = synchronize(&app, Some(&strategy)).await;
    publish(&app, result)
}

#[tauri::command]
pub async fn sync_now(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    let _guard = LOCK.lock().await;
    let result = synchronize(&app, None).await;
    publish(&app, result)
}

#[tauri::command]
pub async fn sync_unbind(app: tauri::AppHandle) -> Result<SyncStatus, String> {
    let _guard = LOCK.lock().await;
    let conn = db::open_app_db(&app)?;
    let owner = owner(&conn)?;
    sync_repo::clear_account(&conn, &owner)?;
    if let Ok(mut error) = LAST_ERROR.lock() {
        *error = None;
    }
    let value = status(&app, None)?;
    let _ = app.emit("sync:state", &value);
    Ok(value)
}

pub fn schedule(app: &tauri::AppHandle) {
    if sync_http::base_url().is_err() {
        return;
    }
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        if GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }
        if let Ok(value) = status(&app, None) {
            if value.bound {
                let _ = sync_now(app).await;
            }
        }
    });
}

pub fn start(app: tauri::AppHandle) {
    if sync_http::base_url().is_err() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        loop {
            if let Ok(value) = status(&app, None) {
                if value.bound {
                    let _ = sync_now(app.clone()).await;
                }
            }
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    });
}
