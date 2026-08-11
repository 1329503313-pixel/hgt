package com.caqis.hgt;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import java.io.File;

final class AndroidUpdateInstaller {
    private AndroidUpdateInstaller() {}

    static boolean canInstallPackages(Context context) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || context.getPackageManager().canRequestPackageInstalls();
    }

    static void openInstallPermissionSettings(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + context.getPackageName()));
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(intent);
    }

    static boolean openInstaller(Context context, File apk) {
        if (!apk.isFile() || apk.length() <= 0) return false;
        Uri contentUri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", apk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(contentUri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        context.startActivity(intent);
        return true;
    }

    static boolean openPendingInstaller(Context context) {
        if (!canInstallPackages(context)) return false;

        long downloadId = context.getSharedPreferences(ApkDownloadReceiver.PREFERENCES, Context.MODE_PRIVATE)
            .getLong(ApkDownloadReceiver.DOWNLOAD_ID, -1L);
        if (!ApkDownloadReceiver.downloadSucceeded(context, downloadId)) return false;

        String path = context.getSharedPreferences(ApkDownloadReceiver.PREFERENCES, Context.MODE_PRIVATE)
            .getString(ApkDownloadReceiver.DOWNLOAD_PATH, "");
        if (path.isEmpty()) return false;

        File apk = new File(path);
        if (!apk.isFile() || apk.length() <= 0) {
            ApkDownloadReceiver.clearPendingDownload(context);
            return false;
        }

        if (!openInstaller(context, apk)) return false;
        ApkDownloadReceiver.clearPendingDownload(context);
        return true;
    }
}
