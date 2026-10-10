package fun.upup.suitime;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class ReminderReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        final PendingResult pending = goAsync();
        final Context app = context.getApplicationContext();
        // 短任务线程随广播结束退出，不创建常驻服务。
        new Thread(() -> {
            try {
                if ("fun.upup.suitime.REMINDER".equals(intent.getAction())) {
                    ReminderBridge.fire(app, intent.getStringExtra("key"), intent.getLongExtra("triggerAt", 0));
                } else ReminderBridge.reschedule(app);
            } finally { pending.finish(); }
        }, "sui-time-reminder").start();
    }
}
