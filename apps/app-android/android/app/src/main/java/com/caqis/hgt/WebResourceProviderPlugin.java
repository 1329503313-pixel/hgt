package com.caqis.hgt;

import android.content.Context;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.IOException;
import java.nio.file.Files;

@CapacitorPlugin(name = "WebResourceProvider")
public class WebResourceProviderPlugin extends Plugin {

    private static String activeBundlePath = null;

    @PluginMethod
    public void getBundleStatus(PluginCall call) {
        JSObject result = new JSObject();
        result.put("active", activeBundlePath != null);
        result.put("path", activeBundlePath != null ? activeBundlePath : "");
        call.resolve(result);
    }

    @PluginMethod
    public void setActiveBundle(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("INVALID_PATH");
            return;
        }
        File bundleDir = new File(path);
        if (!bundleDir.isDirectory()) {
            call.reject("BUNDLE_NOT_FOUND");
            return;
        }
        File indexFile = new File(bundleDir, "index.html");
        if (!indexFile.isFile()) {
            call.reject("INDEX_NOT_FOUND");
            return;
        }
        activeBundlePath = bundleDir.getAbsolutePath();
        JSObject result = new JSObject();
        result.put("active", true);
        result.put("path", activeBundlePath);
        call.resolve(result);
    }

    @PluginMethod
    public void clearBundle(PluginCall call) {
        activeBundlePath = null;
        JSObject result = new JSObject();
        result.put("cleared", true);
        call.resolve(result);
    }

    /**
     * Called from MainActivity to install WebView interceptor.
     */
    public static String getActiveBundlePath() {
        return activeBundlePath;
    }

    /**
     * Attempt to serve a static resource from the active hot-update bundle.
     * Returns null if the file doesn't exist or no bundle is active.
     */
    public static WebResourceResponse serveBundleFile(String urlPath) {
        if (activeBundlePath == null) return null;

        // Strip query and hash, resolve to local file
        String path = urlPath;
        int queryIdx = path.indexOf('?');
        if (queryIdx >= 0) path = path.substring(0, queryIdx);
        int hashIdx = path.indexOf('#');
        if (hashIdx >= 0) path = path.substring(0, hashIdx);

        // Normalize: map empty or "/" to index.html
        if (path.isEmpty() || path.equals("/")) {
            path = "/index.html";
        }

        // Remove leading / for file resolution
        if (path.startsWith("/")) {
            path = path.substring(1);
        }

        File file = new File(activeBundlePath, path);
        if (!file.isFile()) return null;

        try {
            String mimeType = guessMimeType(path);
            return new WebResourceResponse(
                mimeType,
                "UTF-8",
                new FileInputStream(file)
            );
        } catch (IOException e) {
            return null;
        }
    }

    private static String guessMimeType(String path) {
        String lower = path.toLowerCase();
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        if (lower.endsWith(".ttf")) return "font/ttf";
        if (lower.endsWith(".mp3")) return "audio/mpeg";
        if (lower.endsWith(".mp4")) return "video/mp4";
        if (lower.endsWith(".webm")) return "video/webm";
        return "application/octet-stream";
    }
}
