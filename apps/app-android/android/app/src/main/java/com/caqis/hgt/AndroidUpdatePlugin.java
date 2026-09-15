package com.caqis.hgt;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Environment;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "AndroidUpdate")
public class AndroidUpdatePlugin extends Plugin {
    private String allowedUrl(PluginCall call) {
        return AndroidUpdatePolicy.requireAllowedApkUrl(call.getString("url")).toString();
    }

    @PluginMethod
    public void getDownloadStatus(PluginCall call) {
        try {
            call.resolve(AndroidUpdateDownload.status(getContext(), allowedUrl(call)));
        } catch (RuntimeException error) {
            call.reject("无法读取系统下载状态，请稍后重试", "DOWNLOAD_STATUS_UNAVAILABLE", error);
        }
    }

    @PluginMethod
    public synchronized void downloadAndInstall(PluginCall call) {
        try {
            String url = allowedUrl(call);
            Context context = getContext();
            JSObject existing = AndroidUpdateDownload.status(context, url);
            String status = existing.getString("status");
            // Repeated taps / process restarts reuse the task and completed APK.
            if (!"none".equals(status) && !"failed".equals(status)) {
                call.resolve(existing);
                return;
            }
            File downloads = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
            if (downloads == null) throw new IllegalStateException("DOWNLOAD_DIRECTORY_UNAVAILABLE");
            DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
            if (manager == null) throw new IllegalStateException("DOWNLOAD_SERVICE_UNAVAILABLE");
            SharedPreferences prefs = AndroidUpdateDownload.preferences(context);
            long oldId = prefs.getLong(AndroidUpdateDownload.DOWNLOAD_ID, -1L);
            if (oldId >= 0) manager.remove(oldId);
            prefs.edit().clear().apply();

            String fileName = "hgt-update-" + System.currentTimeMillis() + ".apk";
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url))
                .setTitle("汤物语更新")
                .setDescription("下载完成后请返回汤物语，点击安装更新")
                .setMimeType("application/vnd.android.package-archive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setAllowedOverMetered(true)
                .setAllowedOverRoaming(false)
                .setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
            long id = manager.enqueue(request);
            prefs.edit()
                .putLong(AndroidUpdateDownload.DOWNLOAD_ID, id)
                .putString(AndroidUpdateDownload.DOWNLOAD_PATH, new File(downloads, fileName).getAbsolutePath())
                .putString(AndroidUpdateDownload.DOWNLOAD_URL, url)
                .apply();
            JSObject result = new JSObject();
            result.put("downloadId", Long.toString(id));
            result.put("status", "pending");
            call.resolve(result);
        } catch (RuntimeException error) {
            call.reject("无法启动下载，请确认系统下载管理器已启用并检查存储空间", "DOWNLOAD_START_FAILED", error);
        }
    }

    @PluginMethod
    public void installDownloaded(PluginCall call) {
        // External activities are launched by the user's foreground action on the UI thread.
        getActivity().runOnUiThread(() -> {
            try {
                String url = allowedUrl(call);
                if (!"ready".equals(AndroidUpdateDownload.status(getContext(), url).getString("status"))) {
                    call.reject("安装包尚未下载完成，请重新检查下载状态", "APK_NOT_READY");
                    return;
                }
                if (!AndroidUpdateInstaller.canInstallPackages(getActivity())) {
                    AndroidUpdateInstaller.openInstallPermissionSettings(getActivity());
                    call.reject("请允许汤物语安装未知应用，返回后点击安装更新", "INSTALL_PERMISSION_REQUIRED");
                    return;
                }
                String path = AndroidUpdateDownload.preferences(getContext()).getString(AndroidUpdateDownload.DOWNLOAD_PATH, "");
                if (!AndroidUpdateInstaller.openInstaller(getActivity(), new File(path))) {
                    call.reject("安装包已被清理，请重新下载", "APK_NOT_READY");
                    return;
                }
                // A successful startActivity is not proof of installation. Retain the APK
                // for OEM blocking, cancellation, and permission round trips.
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("未能打开系统安装页，请检查安装未知应用权限后重试", "INSTALLER_UNAVAILABLE", error);
            }
        });
    }
}
