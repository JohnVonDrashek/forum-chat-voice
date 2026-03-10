package net.forumline.app

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class ForumlineApplication : Application() {
    override fun onCreate() {
        super.onCreate()

        val channel = NotificationChannel(
            CHANNEL_ID,
            "Forumline",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Forumline notifications"
        }
        getSystemService(NotificationManager::class.java)
            .createNotificationChannel(channel)
    }

    companion object {
        const val CHANNEL_ID = "forumline_default"
    }
}
