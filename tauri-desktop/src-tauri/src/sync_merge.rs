use crate::sync_repo::{
    SyncChange, ENTITY_ANNIVERSARY, ENTITY_ANNIVERSARY_RECORD, ENTITY_CATEGORY, ENTITY_SETTING,
    ENTITY_TASK,
};

/// 单次推送上限，与服务端保持一致。
pub const MAX_PUSH_CHANGES: usize = 200;

/// 新版本优先：先比 `updatedAt`，相同时按 `deviceId` 字典序取大者。
/// 完全相同的版本视为幂等重复，不覆盖。
pub fn incoming_wins(
    incoming_updated_at: i64,
    incoming_device_id: &str,
    local_updated_at: i64,
    local_device_id: &str,
) -> bool {
    if incoming_updated_at != local_updated_at {
        return incoming_updated_at > local_updated_at;
    }
    incoming_device_id > local_device_id
}

fn entity_rank(entity: &str) -> u8 {
    match entity {
        ENTITY_CATEGORY => 0,
        ENTITY_ANNIVERSARY => 1,
        ENTITY_TASK => 2,
        ENTITY_ANNIVERSARY_RECORD => 3,
        ENTITY_SETTING => 4,
        _ => 5,
    }
}

/// 应用远端变更前排序：先分类，再纪念日，再事项，最后纪念记录与设置。
pub fn sort_for_apply(changes: &mut [SyncChange]) {
    changes.sort_by(|left, right| entity_rank(&left.entity).cmp(&entity_rank(&right.entity)));
}

pub fn chunk_changes(changes: &[SyncChange], size: usize) -> Vec<&[SyncChange]> {
    let size = size.max(1);
    changes.chunks(size).collect()
}

pub fn push_batches<'a>(
    changes: &'a [SyncChange],
    device_id: &str,
) -> Result<Vec<&'a [SyncChange]>, String> {
    let overhead = serde_json::to_vec(
        &serde_json::json!({"deviceId":device_id,"requireEmpty":false,"changes":[]}),
    )
    .map_err(|error| error.to_string())?
    .len();
    let mut batches = Vec::new();
    for group in chunk_changes(changes, MAX_PUSH_CHANGES) {
        let mut start = 0;
        let mut bytes = overhead;
        for (index, change) in group.iter().enumerate() {
            let size = serde_json::to_vec(change)
                .map_err(|error| error.to_string())?
                .len()
                + 1;
            if overhead + size > 8 * 1024 * 1024 {
                return Err("单条数据超过上传上限，请减少照片后重试".into());
            }
            if bytes + size > 8 * 1024 * 1024 {
                batches.push(&group[start..index]);
                start = index;
                bytes = overhead;
            }
            bytes += size;
        }
        if start < group.len() {
            batches.push(&group[start..]);
        }
    }
    Ok(batches)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn change(entity: &str, id: &str) -> SyncChange {
        SyncChange {
            entity: entity.to_string(),
            id: id.to_string(),
            updated_at: 1,
            deleted_at: None,
            device_id: "a".into(),
            data: json!({}),
        }
    }

    #[test]
    fn newer_timestamp_wins() {
        assert!(incoming_wins(200, "a", 100, "b"));
        assert!(!incoming_wins(100, "b", 200, "a"));
        assert!(!incoming_wins(100, "a", 100, "a"));
    }

    #[test]
    fn same_timestamp_breaks_tie_by_device() {
        assert!(incoming_wins(100, "b", 100, "a"));
        assert!(!incoming_wins(100, "a", 100, "b"));
        assert!(!incoming_wins(100, "", 100, ""));
    }

    #[test]
    fn apply_order_respects_dependencies() {
        let mut changes = vec![
            change(ENTITY_SETTING, "s"),
            change(ENTITY_ANNIVERSARY_RECORD, "r"),
            change(ENTITY_TASK, "t"),
            change(ENTITY_ANNIVERSARY, "a"),
            change(ENTITY_CATEGORY, "c"),
        ];
        sort_for_apply(&mut changes);
        let order: Vec<&str> = changes.iter().map(|item| item.entity.as_str()).collect();
        assert_eq!(
            order,
            vec![
                ENTITY_CATEGORY,
                ENTITY_ANNIVERSARY,
                ENTITY_TASK,
                ENTITY_ANNIVERSARY_RECORD,
                ENTITY_SETTING
            ]
        );
    }

    #[test]
    fn chunks_never_exceed_limit() {
        let changes: Vec<SyncChange> = (0..451)
            .map(|index| change(ENTITY_TASK, &index.to_string()))
            .collect();
        let chunks = chunk_changes(&changes, MAX_PUSH_CHANGES);
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks[0].len(), 200);
        assert_eq!(chunks[2].len(), 51);
        assert!(chunk_changes(&[], 10).is_empty());
    }
}
