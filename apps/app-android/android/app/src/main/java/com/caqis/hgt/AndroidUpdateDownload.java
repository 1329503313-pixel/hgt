package com.caqis.hgt;

import android.app.DownloadManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import com.getcapacitor.JSObject;
import java.io.File;

final class AndroidUpdateDownload {
    static final String PREFERENCES = "hgt_android_update";
    static final String DOWNLOAD_ID = "download_id";
    static final String DOWNLOAD_PATH = "download_path";
    static final String DOWNLOAD_URL = "download_url";

    private AndroidUpdateDownload() {}

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static JSObject status(Context context, String url) {
        SharedPreferences prefs = preferences(context);
        JSObject result = new JSObject();
        result.put("status", "none");
        long id = prefs.getLong(DOWNLOAD_ID, -1L);
        if (id < 0 || !url.equals(prefs.getString(DOWNLOAD_URL, ""))) return result;
        result.put("downloadId", Long.toString(id));
        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) throw new IllegalStateException("DOWNLOAD_SERVICE_UNAVAILABLE");
        try (Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id))) {
            if (cursor == null || !cursor.moveToFirst()) {
                result.put("status", "failed");
                result.put("message", "下载任务已丢失，请重新下载");
                return result;
            }
            int status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            int reason = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_REASON));
            result.put("received", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_BYTES_DOWNLOADED_SO_FAR)));
            result.put("total", cursor.getLong(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_TOTAL_SIZE_BYTES)));
            result.put("reason", reason);
            switch (status) {
                case DownloadManager.STATUS_SUCCESSFUL:
                    File apk = new File(prefs.getString(DOWNLOAD_PATH, ""));
                    boolean exists = apk.isFile() && apk.length() > 0;
                    result.put("status", exists ? "ready" : "failed");
                    if (!exists) result.put("message", "安装包已被清理，请重新下载");
                    break;
                case DownloadManager.STATUS_FAILED:
                    result.put("status", "failed");
                    result.put("message", reason == DownloadManager.ERROR_INSUFFICIENT_SPACE
                        ? "存储空间不足，请清理空间后重试"
                        : "下载失败（代码 " + reason + "），请检查网络后重试");
                    break;
                case DownloadManager.STATUS_PAUSED:
                    result.put("status", "paused");
                    result.put("message", reason == DownloadManager.PAUSED_QUEUED_FOR_WIFI
                        ? "系统正在等待 Wi-Fi，请连接 Wi-Fi 后继续"
                        : "下载已暂停，正在等待网络或系统重试");
                    break;
                case DownloadManager.STATUS_RUNNING:
                    result.put("status", "downloading");
                    break;
                default:
                    result.put("status", "pending");
                    result.put("message", "等待系统开始下载");
            }
        }
        return result;
    }
}
