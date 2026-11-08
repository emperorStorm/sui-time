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

    @Test public void countUsesMatchingOccurrences() throws Exception {
        JSONObject weekly = task("2026-10-10", "weekly").put("repeatRule", "{\"kind\":\"weekly\",\"endMode\":\"count\",\"count\":3,\"interval\":9}");
        assertEquals("2026-10-24", next(weekly, "2026-10-17 09:00:00").get("source:0").getString("date"));
        assertTrue(next(weekly, "2026-10-24 09:00:00").isEmpty());
        JSONObject monthly = task("2026-01-31", "monthly").put("repeatRule", "{\"kind\":\"monthly\",\"endMode\":\"count\",\"count\":3}");
        assertEquals("2026-05-31", next(monthly, "2026-03-31 09:00:00").get("source:0").getString("date"));
        assertTrue(next(monthly, "2026-05-31 09:00:00").isEmpty());
        JSONObject yearly = task("2024-02-29", "yearly").put("repeatRule", "{\"kind\":\"yearly\",\"endMode\":\"count\",\"count\":3}");
        assertEquals("2032-02-29", next(yearly, "2028-02-29 09:00:00").get("source:0").getString("date"));
        assertTrue(next(yearly, "2032-02-29 09:00:00").isEmpty());
        JSONObject daily = task("2026-10-10", "daily").put("repeatRule", "{\"kind\":\"daily\",\"interval\":2,\"endMode\":\"count\",\"count\":2}");
        assertEquals("2026-10-12", next(daily, "2026-10-10 09:00:00").get("source:0").getString("date"));
        assertTrue(next(daily, "2026-10-12 09:00:00").isEmpty());
    }

    @Test public void missingOrNonPositiveCountRemainsUnlimited() throws Exception {
        for (String count : new String[]{"", ",\"count\":0", ",\"count\":-2"}) {
            JSONObject rule = new JSONObject("{\"kind\":\"weekly\",\"endMode\":\"count\"" + count + "}");
            assertTrue(ReminderEngine.occurs("2026-01-01", "2026-01-15", rule));
            JSONObject task = task("2026-01-01", "weekly").put("repeatRule", rule.toString());
            assertEquals("2026-01-15", next(task, "2026-01-14 00:00:00").get("source:0").getString("date"));
        }
    }

    @Test public void countHonorsLeapYearsAndMovedOverrides() throws Exception {
        JSONObject monthlyRule = new JSONObject("{\"kind\":\"monthly\",\"endMode\":\"count\",\"count\":14}");
        assertTrue(ReminderEngine.occurs("2023-01-29", "2024-03-29", monthlyRule));
        assertFalse(ReminderEngine.occurs("2023-01-29", "2024-04-29", monthlyRule));
        JSONObject yearlyRule = new JSONObject("{\"kind\":\"yearly\",\"endMode\":\"count\",\"count\":2}");
        assertTrue(ReminderEngine.occurs("2096-02-29", "2104-02-29", yearlyRule));
        assertFalse(ReminderEngine.occurs("2096-02-29", "2108-02-29", yearlyRule));
        JSONObject task = task("2026-01-31", "monthly").put("repeatRule", "{\"kind\":\"monthly\",\"endMode\":\"count\",\"count\":2}")
                .put("occurrenceOverrides", "{\"2026-03-31\":{\"plannedDate\":\"2026-06-01\"},\"2026-05-31\":{\"plannedDate\":\"2026-06-01\"}}");
        Map<String, JSONObject> result = next(task, "2026-04-01 00:00:00");
        assertTrue(result.containsKey("source@2026-03-31:0"));
        assertFalse(result.containsKey("source@2026-05-31:0"));
    }

    @Test public void unsupportedRuleDoesNotBlockOtherTasks() throws Exception {
        JSONObject unsupported = task("2026-10-10", "workdays").put("id", "unsupported").put("title", "工作日事项");
        JSONArray warnings = new JSONArray();
        Map<String, JSONObject> result = ReminderEngine.next(new JSONArray().put(unsupported).put(task("2026-10-10", "daily")), time("2026-10-10 08:00:00"), warnings);
        assertTrue(result.containsKey("source:0"));
        assertFalse(result.containsKey("unsupported:0"));
        assertEquals(1, warnings.length());
        JSONObject warning = warnings.getJSONObject(0);
        assertEquals("工作日事项", warning.getString("title"));
        assertEquals("unsupported", warning.getString("id"));
        assertEquals("workdays", warning.getString("kind"));
    }

    @Test public void everyDaysIntervalAndEndLimits() throws Exception {
        String ruleText = "{\"kind\":\"every_days\",\"interval\":3,\"endMode\":\"count\",\"count\":3,\"extra\":\"保留\"}";
        JSONObject task = task("2026-10-10", "every_days").put("repeatRule", ruleText);
        JSONObject rule = new JSONObject(ruleText);
        assertTrue(ReminderEngine.occurs("2026-10-10", "2026-10-13", rule));
        assertFalse(ReminderEngine.occurs("2026-10-10", "2026-10-14", rule));
        assertTrue(ReminderEngine.occurs("2026-10-10", "2026-10-16", rule));
        assertFalse(ReminderEngine.occurs("2026-10-10", "2026-10-19", rule));
        assertEquals("2026-10-16", next(task, "2026-10-13 09:00:00").get("source:0").getString("date"));
        assertTrue(next(task, "2026-10-16 09:00:00").isEmpty());
        assertTrue(next(task, "2099-01-01 00:00:00").isEmpty());
        assertEquals(ruleText, task.getString("repeatRule"));

        task.put("repeatRule", "{\"kind\":\"every_days\",\"interval\":3,\"endMode\":\"date\",\"endDate\":\"2026-10-15\"}");
        assertEquals("2026-10-13", next(task, "2026-10-10 09:00:00").get("source:0").getString("date"));
        assertTrue(next(task, "2026-10-13 09:00:00").isEmpty());
        assertFalse(ReminderEngine.occurs("2026-10-10", "2026-10-16", new JSONObject(task.getString("repeatRule"))));
        task.put("occurrenceOverrides", "{\"2026-10-13\":{\"plannedDate\":\"2026-10-20\"},\"2026-10-16\":{\"plannedDate\":\"2026-10-20\"}}");
        Map<String, JSONObject> moved = next(task, "2026-10-17 00:00:00");
        assertTrue(moved.containsKey("source@2026-10-13:0"));
        assertFalse(moved.containsKey("source@2026-10-16:0"));
        task.remove("occurrenceOverrides");
        task.put("repeatRule", "{\"kind\":\"every_days\",\"interval\":0}");
        assertEquals("2026-10-11", next(task, "2026-10-10 09:00:00").get("source:0").getString("date"));
    }

    @Test public void everyDaysOverridesAndSameTimeBatch() throws Exception {
        JSONObject task = task("2026-10-10", "every_days")
                .put("repeatRule", "{\"kind\":\"every_days\",\"interval\":2,\"endMode\":\"count\",\"count\":5}")
                .put("occurrenceOverrides", "{\"2026-10-10\":{\"status\":\"done\"},\"2026-10-12\":{\"deleted\":true},"
                        + "\"2026-10-14\":{\"plannedDate\":\"2026-10-18\"},\"2026-10-16\":{\"plannedDate\":\"2026-10-18\"},"
                        + "\"2026-10-17\":{\"plannedDate\":\"2026-10-18\"},\"2026-10-20\":{\"plannedDate\":\"2026-10-18\"}}");
        Map<String, JSONObject> result = next(task, "2026-10-10 00:00:00");
        assertFalse(result.containsKey("source@2026-10-10:0"));
        assertFalse(result.containsKey("source@2026-10-12:0"));
        assertFalse(result.containsKey("source@2026-10-17:0"));
        assertFalse(result.containsKey("source@2026-10-20:0"));
        assertEquals("2026-10-18", result.get("source:0").getString("date"));
        assertEquals("2026-10-18", result.get("source@2026-10-14:0").getString("date"));
        assertEquals("2026-10-18", result.get("source@2026-10-16:0").getString("date"));
        JSONObject pending = new JSONObject();
        for (Map.Entry<String, JSONObject> entry : result.entrySet()) pending.put(entry.getKey(), entry.getValue());
        assertEquals(3, ReminderEngine.dueAt(pending, result, time("2026-10-18 09:00:00")).size());
    }

    @Test public void everyDaysUsesLocalTimeAcrossDstAndTimezones() throws Exception {
        for (String zone : new String[]{"America/New_York", "Europe/Berlin", "Asia/Shanghai"}) {
            TimeZone.setDefault(TimeZone.getTimeZone(zone));
            JSONObject task = task("2026-03-07", "every_days")
                    .put("repeatRule", "{\"kind\":\"every_days\",\"interval\":2,\"endMode\":\"count\",\"count\":3}");
            JSONObject result = next(task, "2026-03-07 09:00:00").get("source:0");
            assertEquals(zone, "2026-03-09", result.getString("date"));
            assertEquals(zone, time("2026-03-09 09:00:00"), result.getLong("triggerAt"));
            assertEquals(zone, "2026-03-11", next(task, "2026-03-09 09:00:00").get("source:0").getString("date"));
            assertTrue(zone, next(task, "2026-03-11 09:00:00").isEmpty());
        }
    }

    @Test public void otherAdvancedKindsRemainUnsupported() throws Exception {
        JSONArray tasks = new JSONArray().put(task("2026-10-10", "every_days")
                .put("repeatRule", "{\"kind\":\"every_days\",\"interval\":2}"));
        String[] kinds = {"workdays", "weekly_slots", "monthly_slots", "memory", "custom"};
        for (String kind : kinds) tasks.put(task("2026-10-10", kind).put("id", kind));
        JSONArray warnings = new JSONArray();
        Map<String, JSONObject> result = ReminderEngine.next(tasks, time("2026-10-10 08:00:00"), warnings);
        assertEquals(2, result.size());
        assertEquals(kinds.length, warnings.length());
        JSONArray collected = new JSONArray();
        ReminderEngine.collectUnsupported(tasks, collected);
        assertEquals(warnings.toString(), collected.toString());
        for (int i = 0; i < kinds.length; i++) {
            assertEquals(kinds[i], warnings.getJSONObject(i).getString("kind"));
            assertEquals(kinds[i], warnings.getJSONObject(i).getString("id"));
            assertFalse(result.containsKey(kinds[i] + ":0"));
        }
    }

    @Test public void unsupportedWarningsOnlyIncludeTasksWithReminderSettings() throws Exception {
        JSONObject noReminder = task("2026-10-10", "workdays").put("id", "no-reminder")
                .put("reminderOffsets", new JSONArray()).put("occurrenceOverrides", "{\"2026-10-10\":{\"status\":\"done\"}}");
        JSONObject withReminder = task("2026-10-10", "workdays").put("id", "with-reminder")
                .put("reminderOffsets", new JSONArray()).put("occurrenceOverrides", "{\"2026-10-12\":{\"reminderOffsets\":[0]}}");
        JSONArray tasks = new JSONArray().put(noReminder).put(withReminder);
        JSONArray warnings = new JSONArray();
        ReminderEngine.next(tasks, time("2026-10-10 08:00:00"), warnings);
        assertEquals(1, warnings.length());
        assertEquals("with-reminder", warnings.getJSONObject(0).getString("id"));
        JSONArray collected = new JSONArray();
        ReminderEngine.collectUnsupported(tasks, collected);
        assertEquals(warnings.toString(), collected.toString());
    }

    @Test public void failurePreservesPreviouslyKnownWarnings() throws Exception {
        JSONArray previous = new JSONArray().put(new JSONObject().put("id", "a").put("title", "之前的事项").put("kind", "workdays"));
        JSONArray current = new JSONArray().put(new JSONObject().put("id", "b").put("title", "本次事项").put("kind", "memory"));
        JSONArray merged = ReminderEngine.mergeWarnings(current, previous);
        assertEquals(2, merged.length());
        assertEquals("b", merged.getJSONObject(0).getString("id"));
        assertEquals("a", merged.getJSONObject(1).getString("id"));
        assertEquals(1, ReminderEngine.mergeWarnings(previous, previous).length());
    }

    @Test public void dueBatchIncludesOnlyCurrentRequestsAtSameTime() throws Exception {
        long trigger = time("2026-10-12 09:00:00");
        JSONObject task = task("2026-10-10", "daily");
        task.put("occurrenceOverrides", "{\"2026-10-10\":{\"plannedDate\":\"2026-10-12\"},\"2026-10-11\":{\"plannedDate\":\"2026-10-12\"}}");
        Map<String, JSONObject> current = next(task, "2026-10-12 08:59:59");
        JSONObject pending = new JSONObject();
        for (Map.Entry<String, JSONObject> entry : current.entrySet()) pending.put(entry.getKey(), entry.getValue());
        pending.put("deleted:0", new JSONObject().put("triggerAt", trigger));
        pending.put("changed:0", new JSONObject().put("triggerAt", trigger));
        current.put("changed:0", new JSONObject().put("triggerAt", trigger + 60000));
        Map<String, JSONObject> due = ReminderEngine.dueAt(pending, current, trigger);
        assertEquals(3, due.size());
        assertTrue(due.containsKey("source:0"));
        assertTrue(due.containsKey("source@2026-10-10:0"));
        assertTrue(due.containsKey("source@2026-10-11:0"));
        assertFalse(due.containsKey("deleted:0"));
        assertFalse(due.containsKey("changed:0"));
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
