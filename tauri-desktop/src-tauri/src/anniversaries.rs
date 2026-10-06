use base64::{engine::general_purpose::STANDARD, Engine};
use chrono::{Datelike, Local, NaiveDate};
use rusqlite::{params, Connection, Row};
use std::io::Cursor;
use uuid::Uuid;

use crate::models::{
    Anniversary, AnniversaryInput, AnniversaryRecord, AnniversaryRecordInput, AnniversarySummary,
};

fn read_record(row: &Row<'_>) -> rusqlite::Result<AnniversaryRecord> {
    Ok(AnniversaryRecord {
        anniversary_id: row.get(0)?,
        date: row.get(1)?,
        notes: row.get(2)?,
        confirmed_at: row.get(3)?,
        title: row.get(4)?,
        kind: row.get(5)?,
        original_date: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

pub fn list_anniversary_records(
    conn: &Connection,
    owner: &str,
    anniversary_id: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
) -> Result<Vec<AnniversaryRecord>, String> {
    if let Some(id) = anniversary_id {
        get_summary(conn, owner, id)?;
    }
    if let (Some(start), Some(end)) = (start_date, end_date) {
        parse_record_date(start)?;
        parse_record_date(end)?;
        if start > end {
            return Err("日期范围无效".into());
        }
    } else if start_date.is_some() || end_date.is_some() {
        return Err("请提供完整的日期范围".into());
    }
    let mut statement = conn.prepare(
        "SELECT r.anniversary_id,r.date,r.notes,r.confirmed_at,r.title,r.kind,r.original_date,r.created_at,r.updated_at
         FROM anniversary_records r JOIN anniversaries a ON a.id=r.anniversary_id AND a.owner_id=r.owner_id
         WHERE r.owner_id=?1 AND (?2 IS NULL OR r.anniversary_id=?2)
         AND (?3 IS NULL OR r.date>=?3) AND (?4 IS NULL OR r.date<=?4) ORDER BY r.date DESC,r.anniversary_id"
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(
            params![owner, anniversary_id, start_date, end_date],
            read_record,
        )
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn parse_record_date(value: &str) -> Result<NaiveDate, String> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| "请选择有效的公历日期".to_string())?;
    if date.to_string() != value || !("1900-01-01"..="2100-12-31").contains(&value) {
        return Err("日期范围为 1900 至 2100 年".into());
    }
    Ok(date)
}

pub fn save_anniversary_record(
    conn: &Connection,
    owner: &str,
    input: AnniversaryRecordInput,
) -> Result<AnniversaryRecord, String> {
    let date = parse_record_date(&input.date)?;
    let notes = input.notes.trim();
    if notes.chars().count() > 2000 {
        return Err("本次备注不能超过 2000 个字".into());
    }
    if date > Local::now().date_naive() {
        return Err("只能记录当天或过去的纪念日".into());
    }
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let item = get_summary(&transaction, owner, &input.anniversary_id)?;
    let previous = list_anniversary_records(
        &transaction,
        owner,
        Some(&input.anniversary_id),
        Some(&input.date),
        Some(&input.date),
    )?
    .pop();
    if previous.is_none() {
        let original = parse_record_date(&item.date)?;
        let expected = if item.kind == "countdown" {
            original
        } else {
            NaiveDate::from_ymd_opt(date.year(), original.month(), original.day())
                .or_else(|| NaiveDate::from_ymd_opt(date.year(), 2, 28))
                .ok_or("日期无效")?
        };
        if date < original || date != expected {
            return Err("日期与纪念日规则不匹配".into());
        }
    }
    // 历史快照只在首次记录时取值，修改源规则不改写当年的回忆。
    let now = Local::now().timestamp_millis();
    let record = AnniversaryRecord {
        anniversary_id: input.anniversary_id,
        date: input.date,
        notes: notes.into(),
        confirmed_at: if input.confirmed {
            Some(
                previous
                    .as_ref()
                    .and_then(|r| r.confirmed_at)
                    .unwrap_or(now),
            )
        } else {
            None
        },
        title: previous
            .as_ref()
            .map(|r| r.title.clone())
            .unwrap_or(item.title),
        kind: previous
            .as_ref()
            .map(|r| r.kind.clone())
            .unwrap_or(item.kind),
        original_date: previous
            .as_ref()
            .map(|r| r.original_date.clone())
            .unwrap_or(item.date),
        created_at: previous.as_ref().map(|r| r.created_at).unwrap_or(now),
        updated_at: now,
    };
    transaction.execute(
        "INSERT INTO anniversary_records(anniversary_id,owner_id,date,notes,confirmed_at,title,kind,original_date,created_at,updated_at)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
         ON CONFLICT(anniversary_id,date) DO UPDATE SET notes=excluded.notes,confirmed_at=excluded.confirmed_at,updated_at=excluded.updated_at",
        params![record.anniversary_id,owner,record.date,record.notes,record.confirmed_at,record.title,record.kind,record.original_date,record.created_at,record.updated_at]
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(record)
}

fn read_summary(row: &Row<'_>) -> rusqlite::Result<AnniversarySummary> {
    Ok(AnniversarySummary {
        id: row.get(0)?,
        kind: row.get(1)?,
        title: row.get(2)?,
        date: row.get(3)?,
        notes: row.get(4)?,
        pinned: row.get(5)?,
        theme: row.get(6)?,
        created_at: row.get(7)?,
        updated_at: row.get(8)?,
    })
}

fn get_summary(conn: &Connection, owner: &str, id: &str) -> Result<AnniversarySummary, String> {
    conn.query_row(
        "SELECT id,kind,title,date,notes,pinned,theme,created_at,updated_at FROM anniversaries WHERE owner_id=?1 AND id=?2",
        params![owner, id], read_summary,
    ).map_err(|error| error.to_string())
}

pub fn list_anniversaries(
    conn: &Connection,
    owner: &str,
) -> Result<Vec<AnniversarySummary>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, kind, title, date, notes, pinned, theme, created_at, updated_at
         FROM anniversaries WHERE owner_id = ?1 ORDER BY created_at, id",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([owner], read_summary)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

pub fn get_anniversary(conn: &Connection, owner: &str, id: &str) -> Result<Anniversary, String> {
    conn.query_row(
        "SELECT id, kind, title, date, notes, pinned, theme, created_at, updated_at, photos_json, cover_index
         FROM anniversaries WHERE owner_id = ?1 AND id = ?2", params![owner, id],
        |row| {
            let encoded: String = row.get(9)?;
            let photos = serde_json::from_str(&encoded).map_err(|error| rusqlite::Error::FromSqlConversionFailure(9, rusqlite::types::Type::Text, Box::new(error)))?;
            Ok(Anniversary { summary: read_summary(row)?, photos, cover_index: row.get(10)? })
        }
    ).map_err(|_| "纪念日不存在或无权查看".to_string())
}

pub fn save_anniversary(
    conn: &Connection,
    owner: &str,
    mut input: AnniversaryInput,
) -> Result<Anniversary, String> {
    input.title = input.title.trim().to_string();
    input.notes = input.notes.trim().to_string();
    validate_anniversary(&input)?;
    let now = Local::now().timestamp_millis();
    let photos = serde_json::to_string(&input.photos).map_err(|error| error.to_string())?;
    let id = input
        .id
        .clone()
        .unwrap_or_else(|| Uuid::new_v4().to_string());
    let transaction = conn
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    if input.id.is_some() {
        let changed = transaction.execute(
            "UPDATE anniversaries SET kind=?1, title=?2, date=?3, notes=?4, pinned=?5, theme=?6,
             photos_json=?7, cover_index=?8, updated_at=?9 WHERE id=?10 AND owner_id=?11",
            params![input.kind, input.title, input.date, input.notes, input.pinned, input.theme, photos, input.cover_index, now, id, owner]
        ).map_err(|error| error.to_string())?;
        if changed == 0 {
            return Err("纪念日不存在或无权修改".to_string());
        }
    } else {
        transaction.execute(
            "INSERT INTO anniversaries (id, owner_id, kind, title, date, notes, pinned, theme, photos_json, cover_index, created_at, updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?11)",
            params![id, owner, input.kind, input.title, input.date, input.notes, input.pinned, input.theme, photos, input.cover_index, now]
        ).map_err(|error| error.to_string())?;
    }
    let result = get_anniversary(&transaction, owner, &id)?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(result)
}

pub fn delete_anniversary(conn: &Connection, owner: &str, id: &str) -> Result<(), String> {
    let changed = conn
        .execute(
            "DELETE FROM anniversaries WHERE id=?1 AND owner_id=?2",
            params![id, owner],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("纪念日不存在或无权删除".to_string());
    }
    Ok(())
}

pub fn pin_anniversary(
    conn: &Connection,
    owner: &str,
    id: &str,
    pinned: bool,
) -> Result<(), String> {
    let changed = conn
        .execute(
            "UPDATE anniversaries SET pinned=?1, updated_at=?2 WHERE id=?3 AND owner_id=?4",
            params![pinned, Local::now().timestamp_millis(), id, owner],
        )
        .map_err(|error| error.to_string())?;
    if changed == 0 {
        return Err("纪念日不存在或无权修改".to_string());
    }
    Ok(())
}

fn validate_anniversary(input: &AnniversaryInput) -> Result<(), String> {
    if input.title.is_empty() || input.title.chars().count() > 120 {
        return Err("名称需为 1 至 120 个字".to_string());
    }
    if input.notes.chars().count() > 2000 {
        return Err("备注不能超过 2000 个字".to_string());
    }
    if !["countdown", "anniversary", "birthday", "holiday"].contains(&input.kind.as_str()) {
        return Err("纪念日类型无效".to_string());
    }
    if !["sky", "warm", "night"].contains(&input.theme.as_str()) {
        return Err("背景主题无效".to_string());
    }
    let date = NaiveDate::parse_from_str(&input.date, "%Y-%m-%d")
        .map_err(|_| "请选择有效的公历日期".to_string())?;
    if date.to_string() != input.date
        || !("1900-01-01"..="2100-12-31").contains(&input.date.as_str())
    {
        return Err("日期范围为 1900 至 2100 年".to_string());
    }
    if input.kind == "birthday" && date > Local::now().date_naive() {
        return Err("出生日期不能晚于今天".to_string());
    }
    if input.photos.len() > 4 {
        return Err("每条最多添加 4 张照片".to_string());
    }
    if (input.photos.is_empty() && input.cover_index != 0)
        || (!input.photos.is_empty() && input.cover_index >= input.photos.len())
    {
        return Err("封面照片无效".to_string());
    }
    for photo in &input.photos {
        let encoded = photo
            .strip_prefix("data:image/jpeg;base64,")
            .ok_or("照片必须为 JPEG 图片")?;
        if encoded.len() > 300 * 1024 * 4 / 3 {
            return Err("单张照片不能超过 300KiB".to_string());
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| "照片数据无效")?;
        if bytes.len() > 300 * 1024 {
            return Err("单张照片不能超过 300KiB".to_string());
        }
        let mut reader =
            image::ImageReader::with_format(Cursor::new(bytes), image::ImageFormat::Jpeg);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(1280);
        limits.max_image_height = Some(1280);
        limits.max_alloc = Some(1280 * 1280 * 8);
        reader.limits(limits);
        reader
            .decode()
            .map_err(|_| "照片无效或尺寸超过 1280px".to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        crate::db::initialize(&conn).unwrap();
        conn.execute("INSERT INTO users(id,username,password_hash,created_at) VALUES ('one','甲','hash',0),('two','乙','hash',0)", []).unwrap();
        conn
    }

    fn input() -> AnniversaryInput {
        AnniversaryInput {
            id: None,
            kind: "anniversary".into(),
            title: " 相伴 ".into(),
            date: "2017-02-01".into(),
            notes: " 回忆 ".into(),
            pinned: false,
            theme: "sky".into(),
            photos: vec![],
            cover_index: 0,
        }
    }

    #[test]
    fn crud_and_owner_boundaries() {
        let conn = database();
        let item = save_anniversary(&conn, "one", input()).unwrap();
        assert_eq!(item.summary.title, "相伴");
        assert!(list_anniversaries(&conn, "two").unwrap().is_empty());
        assert!(get_anniversary(&conn, "two", &item.summary.id).is_err());
        assert!(pin_anniversary(&conn, "two", &item.summary.id, true).is_err());
        assert!(delete_anniversary(&conn, "two", &item.summary.id).is_err());
        let mut update = input();
        update.id = Some(item.summary.id.clone());
        assert!(save_anniversary(&conn, "two", update).is_err());
        let mut update = input();
        update.id = Some(item.summary.id.clone());
        update.title = "十周年".into();
        save_anniversary(&conn, "one", update).unwrap();
        pin_anniversary(&conn, "one", &item.summary.id, true).unwrap();
        assert!(
            get_anniversary(&conn, "one", &item.summary.id)
                .unwrap()
                .summary
                .pinned
        );
        delete_anniversary(&conn, "one", &item.summary.id).unwrap();
        assert!(list_anniversaries(&conn, "one").unwrap().is_empty());
    }

    #[test]
    fn rejects_invalid_inputs_and_photos() {
        for (field, value) in [
            ("date", "2025-02-29"),
            ("date", "2024-2-29"),
            ("date", "1899-12-31"),
            ("title", " "),
            ("kind", "task"),
            ("theme", "unknown"),
        ] {
            let mut draft = input();
            match field {
                "date" => draft.date = value.into(),
                "title" => draft.title = value.into(),
                "kind" => draft.kind = value.into(),
                _ => draft.theme = value.into(),
            }
            assert!(save_anniversary(&database(), "one", draft).is_err());
        }
        let mut draft = input();
        draft.photos = vec!["data:image/jpeg;base64,/9j/2Q==".into()];
        assert!(validate_anniversary(&draft).is_err());
        draft.photos = vec![format!("data:image/jpeg;base64,{}", "A".repeat(410000))];
        assert!(validate_anniversary(&draft).is_err());
        draft.photos = vec![String::new(); 5];
        assert!(validate_anniversary(&draft).is_err());
        draft.photos.clear();
        draft.cover_index = 1;
        assert!(validate_anniversary(&draft).is_err());
        draft.cover_index = 0;
        draft.kind = "birthday".into();
        draft.date = "2100-01-01".into();
        assert!(validate_anniversary(&draft).is_err());
    }

    #[test]
    fn v9_upgrade_preserves_existing_data() {
        let conn = database();
        conn.execute_batch(
            "DROP TABLE anniversary_records; DROP TABLE anniversaries; PRAGMA user_version=9;",
        )
        .unwrap();
        crate::db::initialize(&conn).unwrap();
        assert_eq!(
            conn.query_row("PRAGMA user_version", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            11
        );
        assert_eq!(
            conn.query_row("SELECT count(*) FROM users", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            2
        );
        assert!(list_anniversaries(&conn, "one").unwrap().is_empty());
        crate::db::initialize(&conn).unwrap();
    }

    fn record_input(id: &str, date: &str, confirmed: bool) -> AnniversaryRecordInput {
        AnniversaryRecordInput {
            anniversary_id: id.into(),
            date: date.into(),
            notes: " 一起吃蛋糕 ".into(),
            confirmed,
        }
    }

    #[test]
    fn records_are_owned_unique_and_preserve_history() {
        let conn = database();
        let item = save_anniversary(&conn, "one", input()).unwrap();
        let id = &item.summary.id;
        let first =
            save_anniversary_record(&conn, "one", record_input(id, "2020-02-01", true)).unwrap();
        let repeated =
            save_anniversary_record(&conn, "one", record_input(id, "2020-02-01", true)).unwrap();
        assert_eq!(first.confirmed_at, repeated.confirmed_at);
        assert_eq!(repeated.notes, "一起吃蛋糕");
        assert_eq!(
            list_anniversary_records(&conn, "one", Some(id), None, None)
                .unwrap()
                .len(),
            1
        );
        assert!(
            save_anniversary_record(&conn, "two", record_input(id, "2020-02-01", true)).is_err()
        );
        assert!(list_anniversary_records(&conn, "two", Some(id), None, None).is_err());
        assert!(list_anniversary_records(&conn, "two", None, None, None)
            .unwrap()
            .is_empty());
        let mut changed = input();
        changed.id = Some(id.clone());
        changed.title = "新名称".into();
        changed.date = "2018-03-01".into();
        changed.kind = "holiday".into();
        save_anniversary(&conn, "one", changed).unwrap();
        let reopened =
            save_anniversary_record(&conn, "one", record_input(id, "2020-02-01", false)).unwrap();
        assert!(reopened.confirmed_at.is_none());
        assert_eq!(reopened.notes, first.notes);
        assert_eq!(reopened.title, "相伴");
        assert_eq!(reopened.kind, "anniversary");
        assert_eq!(reopened.original_date, "2017-02-01");
        save_anniversary_record(&conn, "one", record_input(id, "2021-03-01", true)).unwrap();
        assert_eq!(
            list_anniversary_records(&conn, "one", None, Some("2021-03-01"), Some("2021-03-01"))
                .unwrap()
                .len(),
            1
        );
        delete_anniversary(&conn, "one", id).unwrap();
        assert!(list_anniversary_records(&conn, "one", None, None, None)
            .unwrap()
            .is_empty());
    }

    #[test]
    fn record_dates_limits_and_transaction_failure_are_checked() {
        let conn = database();
        let item = save_anniversary(&conn, "one", input()).unwrap();
        let id = &item.summary.id;
        for date in [
            "2016-02-01",
            "2020-02-02",
            "2025-02-29",
            "2020-2-1",
            "2100-02-01",
        ] {
            assert!(save_anniversary_record(&conn, "one", record_input(id, date, true)).is_err());
        }
        let mut oversized = record_input(id, "2020-02-01", false);
        oversized.notes = "字".repeat(2001);
        assert!(save_anniversary_record(&conn, "one", oversized).is_err());
        let original =
            save_anniversary_record(&conn, "one", record_input(id, "2020-02-01", true)).unwrap();
        conn.execute_batch("CREATE TRIGGER fail_record_update BEFORE UPDATE ON anniversary_records BEGIN SELECT RAISE(ABORT,'失败'); END;").unwrap();
        assert!(
            save_anniversary_record(&conn, "one", record_input(id, "2020-02-01", false)).is_err()
        );
        let saved = list_anniversary_records(&conn, "one", Some(id), None, None)
            .unwrap()
            .pop()
            .unwrap();
        assert_eq!(saved.confirmed_at, original.confirmed_at);
        assert_eq!(saved.notes, original.notes);
    }

    #[test]
    fn leap_day_fixed_date_and_v10_upgrade_are_supported() {
        let conn = database();
        let item = save_anniversary(&conn, "one", input()).unwrap();
        conn.execute_batch("DROP TABLE anniversary_records; PRAGMA user_version=10;")
            .unwrap();
        crate::db::initialize(&conn).unwrap();
        assert_eq!(
            get_anniversary(&conn, "one", &item.summary.id)
                .unwrap()
                .summary
                .notes,
            "回忆"
        );
        assert!(list_anniversary_records(&conn, "one", None, None, None)
            .unwrap()
            .is_empty());
        let mut leap = input();
        leap.kind = "birthday".into();
        leap.date = "2000-02-29".into();
        let birthday = save_anniversary(&conn, "one", leap).unwrap();
        assert!(save_anniversary_record(
            &conn,
            "one",
            record_input(&birthday.summary.id, "2021-02-28", true)
        )
        .is_ok());
        assert!(save_anniversary_record(
            &conn,
            "one",
            record_input(&birthday.summary.id, "2020-02-28", true)
        )
        .is_err());
        assert!(save_anniversary_record(
            &conn,
            "one",
            record_input(&birthday.summary.id, "2020-02-29", true)
        )
        .is_ok());
        let mut fixed = input();
        fixed.kind = "countdown".into();
        let fixed = save_anniversary(&conn, "one", fixed).unwrap();
        assert!(save_anniversary_record(
            &conn,
            "one",
            record_input(&fixed.summary.id, "2017-02-01", true)
        )
        .is_ok());
        assert!(save_anniversary_record(
            &conn,
            "one",
            record_input(&fixed.summary.id, "2020-02-01", true)
        )
        .is_err());
    }
}
