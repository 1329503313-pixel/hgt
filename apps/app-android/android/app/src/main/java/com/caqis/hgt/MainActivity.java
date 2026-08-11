package com.caqis.hgt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidUpdatePlugin.class);
        registerPlugin(WebResourceProviderPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    public void onResume() {
        super.onResume();
        AndroidUpdateInstaller.openPendingInstaller(this);
    }
}
