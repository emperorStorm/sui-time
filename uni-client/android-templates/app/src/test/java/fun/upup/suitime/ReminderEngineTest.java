package fun.upup.suitime;

import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import static org.junit.Assert.*;

public class ReminderEngineTest {
    @Before public void timezone() { TimeZone.setDefault(TimeZone.getTimeZone("Asia/Shanghai")); }
    private long time(String value) throws Exception { return new SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).parse(value).getTime(); }
    private JSONObject task(String date, String kind) throws Exception {
        return new JSONObject().put("id", "source").put("title", "原生测试")
                .put("plannedDate", date).put("plannedTime", "09:00").put("scheduleKind", "point").put("status", "todo")
                .put("reminderOffsets", new JSONArray("[0,15]")).put("repeatRule", new JSONObject().put("kind", kind).toString());
    }
    private Map<String, JSONObject> next(JSONObject task, String now) throws Exception { return ReminderEngine.next(new JSONArray().put(task), time(now)); }

    @Test public void minuteAndNextOccurrence() throws Exception {
        JSONObject task = task("2026-10-10", "daily");
        Map<String, JSONObject> result = next(task, "2026-10-10 08:40:00");
        assertEquals(time("2026-10-10 08:45:00"), result.get("source:15").getLong("triggerAt"));
        assertEquals(time("2026-10-10 09:00:00"), result.get("source:0").getLong("triggerAt"));
        assertEquals(time("2026-10-11 09:00:00"), next(task, "2026-10-10 09:00:00").get("source:0").getLong("triggerAt"));
        task.put("repeatRule", "{\"kind\":\"none\"}");
        assertTrue(next(task, "2026-10-10 09:01:00").isEmpty());
    }

    @Test public void monthEndLeapYearAndWeek() throws Exception {
        assertEquals("2026-03-31", next(task("2026-01-31", "monthly"), "2026-02-01 00:00:00").get("source:0").getString("date"));
        assertEquals("2028-02-29", next(task("2024-02-29", "yearly"), "2025-01-01 00:00:00").get("source:0").getString("date"));
        assertEquals("2026-10-17", next(task("2026-10-10", "weekly"), "2026-10-11 00:00:00").get("source:0").getString("date"));
    }

    @Test public void movedInstanceAdditionalOffsetAndCompletion() throws Exception {
        JSONObject task = task("2026-10-10", "daily");
        task.put("status", "done");
        task.put("occurrenceOverrides", "{\"2026-10-10\":{\"status\":\"done\"},\"2026-10-11\":{\"plannedDate\":\"2026-10-12\",\"plannedTime\":\"08:00\",\"title\":\"改期\",\"reminderOffsets\":[0,30]}}");
        Map<String, JSONObject> result = next(task, "2026-10-10 00:00:00");
        assertEquals("2026-10-11", result.get("source@2026-10-11:0").getString("sourceDate"));
        assertEquals("改期", result.get("source@2026-10-11:0").getString("title"));
        assertEquals(time("2026-10-12 07:30:00"), result.get("source@2026-10-11:30").getLong("triggerAt"));
        assertEquals(time("2026-10-12 09:00:00"), next(task, "2026-10-12 08:00:00").get("source:0").getLong("triggerAt"));
    }

    @Test public void allDayNoRemindersChildrenAndExpiredRule() throws Exception {
        JSONObject task = task("2026-10-10", "daily");
        task.put("scheduleKind", "all_day");
        assertTrue(next(task, "2026-10-10 00:00:00").isEmpty());
        task.put("scheduleKind", "point").put("parentTaskId", "parent");
        assertTrue(next(task, "2026-10-10 00:00:00").isEmpty());
        task.remove("parentTaskId");
        task.put("reminderOffsets", new JSONArray());
        assertTrue(next(task, "2026-10-10 00:00:00").isEmpty());
        task.put("reminderOffsets", new JSONArray("[0]")).put("repeatRule", "{\"kind\":\"daily\",\"endMode\":\"count\",\"count\":2}");
        assertTrue(next(task, "2026-10-12 00:00:00").isEmpty());
        task.put("repeatRule", "{\"kind\":\"daily\",\"endMode\":\"date\",\"endDate\":\"2026-10-10\"}");
        assertTrue(next(task, "2026-10-11 00:00:00").isEmpty());
    }

    @Test public void dstUsesCalendarDays() throws Exception {
        TimeZone.setDefault(TimeZone.getTimeZone("America/New_York"));
        assertEquals("2026-03-09", next(task("2026-03-07", "daily"), "2026-03-08 09:00:00").get("source:0").getString("date"));
    }

    @Test public void simultaneousMovedInstancesHaveIndependentAlarms() throws Exception {
        JSONObject task = task("2026-10-10", "daily");
        task.put("occurrenceOverrides", "{\"2026-10-10\":{\"plannedDate\":\"2026-10-12\"},\"2026-10-11\":{\"plannedDate\":\"2026-10-12\"}}");
        Map<String, JSONObject> result = next(task, "2026-10-10 00:00:00");
        assertEquals(6, result.size());
        assertEquals(result.get("source:0").getLong("triggerAt"), result.get("source@2026-10-11:0").getLong("triggerAt"));
    }
}
