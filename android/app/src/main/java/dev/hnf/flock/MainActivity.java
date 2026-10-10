package dev.hnf.flock;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import androidx.webkit.WebViewAssetLoader;

import com.google.mlkit.vision.barcode.common.Barcode;
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions;
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning;

import org.json.JSONObject;

import java.util.Locale;

/**
 * Flock for Android: the Flock phone app (docs/app), packed into the APK and
 * shown full screen. It adds what a web page can't do well on its own: a QR
 * scanner for the pairing code, and session links that open in the Claude app.
 */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/assets/app/index.html";
    private static final int BG = 0xFF0B0C0E;

    private WebView web;
    private boolean loaded;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        // Draw behind the system bars and keep the page clear of them (and of
        // the keyboard) ourselves, the same way on every Android version.
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        web = new WebView(this);
        web.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        ViewCompat.setOnApplyWindowInsetsListener(root, (v, insets) -> {
            Insets pad = insets.getInsets(WindowInsetsCompat.Type.systemBars()
                    | WindowInsetsCompat.Type.displayCutout()
                    | WindowInsetsCompat.Type.ime());
            v.setPadding(pad.left, pad.top, pad.right, pad.bottom);
            return WindowInsetsCompat.CONSUMED;
        });
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), root);
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // the pairing is kept in the page's storage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);

        // The app's files are served from the APK under a secure https origin,
        // which the page's encryption (Web Crypto) needs.
        WebViewAssetLoader assets = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                return assets.shouldInterceptRequest(req.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if (HOST.equals(u.getHost())) return false;
                openOutside(u); // a session link: the Claude app, or else the browser
                return true;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                loaded = true;
            }
        });
        web.addJavascriptInterface(new Bridge(), "FlockAndroid");
        web.loadUrl(HOME + pairingFragment(getIntent()));
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String fragment = pairingFragment(intent);
        if (fragment.isEmpty()) return;
        if (loaded) call("flockScanned", intent.getData().toString());
        else web.loadUrl(HOME + fragment);
    }

    /** "#p=…" when the app was opened with a pairing link, else "". */
    private static String pairingFragment(Intent intent) {
        Uri data = intent == null ? null : intent.getData();
        String f = data == null ? null : data.getEncodedFragment();
        return f != null && f.startsWith("p=") ? "#" + f : "";
    }

    private void scan() {
        GmsBarcodeScannerOptions options = new GmsBarcodeScannerOptions.Builder()
                .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
                .build();
        GmsBarcodeScanning.getClient(this, options).startScan()
                .addOnSuccessListener(code -> call("flockScanned", code.getRawValue()))
                .addOnCanceledListener(() -> call("flockScanCancelled", null))
                .addOnFailureListener(e -> call("flockScanFailed", e.getMessage()));
    }

    /** Calls window.<fn>(arg) in the page, if the page defines it. */
    private void call(String fn, String arg) {
        String value = arg == null ? "null" : JSONObject.quote(arg);
        web.evaluateJavascript("window." + fn + " && window." + fn + "(" + value + ")", null);
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "No app on this phone can open " + u.getHost(), Toast.LENGTH_SHORT).show();
        }
    }

    private static String deviceName() {
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.trim();
        String model = Build.MODEL == null ? "" : Build.MODEL.trim();
        String name = model.toLowerCase(Locale.ROOT).startsWith(maker.toLowerCase(Locale.ROOT)) ? model : maker + " " + model;
        name = name.trim();
        if (name.isEmpty()) return "Android phone";
        return name.substring(0, 1).toUpperCase(Locale.ROOT) + name.substring(1);
    }

    /** What the page can ask of the app (window.FlockAndroid). */
    private class Bridge {
        @JavascriptInterface
        public void scan() {
            runOnUiThread(MainActivity.this::scan);
        }

        @JavascriptInterface
        public String version() {
            return BuildConfig.VERSION_NAME;
        }

        @JavascriptInterface
        public String device() {
            return deviceName();
        }
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) web.goBack(); // the page's own screens
        else super.onBackPressed();
    }

    @Override
    protected void onPause() {
        super.onPause();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
