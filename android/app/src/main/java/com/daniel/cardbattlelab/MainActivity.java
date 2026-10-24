package com.daniel.cardbattlelab;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

/**
 * WebView wrapper for the site; the Chrome extension's overlay is the same script, evaluated
 * in each loaded page.
 */
public final class MainActivity extends Activity {
    private static final String HOME = "https://cardbattlelab.com/play/";
    /** Height of the strip above the page's controls when the camera cutout is at the top. */
    private static final int TOP_GAP_DP = 24;
    private WebView web;
    private String overlay;
    private long lastBack;

    @SuppressLint("SetJavaScriptEnabled")
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        overlay = loadAsset("overlay/overlay.js");
        web = new WebView(this);
        FrameLayout root = new FrameLayout(this);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        // Target SDK 35 draws edge-to-edge. WebView paints over its own padding, so pad the
        // container instead, then pass the handled insets on zeroed rather than consumed, so
        // WebView keeps receiving updates. The status bar is hidden; a top camera cutout gets a
        // TOP_GAP_DP strip, not its full height. WebView 144+ hands that strip to the page as its
        // safe-area top, which the site keeps its controls below while its background fills it.
        if (Build.VERSION.SDK_INT >= 35) {
            boolean pageSafeArea = webViewMajorVersion() >= 144;
            root.setOnApplyWindowInsetsListener((view, insets) -> {
                int types = WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime();
                Insets bars = insets.getInsets(types);
                int top = Math.min(bars.top, Math.round(TOP_GAP_DP * getResources().getDisplayMetrics().density));
                view.setPadding(bars.left, pageSafeArea ? 0 : top, bars.right, bars.bottom);
                WindowInsets.Builder page = new WindowInsets.Builder(insets).setInsets(types, Insets.NONE);
                if (pageSafeArea) page.setInsets(WindowInsets.Type.statusBars(), Insets.of(0, top, 0, 0));
                return page.build();
            });
        }
        hideStatusBar();
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri uri = request.getUrl();
                if (isInAppUrl(uri)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); }
                catch (ActivityNotFoundException error) {
                    Toast.makeText(MainActivity.this, R.string.no_link_handler, Toast.LENGTH_SHORT).show();
                }
                return true;
            }

            @Override public void onPageFinished(WebView view, String url) {
                // The script is idempotent and waits for the board itself.
                if (overlay != null && url != null && isSiteUrl(Uri.parse(url))) view.evaluateJavascript(overlay, null);
            }
        });
        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            Uri uri = getIntent().getData();
            web.loadUrl(uri != null && isSiteUrl(uri) ? uri.toString() : HOME);
        }
    }

    private static boolean isSiteUrl(Uri uri) {
        return "https".equalsIgnoreCase(uri.getScheme())
                && ("cardbattlelab.com".equalsIgnoreCase(uri.getHost())
                || "www.cardbattlelab.com".equalsIgnoreCase(uri.getHost()));
    }

    private static boolean isInAppUrl(Uri uri) {
        if (isSiteUrl(uri)) return true;
        String host = uri.getHost();
        // Keep Patreon login in this cookie session so its callback returns to this WebView.
        return "https".equalsIgnoreCase(uri.getScheme()) && host != null
                && ("patreon.com".equals(host.toLowerCase(Locale.ROOT))
                || "www.patreon.com".equals(host.toLowerCase(Locale.ROOT)));
    }

    /** A bundled text asset, or null when the build has none. */
    private String loadAsset(String name) {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(getAssets().open(name), StandardCharsets.UTF_8))) {
            StringBuilder text = new StringBuilder();
            char[] buffer = new char[8192];
            for (int n; (n = reader.read(buffer)) > 0; ) text.append(buffer, 0, n);
            return text.toString();
        } catch (IOException missing) {
            return null;
        }
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri uri = intent.getData();
        if (uri != null && isSiteUrl(uri)) web.loadUrl(uri.toString());
    }

    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() {
        if (web.canGoBack()) { web.goBack(); return; }
        long now = android.os.SystemClock.elapsedRealtime();
        if (now - lastBack < 2000) { finish(); return; }
        lastBack = now;
        Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
    }

    @Override protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        web.saveState(state);
    }

    /**
     * Gives the status bar's height to the page. A swipe from the top shows the bar over the
     * page for a moment.
     */
    private void hideStatusBar() {
        if (Build.VERSION.SDK_INT < 30) return;
        WindowInsetsController bars = getWindow().getInsetsController();
        if (bars == null) return;
        bars.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        bars.hide(WindowInsets.Type.statusBars());
    }

    /** The major version of the installed WebView, or 0 when it is unknown. */
    private static int webViewMajorVersion() {
        android.content.pm.PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info == null || info.versionName == null) return 0;
        try { return Integer.parseInt(info.versionName.split("\\.", 2)[0]); }
        catch (NumberFormatException unknown) { return 0; }
    }

    @Override public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideStatusBar(); // Dialogs and other apps can bring the bar back.
    }

    @Override protected void onPause() { web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); web.onResume(); }
    @Override protected void onDestroy() { web.destroy(); super.onDestroy(); }
}
