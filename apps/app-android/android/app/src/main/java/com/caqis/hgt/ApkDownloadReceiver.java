package com.caqis.hgt;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import java.io.File;

public class ApkDownloadReceiver extends BroadcastReceiver {
    static final String PREFERENCES = "hgt_android_update";
    static final String DOWNLOAD_ID = "download_id";
    static final String DOWNLOAD_PATH = "download_path";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) return;
        long completedId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (completedId < 0 || completedId != preferences.getLong(DOWNLOAD_ID, -2L)) return;
        String path = preferences.getString(DOWNLOAD_PATH, "");
        preferences.edit().clear().apply();
        if (!AndroidUpdateInstaller.canInstallPackages(context)) {
            AndroidUpdateInstaller.openInstallPermissionSettings(context);
            return;
        }
        AndroidUpdateInstaller.openInstaller(context, new File(path));
    }
}
