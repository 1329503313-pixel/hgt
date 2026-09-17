package com.caqis.hgt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onPause() {
        if (getBridge() != null && getBridge().getWebView() != null) {
            getBridge().getWebView().evaluateJavascript("window.dispatchEvent(new Event('hgt-native-background'))", null);
        }
        super.onPause();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidUpdatePlugin.class);
        registerPlugin(WebResourceProviderPlugin.class);
        registerPlugin(WechatSharePlugin.class);
        super.onCreate(savedInstanceState);
    }

}
