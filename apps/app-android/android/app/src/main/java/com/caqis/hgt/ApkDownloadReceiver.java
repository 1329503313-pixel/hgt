package com.caqis.hgt;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;

public class ApkDownloadReceiver extends BroadcastReceiver {
    static final String PREFERENCES = "hgt_android_update";
    static final String DOWNLOAD_ID = "download_id";
    static final String DOWNLOAD_PATH = "download_path";

    static void clearPendingDownload(Context context) {
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().apply();
    }

    static boolean downloadSucceeded(Context context, long downloadId) {
        if (downloadId < 0) return false;
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return false;
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(downloadId))) {
            if (!cursor.moveToFirst()) return false;
            int statusColumn = cursor.getColumnIndex(DownloadManager.COLUMN_STATUS);
            return statusColumn >= 0 && cursor.getInt(statusColumn) == DownloadManager.STATUS_SUCCESSFUL;
        } catch (RuntimeException error) {
            return false;
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (completedId < 0 || completedId != preferences.getLong(DOWNLOAD_ID, -2L)) return;
        if (!downloadSucceeded(context, completedId)) {
            clearPendingDownload(context);
            return;
        }
        if (!AndroidUpdateInstaller.canInstallPackages(context)) {
            AndroidUpdateInstaller.openInstallPermissionSettings(context);
            return;
        }
        AndroidUpdateInstaller.openPendingInstaller(context);
    }
}
