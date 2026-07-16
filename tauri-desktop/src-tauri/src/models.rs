use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserSession {
    pub id: String,
    pub username: String,
    pub display_name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootState {
    pub needs_setup: bool,
    pub session: Option<UserSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagInput {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub tag_id: Option<String>,
    pub tag_name: Option<String>,
    pub tag_color: Option<String>,
    pub planned_date: Option<String>,
    pub planned_time: Option<String>,
    pub status: String,
    pub notes: String,
    pub created_at: i64,
    pub completed_at: Option<i64>,
    pub updated_at: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub id: Option<String>,
    pub title: String,
    pub tag_id: Option<String>,
    pub planned_date: Option<String>,
    pub planned_time: Option<String>,
    pub notes: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuery {
    pub search: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub include_completed: bool,
}
