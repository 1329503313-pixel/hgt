package com.caqis.hgt;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(AndroidUpdatePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
