package fun.upup.suitime;

import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.HashSet;
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
        return next(tasks, now, null);
    }

    static void collectUnsupported(JSONArray tasks, JSONArray unsupported) throws Exception {
        for (int index = 0; index < tasks.length(); index++) {
            JSONObject task = tasks.getJSONObject(index);
            if (!task.isNull("parentTaskId") && !task.optString("parentTaskId").isEmpty()) continue;
            if (!validDate(task.optString("plannedDate")) || task.optString("id").isEmpty()) continue;
            JSONObject overrides = json(task.optString("occurrenceOverrides", "{}"));
            if (!hasReminderIntent(task, overrides)) continue;
            String kind = json(task.optString("repeatRule", "{}")).optString("kind", "none");
            if (!supported(kind)) unsupported.put(unsupportedWarning(task, kind));
        }
    }

    private static JSONObject unsupportedWarning(JSONObject task, String kind) throws Exception {
        return new JSONObject().put("id", task.optString("id")).put("title", task.optString("title", "")).put("kind", kind);
    }

    private static boolean hasReminderIntent(JSONObject task, JSONObject overrides) {
        JSONArray offsets = task.optJSONArray("reminderOffsets");
        if (offsets != null && offsets.length() > 0) return true;
        Iterator<String> keys = overrides.keys();
        while (keys.hasNext()) {
            JSONObject override = overrides.optJSONObject(keys.next());
            if (override == null || override.optBoolean("deleted") || !"todo".equals(override.optString("status", "todo"))) continue;
            JSONArray overrideOffsets = override.optJSONArray("reminderOffsets");
            if (overrideOffsets != null && overrideOffsets.length() > 0) return true;
        }
        return false;
    }

    static JSONArray mergeWarnings(JSONArray current, JSONArray saved) {
        JSONArray result = new JSONArray();
        HashSet<String> seen = new HashSet<>();
        for (JSONArray source : new JSONArray[]{current, saved}) {
            if (source == null) continue;
            for (int index = 0; index < source.length(); index++) {
                JSONObject warning = source.optJSONObject(index);
                if (warning != null && seen.add(warning.optString("id") + "\n" + warning.optString("kind"))) result.put(warning);
            }
        }
        return result;
    }

    static Map<String, JSONObject> next(JSONArray tasks, long now, JSONArray unsupported) throws Exception {
        Map<String, JSONObject> result = new LinkedHashMap<>();
        for (int index = 0; index < tasks.length(); index++) {
            JSONObject task = tasks.getJSONObject(index);
            if (!task.isNull("parentTaskId") && !task.optString("parentTaskId").isEmpty()) continue;
            String start = task.optString("plannedDate");
            if (!validDate(start) || task.optString("id").isEmpty()) continue;
            JSONObject rule = json(task.optString("repeatRule", "{}"));
            JSONObject overrides = json(task.optString("occurrenceOverrides", "{}"));
            String kind = rule.optString("kind", "none");
            if (!hasReminderIntent(task, overrides)) continue;
            if (!supported(kind)) {
                if (unsupported != null) unsupported.put(unsupportedWarning(task, kind));
                continue;
            }
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
                        boolean matched = matches(start, sourceDate, rule);
                        if (!"none".equals(kind) && "count".equals(rule.optString("endMode"))) {
                            double count = rule.optDouble("count", 0);
                            if (count > 0 && ((isDaily(kind) && days(start, sourceDate) > (count - 1) * Math.max(1, rule.optInt("interval", 1)))
                                    || ("weekly".equals(kind) && days(start, sourceDate) > (count - 1) * 7)
                                    || (matched && occurrenceNumber(start, sourceDate, rule) > count))) break;
                        }
                        if (matched) {
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
        if (!matches(start, target, rule)) return false;
        if ("none".equals(rule.optString("kind", "none"))) return true;
        if ("date".equals(rule.optString("endMode")) && target.compareTo(rule.optString("endDate", "2100-12-31")) > 0) return false;
        double count = rule.optDouble("count", 0);
        return !"count".equals(rule.optString("endMode")) || !(count > 0) || occurrenceNumber(start, target, rule) <= count;
    }

    private static boolean matches(String start, String target, JSONObject rule) throws Exception {
        if (target.compareTo(start) < 0) return false;
        String kind = rule.optString("kind", "none");
        if ("none".equals(kind)) return target.equals(start);
        if (isDaily(kind)) return days(start, target) % Math.max(1, rule.optInt("interval", 1)) == 0;
        if ("weekly".equals(kind)) return days(start, target) % 7 == 0;
        if ("monthly".equals(kind)) return target.substring(8).equals(start.substring(8));
        return "yearly".equals(kind) && target.substring(5).equals(start.substring(5));
    }

    // 调用时目标日期已匹配；缺少对应日期的月份或年份不计入次数。
    private static long occurrenceNumber(String start, String target, JSONObject rule) throws Exception {
        String kind = rule.optString("kind", "none");
        if (isDaily(kind)) return days(start, target) / Math.max(1, rule.optInt("interval", 1)) + 1;
        if ("weekly".equals(kind)) return days(start, target) / 7 + 1;
        int startYear = Integer.parseInt(start.substring(0, 4));
        int targetYear = Integer.parseInt(target.substring(0, 4));
        if ("yearly".equals(kind)) {
            return start.substring(5).equals("02-29")
                    ? leapYearsThrough(targetYear) - leapYearsThrough(startYear - 1)
                    : targetYear - startYear + 1L;
        }
        int day = Integer.parseInt(start.substring(8));
        int startMonth = Integer.parseInt(start.substring(5, 7));
        int targetMonth = Integer.parseInt(target.substring(5, 7));
        return monthsThrough(targetYear, targetMonth, day) - monthsThrough(startYear, startMonth - 1, day);
    }

    private static long leapYearsThrough(int year) { return year / 4 - year / 100 + year / 400; }

    private static long monthsThrough(int year, int month, int day) {
        int perYear = day <= 28 ? 12 : day == 31 ? 7 : 11;
        long total = (long) (year - 1) * perYear;
        if (day == 29) total += leapYearsThrough(year - 1);
        int[] lengths = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
        for (int index = 0; index < month; index++) {
            int length = lengths[index] + (index == 1 && leapYearsThrough(year) != leapYearsThrough(year - 1) ? 1 : 0);
            if (day <= length) total++;
        }
        return total;
    }

    static Map<String, JSONObject> dueAt(JSONObject pending, Map<String, JSONObject> expected, long triggerAt) throws Exception {
        Map<String, JSONObject> due = new LinkedHashMap<>();
        Iterator<String> keys = pending.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            JSONObject saved = pending.optJSONObject(key);
            JSONObject current = expected.get(key);
            if (saved != null && saved.optLong("triggerAt") == triggerAt && current != null && current.optLong("triggerAt") == triggerAt) due.put(key, current);
        }
        return due;
    }

    private static boolean isDaily(String kind) { return "daily".equals(kind) || "every_days".equals(kind); }
    private static boolean supported(String kind) { return "none".equals(kind) || isDaily(kind) || "weekly".equals(kind) || "monthly".equals(kind) || "yearly".equals(kind); }
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
