package fun.upup.suitime;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import org.json.JSONObject;

public final class AppSettings {
    private AppSettings() {}

    public static String state(Context context) {
        JSONObject result = new JSONObject();
        try {
            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            NotificationChannel channel = Build.VERSION.SDK_INT >= 26 ? manager.getNotificationChannel(ReminderBridge.CHANNEL) : null;
            boolean notifications = NotificationManagerCompat.from(context).areNotificationsEnabled()
                    && (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED)
                    && (channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE);
            AlarmManager alarms = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            result.put("supported", true);
            result.put("notifications", notifications);
            result.put("exactAlarm", Build.VERSION.SDK_INT < 31 || alarms.canScheduleExactAlarms());
            result.put("install", Build.VERSION.SDK_INT < 26 || context.getPackageManager().canRequestPackageInstalls());
        } catch (Exception error) {
            try { result.put("error", error.getMessage()); } catch (Exception ignored) {}
        }
        return result.toString();
    }

    public static void open(Context context, String kind) {
        Intent intent;
        if ("alarm".equals(kind) && Build.VERSION.SDK_INT >= 31) intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
        else if ("install".equals(kind) && Build.VERSION.SDK_INT >= 26) intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
        else if ("notifications".equals(kind) && Build.VERSION.SDK_INT >= 26) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
        } else intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
        if (!Settings.ACTION_APP_NOTIFICATION_SETTINGS.equals(intent.getAction())) intent.setData(Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }
}
