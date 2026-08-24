package com.caqis.hgt;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.net.URI;

@CapacitorPlugin(name = "AndroidUpdate")
public class AndroidUpdatePlugin extends Plugin {
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        URI validated;
        try {
            validated = AndroidUpdatePolicy.requireAllowedApkUrl(call.getString("url"));
        } catch (IllegalArgumentException error) {
            call.reject("APK_URL_NOT_ALLOWED", "APK_URL_NOT_ALLOWED");
            return;
        }

        Context context = getContext();
        if (!AndroidUpdateInstaller.canInstallPackages(context)) {
            AndroidUpdateInstaller.openInstallPermissionSettings(context);
            call.reject("INSTALL_PERMISSION_REQUIRED", "INSTALL_PERMISSION_REQUIRED");
            return;
        }

        File downloads = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (downloads == null) {
            call.reject("DOWNLOAD_DIRECTORY_UNAVAILABLE", "DOWNLOAD_DIRECTORY_UNAVAILABLE");
            return;
        }
        String fileName = "hgt-update-" + System.currentTimeMillis() + ".apk";
        File destination = new File(downloads, fileName);
        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(validated.toString()))
            .setTitle("汤物语更新")
            .setDescription("新版 APK 下载中")
            .setMimeType("application/vnd.android.package-archive")
            .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
            .setAllowedOverMetered(true)
            .setAllowedOverRoaming(false)
            .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        long downloadId = manager.enqueue(request);
        context.getSharedPreferences(ApkDownloadReceiver.PREFERENCES, Context.MODE_PRIVATE)
            .edit()
            .putLong(ApkDownloadReceiver.DOWNLOAD_ID, downloadId)
            .putString(ApkDownloadReceiver.DOWNLOAD_PATH, destination.getAbsolutePath())
            .apply();

        JSObject result = new JSObject();
        result.put("downloadId", Long.toString(downloadId));
        call.resolve(result);
    }
}
