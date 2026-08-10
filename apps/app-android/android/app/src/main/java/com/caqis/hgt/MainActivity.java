package com.caqis.hgt;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidUpdatePlugin.class);
        registerPlugin(WebResourceProviderPlugin.class);
        super.onCreate(savedInstanceState);

        // Install hot-update WebView interceptor after bridge is ready
        getBridge().getWebView().setWebViewClient(new com.getcapacitor.WebViewLocalServer() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse bundleResponse = WebResourceProviderPlugin.serveBundleFile(
                    request.getUrl().getPath()
                );
                if (bundleResponse != null) return bundleResponse;
                return super.shouldInterceptRequest(view, request);
            }
        });
    }
}
