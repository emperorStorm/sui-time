package fun.upup.suitime;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

// 只计算下一次触发；接收器触发后继续计算，重复提醒不依赖 JS 进程存活。
public final class ReminderEngine {
    private static final int[] OFFSETS = {0, 5, 15, 30, 60, 120};
    private ReminderEngine() {}

    public static Map<String, JSONObject> next(JSONArray tasks, long now) throws Exception {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (int index = 0; index < tasks.length(); index++) {
            JSONObject task = tasks.getJSONObject(index);
            if (!task.isNull("parentTaskId") && !task.optString("parentTaskId").isEmpty()) continue;
            String start = task.optString("plannedDate");
            if (!validDate(start) || task.optString("id").isEmpty()) continue;
            JSONObject rule = json(task.optString("repeatRule", "{}"));
            JSONObject overrides = json(task.optString("occurrenceOverrides", "{}"));
            String kind = rule.optString("kind", "none");
            if ((task.optJSONArray("reminderOffsets") == null || task.optJSONArray("reminderOffsets").length() == 0) && overrides.length() == 0) continue;
            if (!supported(kind)) throw new IllegalArgumentException("暂不支持此重复规则的安卓提醒：" + kind);
            for (int offset : OFFSETS) {
                JSONObject candidate = null;
                if (contains(task.optJSONArray("reminderOffsets"), offset) && !"all_day".equals(task.optString("scheduleKind", task.optString("plannedTime").isEmpty() ? "all_day" : "point"))
                        && task.optString("plannedTime").matches("([01][0-9]|2[0-3]):[0-5][0-9]") && (!"none".equals(kind) || "todo".equals(task.optString("status", "todo")))) {
                    String from = format(now - 86400000L);
                    Calendar cursor = date(start.compareTo(from) > 0 ? start : from);
                    if ("none".equals(kind)) cursor = date(start);
                    while (cursor.get(Calendar.YEAR) <= 2100) {
                        String sourceDate = format(cursor.getTimeInMillis());
                        if (rule.optString("endMode").equals("date") && sourceDate.compareTo(rule.optString("endDate", "2100-12-31")) > 0) break;
                        if (rule.optString("endMode").equals("count") && days(start, sourceDate) > (rule.optInt("count", 1) - 1L) * Math.max(1, rule.optInt("interval", 1))) break;
                        if (occurs(start, sourceDate, rule)) {
                            JSONObject override = overrides.optJSONObject(sourceDate);
                            if (override == null) {
                                candidate = request(task, null, sourceDate, sourceDate, offset, now, kind);
                                if (candidate != null) break;
                            }
                        }
                        if ("none".equals(kind)) break;
                        cursor.add(Calendar.DATE, 1);
                    }
                }
                if (candidate != null) result.put(task.getString("id") + ":" + offset, candidate);
                // 单次覆盖独立标识；多条实例改到同一时刻时也不会互相覆盖或漏发。
                Iterator<String> keys = overrides.keys();
                while (keys.hasNext()) {
                    String sourceDate = keys.next();
                    JSONObject override = overrides.optJSONObject(sourceDate);
                    if (override == null || !validDate(sourceDate) || !occurs(start, sourceDate, rule)) continue;
                    String targetDate = override.optString("plannedDate", sourceDate);
                    JSONObject moved = request(task, override, sourceDate, targetDate, offset, now, kind);
                    if (moved != null) result.put(task.getString("id") + "@" + sourceDate + ":" + offset, moved);
                }
            }
        }
        return result;
    }

    private static JSONObject request(JSONObject task, JSONObject override, String sourceDate, String targetDate, int offset, long now, String kind) throws Exception {
        JSONObject effective = new JSONObject(task.toString());
        if (!"none".equals(kind)) effective.put("status", "todo");
        if (override != null) {
            Iterator<String> keys = override.keys();
            while (keys.hasNext()) { String key = keys.next(); effective.put(key, override.get(key)); }
        }
        if (effective.optBoolean("deleted") || !"todo".equals(effective.optString("status", "todo")) || "all_day".equals(effective.optString("scheduleKind", effective.optString("plannedTime").isEmpty() ? "all_day" : "point")) || !validDate(targetDate) || !contains(effective.optJSONArray("reminderOffsets"), offset)) return null;
        String time = effective.optString("plannedTime");
        if (!time.matches("([01][0-9]|2[0-3]):[0-5][0-9]")) return null;
        Calendar planned = date(targetDate);
        planned.set(Calendar.HOUR_OF_DAY, Integer.parseInt(time.substring(0, 2)));
        planned.set(Calendar.MINUTE, Integer.parseInt(time.substring(3)));
        planned.set(Calendar.SECOND, 0);
        planned.set(Calendar.MILLISECOND, 0);
        long trigger = planned.getTimeInMillis() - offset * 60000L;
        if (trigger <= now) return null;
        return new JSONObject().put("taskId", task.getString("id")).put("sourceDate", sourceDate).put("date", targetDate)
                .put("offset", offset).put("triggerAt", trigger).put("title", effective.optString("title"))
                .put("body", (offset == 0 ? "准时提醒" : "提前 " + offset + " 分钟") + " · " + targetDate + " " + time);
    }

    static boolean occurs(String start, String target, JSONObject rule) throws Exception {
        if (target.compareTo(start) < 0) return false;
        String kind = rule.optString("kind", "none");
        if ("none".equals(kind)) return target.equals(start);
        long elapsed = days(start, target);
        int interval = Math.max(1, rule.optInt("interval", 1));
        if ("date".equals(rule.optString("endMode")) && target.compareTo(rule.optString("endDate", "2100-12-31")) > 0) return false;
        if ("count".equals(rule.optString("endMode")) && elapsed > (rule.optInt("count", 1) - 1L) * interval) return false;
        if ("daily".equals(kind)) return elapsed % interval == 0;
        if ("weekly".equals(kind)) return elapsed % 7 == 0;
        if ("monthly".equals(kind)) return target.substring(8).equals(start.substring(8));
        return "yearly".equals(kind) && target.substring(5).equals(start.substring(5));
    }

    private static boolean supported(String kind) { return "none".equals(kind) || "daily".equals(kind) || "weekly".equals(kind) || "monthly".equals(kind) || "yearly".equals(kind); }
    private static boolean contains(JSONArray values, int offset) { if (values != null) for (int i = 0; i < values.length(); i++) if (values.optInt(i, -1) == offset) return true; return false; }
    private static JSONObject json(String text) { try { return new JSONObject(text); } catch (Exception ignored) { return new JSONObject(); } }
    private static String format(long value) { return new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(value)); }
    private static Calendar date(String value) throws Exception {
        SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        parser.setLenient(false);
        Calendar calendar = Calendar.getInstance();
        calendar.setTime(parser.parse(value));
        return calendar;
    }
    private static boolean validDate(String value) { try { return value.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}") && value.equals(format(date(value).getTimeInMillis())); } catch (Exception error) { return false; } }
    private static long days(String start, String end) throws Exception {
        SimpleDateFormat parser = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
        parser.setTimeZone(TimeZone.getTimeZone("UTC"));
        return (parser.parse(end).getTime() - parser.parse(start).getTime()) / 86400000L;
    }
}
