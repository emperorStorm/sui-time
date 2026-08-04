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
pub struct Category {
    pub id: String,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub sort_order: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub color: String,
    pub icon: String,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub category_color: Option<String>,
    pub category_icon: Option<String>,
    pub planned_date: Option<String>,
    pub planned_time: Option<String>,
    pub planned_end_time: Option<String>,
    pub schedule_kind: String,
    pub priority: String,
    pub repeat_rule: String,
    pub occurrence_overrides: String,
    pub reminder_offsets: Vec<i64>,
    pub parent_task_id: Option<String>,
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
    pub category_id: Option<String>,
    pub planned_date: Option<String>,
    pub planned_time: Option<String>,
    #[serde(default)]
    pub planned_end_time: Option<String>,
    #[serde(default = "default_schedule_kind")]
    pub schedule_kind: String,
    #[serde(default = "default_priority")]
    pub priority: String,
    #[serde(default = "default_repeat_rule")]
    pub repeat_rule: String,
    #[serde(default = "default_occurrence_overrides")]
    pub occurrence_overrides: String,
    #[serde(default)]
    pub reminder_offsets: Vec<i64>,
    #[serde(default)]
    pub parent_task_id: Option<String>,
    pub notes: String,
}

fn default_schedule_kind() -> String {
    "all_day".to_string()
}
fn default_priority() -> String {
    "not_urgent_not_important".to_string()
}
fn default_repeat_rule() -> String {
    "{\"kind\":\"none\"}".to_string()
}
fn default_occurrence_overrides() -> String {
    "{}".to_string()
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskQuery {
    pub search: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub include_completed: bool,
}
