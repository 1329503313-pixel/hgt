package com.caqis.hgt;

import java.net.URI;

final class AndroidUpdatePolicy {
    static final String ALLOWED_HOST = "zgkc-storage.kjcxchina.com";
    static final String ALLOWED_PATH_PREFIX = "/hgt/apps/";

    private AndroidUpdatePolicy() {}

    static URI requireAllowedApkUrl(String rawUrl) {
        try {
            URI uri = URI.create(rawUrl == null ? "" : rawUrl.trim());
            String path = uri.getRawPath();
            boolean valid = "https".equalsIgnoreCase(uri.getScheme())
                && ALLOWED_HOST.equalsIgnoreCase(uri.getHost())
                && uri.getUserInfo() == null
                && uri.getFragment() == null
                && path != null
                && path.startsWith(ALLOWED_PATH_PREFIX)
                && path.toLowerCase().endsWith(".apk");
            if (!valid) throw new IllegalArgumentException("APK_URL_NOT_ALLOWED");
            return uri;
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("APK_URL_NOT_ALLOWED", error);
        }
    }
}
