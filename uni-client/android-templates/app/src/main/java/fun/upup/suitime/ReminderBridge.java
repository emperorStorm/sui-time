package fun.upup.suitime;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import io.dcloud.suitime.R;
import androidx.core.app.NotificationCompat;
import java.util.Iterator;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

public final class ReminderBridge {
    public static final String CHANNEL = "sui-time-task-reminders";
    private ReminderBridge() {}
    private static SharedPreferences preferences(Context context) { return context.getSharedPreferences("sui-time-reminders", Context.MODE_PRIVATE); }

    public static synchronized String replace(Context context, String snapshot) {
        try {
            new JSONArray(snapshot);
            if (!preferences(context).edit().putString("tasks", snapshot).commit()) throw new IllegalStateException("无法保存系统提醒快照");
            return reschedule(context);
        } catch (Exception error) { return failure(context, error); }
    }

    public static synchronized String reschedule(Context context) {
        try {
            createChannel(context);
            SharedPreferences prefs = preferences(context);
            JSONObject permissions = new JSONObject(AppSettings.state(context));
            JSONObject previous = new JSONObject(prefs.getString("pending", "{}"));
            JSONObject desired = new JSONObject();
            JSONArray unsupported = new JSONArray();
            if (permissions.optBoolean("notifications") && permissions.optBoolean("exactAlarm")) {
                Map<String, JSONObject> next = ReminderEngine.next(new JSONArray(prefs.getString("tasks", "[]")), System.currentTimeMillis(), unsupported);
                for (Map.Entry<String, JSONObject> entry : next.entrySet()) desired.put(entry.getKey(), entry.getValue());
            }
            StringBuilder warning = new StringBuilder();
            for (int index = 0; index < unsupported.length(); index++) {
                if (index > 0) warning.append("；");
                warning.append(unsupported.getString(index));
            }
            if (warning.length() > 0) warning.insert(0, "以下事项的重复规则暂不支持安卓提醒；其他支持的事项在权限允许时仍会排程：");
            AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            // 先记录待处理标识；即使进程在设置闹钟时退出，下次也能清理旧 PendingIntent。
            JSONObject known = new JSONObject(previous.toString());
            Iterator<String> newKeys = desired.keys();
            while (newKeys.hasNext()) { String key = newKeys.next(); known.put(key, desired.get(key)); }
            if (!prefs.edit().putString("pending", known.toString()).commit()) throw new IllegalStateException("无法保存待发提醒");
            Iterator<String> keys = desired.keys();
            while (keys.hasNext()) {
                String key = keys.next();
                JSONObject request = desired.getJSONObject(key);
                // 系统重启会丢失闹钟，因此恢复时也需重新设置稳定标识。
                PendingIntent alarm = alarm(context, key, request.getLong("triggerAt"));
                if (Build.VERSION.SDK_INT >= 23) manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, request.getLong("triggerAt"), alarm);
                else manager.setExact(AlarmManager.RTC_WAKEUP, request.getLong("triggerAt"), alarm);
            }
            Iterator<String> oldKeys = previous.keys();
            while (oldKeys.hasNext()) { String key = oldKeys.next(); if (!desired.has(key)) { PendingIntent alarm = alarm(context, key, 0); manager.cancel(alarm); alarm.cancel(); } }
            SharedPreferences.Editor cleanup = prefs.edit();
            for (String key : prefs.getAll().keySet()) {
                if (key.startsWith("delivered:") && !desired.has(key.substring(10))) cleanup.remove(key);
            }
            cleanup.apply();
            SharedPreferences.Editor result = prefs.edit().putString("pending", desired.toString());
            if (warning.length() > 0) {
                result.putString("error", warning.toString());
                permissions.put("error", warning.toString());
            } else result.remove("error");
            if (!result.commit()) throw new IllegalStateException("无法保存排程结果");
            permissions.put("scheduled", desired.length());
            return permissions.toString();
        } catch (Exception error) { return failure(context, error); }
    }

    public static synchronized void fire(Context context, String key, long triggerAt) {
        StringBuilder errors = new StringBuilder();
        try {
            SharedPreferences prefs = preferences(context);
            JSONObject pending = new JSONObject(prefs.getString("pending", "{}"));
            JSONObject request = pending.optJSONObject(key);
            // 过期广播不能触发重排，否则可能清掉同一时刻尚未处理的其他闹钟。
            if (request == null || request.optLong("triggerAt") != triggerAt) return;
            if (new JSONObject(AppSettings.state(context)).optBoolean("notifications")) {
                // 对同一时刻的每一项重新核对快照，过滤已删除或改期的旧闹钟。
                Map<String, JSONObject> expected = ReminderEngine.next(new JSONArray(prefs.getString("tasks", "[]")), triggerAt - 1);
                for (Map.Entry<String, JSONObject> entry : ReminderEngine.dueAt(pending, expected, triggerAt).entrySet()) {
                    String dueKey = entry.getKey();
                    if (prefs.getLong("delivered:" + dueKey, 0) == triggerAt) continue;
                    try {
                        if (!prefs.edit().putLong("delivered:" + dueKey, triggerAt).commit()) throw new IllegalStateException("无法记录提醒状态");
                        JSONObject current = entry.getValue();
                        notify(context, dueKey, current.getString("title"), current.getString("body"));
                    } catch (Exception error) {
                        if (errors.length() > 0) errors.append("；");
                        errors.append(dueKey).append("：").append(error.getMessage() == null ? error.toString() : error.getMessage());
                    }
                }
            }
        } catch (Exception error) { errors.append(error.getMessage() == null ? error.toString() : error.getMessage()); }
        String schedule = reschedule(context);
        if (errors.length() > 0) {
            try {
                String scheduleError = new JSONObject(schedule).optString("error", "");
                if (!scheduleError.isEmpty()) errors.append("；").append(scheduleError);
            } catch (Exception ignored) {}
            failure(context, new IllegalStateException(errors.toString()));
        }
    }

    public static String test(Context context) {
        try {
            createChannel(context);
            if (!new JSONObject(AppSettings.state(context)).optBoolean("notifications")) throw new IllegalStateException("请先允许系统通知，并开启事项提醒通知渠道");
            notify(context, "test", "岁岁时光通知测试", "通知已提交，横幅和声音受系统设置影响。");
            return "{}";
        } catch (Exception error) { return failure(context, error); }
    }

    private static PendingIntent alarm(Context context, String key, long triggerAt) {
        Intent intent = new Intent(context, ReminderReceiver.class).setAction("fun.upup.suitime.REMINDER")
                .setData(Uri.parse("suitime-reminder:" + Uri.encode(key))).putExtra("key", key).putExtra("triggerAt", triggerAt);
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = new NotificationChannel(CHANNEL, "事项提醒", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription("待办事项的准时和提前提醒");
            manager.createNotificationChannel(channel);
        }
    }

    private static void notify(Context context, String key, String title, String body) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) throw new IllegalStateException("无法打开应用通知入口");
        launch.setData(Uri.parse("suitime-notification:" + Uri.encode(key)));
        PendingIntent content = PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_reminder).setContentTitle(title).setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body)).setContentIntent(content)
                .setAutoCancel(true).setPriority(NotificationCompat.PRIORITY_HIGH).setDefaults(NotificationCompat.DEFAULT_ALL);
        ((NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE)).notify(key, 0, builder.build());
    }

    private static String failure(Context context, Exception error) {
        String message = error.getMessage() == null ? error.toString() : error.getMessage();
        preferences(context).edit().putString("error", message).apply();
        JSONObject result = new JSONObject();
        try { result.put("supported", true).put("error", message); } catch (Exception ignored) {}
        return result.toString();
    }
}
