package com.caqis.hgt;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import org.junit.Test;

public class AndroidUpdatePolicyTest {
    @Test
    public void acceptsOfficialOssApkUrl() {
        assertEquals(
            "https://zgkc-storage.kjcxchina.com/hgt/apps/hgt-1.0.1.apk",
            AndroidUpdatePolicy.requireAllowedApkUrl("https://zgkc-storage.kjcxchina.com/hgt/apps/hgt-1.0.1.apk").toString()
        );
    }

    @Test
    public void rejectsHttpAndForeignHosts() {
        assertThrows(IllegalArgumentException.class, () ->
            AndroidUpdatePolicy.requireAllowedApkUrl("http://zgkc-storage.kjcxchina.com/hgt/apps/hgt.apk"));
        assertThrows(IllegalArgumentException.class, () ->
            AndroidUpdatePolicy.requireAllowedApkUrl("https://example.com/hgt/apps/hgt.apk"));
    }

    @Test
    public void rejectsNonApkAndLookalikePaths() {
        assertThrows(IllegalArgumentException.class, () ->
            AndroidUpdatePolicy.requireAllowedApkUrl("https://zgkc-storage.kjcxchina.com/hgt/apps/readme.txt"));
        assertThrows(IllegalArgumentException.class, () ->
            AndroidUpdatePolicy.requireAllowedApkUrl("https://zgkc-storage.kjcxchina.com/hgt/apps-evil/hgt.apk"));
    }
}
