package com.caqis.hgt;

import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.IOException;

@CapacitorPlugin(name = "WechatShare")
public class WechatSharePlugin extends Plugin {
    private static final String WECHAT_PACKAGE = "com.tencent.mm";

    @PluginMethod
    public void shareImage(PluginCall call) {
        String rawUri = call.getString("uri");
        if (rawUri == null || rawUri.trim().isEmpty()) {
            call.reject("分享图片无效");
            return;
        }

        try {
            File image = requireCachedFile(Uri.parse(rawUri));
            Uri contentUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                image
            );
            Intent intent = new Intent(Intent.ACTION_SEND)
                .setType("image/png")
                .setPackage(WECHAT_PACKAGE)
                .putExtra(Intent.EXTRA_STREAM, contentUri)
                .putExtra(Intent.EXTRA_SUBJECT, call.getString("title", "游戏房间邀请"))
                .putExtra(Intent.EXTRA_TEXT, call.getString("text", ""));
            intent.setClipData(ClipData.newRawUri("游戏房间邀请", contentUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(intent);
            call.resolve();
        } catch (ActivityNotFoundException | SecurityException error) {
            call.reject("未检测到微信，无法直接分享");
        } catch (IllegalArgumentException | IOException error) {
            call.reject("分享图片无效");
        }
    }

    private File requireCachedFile(Uri uri) throws IOException {
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) {
            throw new IllegalArgumentException("Unsupported share URI");
        }
        File cacheDirectory = getContext().getCacheDir().getCanonicalFile();
        File image = new File(uri.getPath()).getCanonicalFile();
        String cachePrefix = cacheDirectory.getPath() + File.separator;
        if (!image.isFile() || !image.getPath().startsWith(cachePrefix)) {
            throw new IllegalArgumentException("Share file must be inside app cache");
        }
        return image;
    }
}
