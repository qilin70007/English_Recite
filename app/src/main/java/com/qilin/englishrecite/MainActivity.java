package com.qilin.englishrecite;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Context;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import org.json.JSONObject;

import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int FILE_CHOOSER_REQUEST = 501;
    private static final int SAVE_JSON_REQUEST = 502;
    private static final String GOOGLE_TTS_PACKAGE = "com.google.android.tts";
    private static final String SYSTEM_DEFAULT_ENGINE = "";
    private static final long TTS_INIT_TIMEOUT_MS = 8000L;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final List<String> ttsEngineCandidates = new ArrayList<>();
    private TextToSpeech textToSpeech;
    private boolean ttsReady;
    private boolean ttsInitializing;
    private boolean ttsInitFailed;
    private int ttsEngineIndex = -1;
    private int ttsGeneration;
    private String activeTtsEngine = "";
    private PendingSpeech pendingSpeech;
    private String activeRequestId;
    private String finalUtteranceId;
    private AudioManager audioManager;
    private boolean ttsAudioFocus;
    private final AudioManager.OnAudioFocusChangeListener ttsFocusListener = focusChange -> {
        // Android handles ducking/pausing of other media; speech continues on the media stream.
    };
    private String pendingJsonContent;

    private static final class PendingSpeech {
        final String text;
        final float rate;
        final int repeat;
        final String requestId;

        PendingSpeech(String text, float rate, int repeat, String requestId) {
            this.text = text;
            this.rate = rate;
            this.repeat = repeat;
            this.requestId = requestId;
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(49, 94, 85));
        setContentView(R.layout.activity_main);
        initializePreferredTts();
        configureWebView(savedInstanceState);
    }

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    private void configureWebView(Bundle savedInstanceState) {
        webView = findViewById(R.id.web_view);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);

        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assetLoader.shouldInterceptRequest(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                return assetLoader.shouldInterceptRequest(Uri.parse(url));
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return request.isForMainFrame() && openExternalUrlIfNeeded(request.getUrl());
            }

            @Override
            @SuppressWarnings("deprecation")
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternalUrlIfNeeded(Uri.parse(url));
            }

            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                ViewGroup parent = (ViewGroup) view.getParent();
                if (parent != null) parent.removeView(view);
                view.destroy();
                recreate();
                return true;
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(
                    WebView view,
                    ValueCallback<Uri[]> callback,
                    FileChooserParams params
            ) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    startActivityForResult(params.createIntent(), FILE_CHOOSER_REQUEST);
                    return true;
                } catch (ActivityNotFoundException error) {
                    filePathCallback = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });

        webView.addJavascriptInterface(new AndroidTtsBridge(), "AndroidTts");
        webView.addJavascriptInterface(new AndroidFilesBridge(), "AndroidFiles");
        webView.requestFocusFromTouch();

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(APP_URL);
        }
    }

    private boolean openExternalUrlIfNeeded(Uri uri) {
        if (uri == null) return false;
        if ("appassets.androidplatform.net".equalsIgnoreCase(uri.getHost())) return false;
        String scheme = uri.getScheme();
        if (!"http".equalsIgnoreCase(scheme) && !"https".equalsIgnoreCase(scheme)) return false;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
            return false;
        }
        return true;
    }

    @SuppressWarnings("deprecation")
    private List<String> installedTtsPackages() {
        Set<String> packageNames = new LinkedHashSet<>();
        try {
            Intent serviceIntent = new Intent(TextToSpeech.Engine.INTENT_ACTION_TTS_SERVICE);
            List<ResolveInfo> services = getPackageManager().queryIntentServices(
                    serviceIntent,
                    PackageManager.GET_META_DATA
            );
            for (ResolveInfo service : services) {
                if (service.serviceInfo != null && service.serviceInfo.packageName != null) {
                    packageNames.add(service.serviceInfo.packageName);
                }
            }
        } catch (RuntimeException ignored) {
            // The system default engine is still tried below.
        }
        return new ArrayList<>(packageNames);
    }

    private boolean isIflytekEngine(String packageName) {
        String label = "";
        try {
            label = String.valueOf(getPackageManager().getApplicationLabel(
                    getPackageManager().getApplicationInfo(packageName, 0)
            ));
        } catch (Exception ignored) {
            // Package name matching below is enough when a label cannot be read.
        }
        String identity = (packageName + " " + label).toLowerCase(Locale.ROOT);
        return identity.contains("iflytek") || identity.contains("speechcloud") || identity.contains("讯飞");
    }

    private synchronized void initializePreferredTts() {
        if (ttsInitializing) return;

        List<String> installedPackages = installedTtsPackages();
        ttsEngineCandidates.clear();
        if (installedPackages.contains(GOOGLE_TTS_PACKAGE)) {
            ttsEngineCandidates.add(GOOGLE_TTS_PACKAGE);
        }

        List<String> iflytekPackages = new ArrayList<>();
        List<String> otherPackages = new ArrayList<>();
        for (String packageName : installedPackages) {
            if (GOOGLE_TTS_PACKAGE.equals(packageName)) continue;
            if (isIflytekEngine(packageName)) {
                iflytekPackages.add(packageName);
            } else {
                otherPackages.add(packageName);
            }
        }
        Collections.sort(iflytekPackages);
        Collections.sort(otherPackages);
        ttsEngineCandidates.addAll(iflytekPackages);
        ttsEngineCandidates.addAll(otherPackages);
        ttsEngineCandidates.add(SYSTEM_DEFAULT_ENGINE);

        ttsEngineIndex = -1;
        ttsInitFailed = false;
        startTtsCandidate(0);
    }

    private synchronized void startTtsCandidate(int candidateIndex) {
        if (candidateIndex >= ttsEngineCandidates.size()) {
            PendingSpeech failedSpeech = pendingSpeech;
            pendingSpeech = null;
            ttsReady = false;
            ttsInitializing = false;
            ttsInitFailed = true;
            activeTtsEngine = "";
            if (failedSpeech != null) {
                dispatchTtsEvent("native-tts-error", failedSpeech.requestId);
            }
            return;
        }

        ttsEngineIndex = candidateIndex;
        ttsReady = false;
        ttsInitializing = true;
        ttsInitFailed = false;
        activeTtsEngine = "";
        final int generation = ++ttsGeneration;
        final String requestedEngine = ttsEngineCandidates.get(candidateIndex);

        runOnUiThread(() -> {
            TextToSpeech previous;
            synchronized (MainActivity.this) {
                previous = textToSpeech;
                textToSpeech = null;
            }
            if (previous != null) previous.shutdown();

            TextToSpeech.OnInitListener listener = status ->
                    onTtsInitialized(generation, requestedEngine, status);
            TextToSpeech created = requestedEngine.isEmpty()
                    ? new TextToSpeech(this, listener)
                    : new TextToSpeech(this, listener, requestedEngine);

            synchronized (MainActivity.this) {
                if (generation != ttsGeneration) {
                    created.shutdown();
                    return;
                }
                textToSpeech = created;
            }
            mainHandler.postDelayed(() -> onTtsInitTimeout(generation), TTS_INIT_TIMEOUT_MS);
        });
    }

    private void onTtsInitTimeout(int generation) {
        int nextCandidate;
        synchronized (this) {
            if (generation != ttsGeneration || !ttsInitializing) return;
            ttsInitializing = false;
            ttsReady = false;
            nextCandidate = ttsEngineIndex + 1;
        }
        startTtsCandidate(nextCandidate);
    }

    private void onTtsInitialized(int generation, String requestedEngine, int status) {
        PendingSpeech queuedSpeech = null;
        int nextCandidate = -1;

        synchronized (this) {
            if (generation != ttsGeneration) return;
            ttsInitializing = false;
            if (status == TextToSpeech.SUCCESS && textToSpeech != null) {
                ttsReady = true;
                ttsInitFailed = false;
                activeTtsEngine = requestedEngine.isEmpty()
                        ? currentEnginePackage()
                        : requestedEngine;
                configureTtsEngine(textToSpeech, generation);
                queuedSpeech = pendingSpeech;
                pendingSpeech = null;
            } else {
                ttsReady = false;
                nextCandidate = ttsEngineIndex + 1;
            }
        }

        if (nextCandidate >= 0) {
            startTtsCandidate(nextCandidate);
        } else if (queuedSpeech != null) {
            speakNow(queuedSpeech);
        }
    }

    private synchronized String currentEnginePackage() {
        if (textToSpeech == null) return "";
        try {
            String engine = textToSpeech.getDefaultEngine();
            return engine == null ? "" : engine;
        } catch (RuntimeException ignored) {
            return "";
        }
    }

    private void configureTtsEngine(TextToSpeech engine, int generation) {
        engine.setAudioAttributes(new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_MEDIA)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build());
        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                // No UI update is needed here; JavaScript already marks the button as playing.
            }

            @Override
            public void onDone(String utteranceId) {
                String finishedRequest = null;
                synchronized (MainActivity.this) {
                    if (generation != ttsGeneration
                            || utteranceId == null
                            || !utteranceId.equals(finalUtteranceId)) return;
                    finishedRequest = activeRequestId;
                    activeRequestId = null;
                    finalUtteranceId = null;
                }
                releaseSpeechAudioFocus();
                dispatchTtsEvent("native-tts-done", finishedRequest);
            }

            @Override
            public void onError(String utteranceId) {
                handleUtteranceError(generation, utteranceId);
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                handleUtteranceError(generation, utteranceId);
            }
        });
    }

    private void handleUtteranceError(int generation, String utteranceId) {
        if (utteranceId != null && utteranceId.endsWith("-warmup")) return;
        String failedRequest;
        synchronized (this) {
            if (generation != ttsGeneration || activeRequestId == null) return;
            failedRequest = activeRequestId;
            activeRequestId = null;
            finalUtteranceId = null;
        }
        releaseSpeechAudioFocus();
        dispatchTtsEvent("native-tts-error", failedRequest);
    }

    private void queueSpeech(String text, float rate, int repeat, String requestId) {
        PendingSpeech speech = new PendingSpeech(text, rate, repeat, requestId);
        synchronized (this) {
            if (!ttsReady || textToSpeech == null) {
                pendingSpeech = speech;
                if (ttsInitFailed && !ttsInitializing) initializePreferredTts();
                return;
            }
        }
        speakNow(speech);
    }

    private void speakNow(PendingSpeech speech) {
        TextToSpeech engine;
        synchronized (this) {
            if (!ttsReady || textToSpeech == null) {
                pendingSpeech = speech;
                return;
            }
            engine = textToSpeech;
        }

        int languageStatus = engine.setLanguage(Locale.US);
        if (isLanguageUnavailable(languageStatus)) {
            languageStatus = engine.setLanguage(Locale.ENGLISH);
        }
        if (isLanguageUnavailable(languageStatus)) {
            tryNextTtsEngine(speech);
            return;
        }

        engine.stop();
        engine.setSpeechRate(Math.max(0.5f, Math.min(2f, speech.rate)));
        requestSpeechAudioFocus();

        int safeRepeat = Math.max(1, Math.min(3, speech.repeat));
        synchronized (this) {
            activeRequestId = speech.requestId;
            finalUtteranceId = speech.requestId + "-final";
        }

        Bundle parameters = new Bundle();
        parameters.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
        parameters.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
        engine.playSilentUtterance(
                120,
                TextToSpeech.QUEUE_FLUSH,
                speech.requestId + "-warmup"
        );

        for (int index = 0; index < safeRepeat; index += 1) {
            String utteranceId = index == safeRepeat - 1
                    ? finalUtteranceId
                    : speech.requestId + "-part-" + index;
            int speakStatus = engine.speak(
                    speech.text,
                    TextToSpeech.QUEUE_ADD,
                    parameters,
                    utteranceId
            );
            if (speakStatus != TextToSpeech.SUCCESS) {
                engine.stop();
                releaseSpeechAudioFocus();
                tryNextTtsEngine(speech);
                return;
            }
        }
    }

    private boolean isLanguageUnavailable(int languageStatus) {
        return languageStatus == TextToSpeech.LANG_MISSING_DATA
                || languageStatus == TextToSpeech.LANG_NOT_SUPPORTED;
    }

    private void tryNextTtsEngine(PendingSpeech speech) {
        int nextCandidate;
        synchronized (this) {
            activeRequestId = null;
            finalUtteranceId = null;
            pendingSpeech = speech;
            nextCandidate = ttsEngineIndex + 1;
            if (nextCandidate < ttsEngineCandidates.size()) {
                startTtsCandidate(nextCandidate);
                return;
            }
            pendingSpeech = null;
            ttsReady = false;
            ttsInitializing = false;
            ttsInitFailed = true;
            activeTtsEngine = "";
        }
        releaseSpeechAudioFocus();
        dispatchTtsEvent("native-tts-error", speech.requestId);
    }

    @SuppressWarnings("deprecation")
    private void requestSpeechAudioFocus() {
        if (audioManager == null) {
            audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
        }
        if (audioManager == null) return;
        int result = audioManager.requestAudioFocus(
                ttsFocusListener,
                AudioManager.STREAM_MUSIC,
                AudioManager.AUDIOFOCUS_GAIN_TRANSIENT
        );
        ttsAudioFocus = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED;
    }

    @SuppressWarnings("deprecation")
    private void releaseSpeechAudioFocus() {
        if (ttsAudioFocus && audioManager != null) {
            audioManager.abandonAudioFocus(ttsFocusListener);
        }
        ttsAudioFocus = false;
    }

    private void stopNativeSpeech() {
        synchronized (this) {
            pendingSpeech = null;
            activeRequestId = null;
            finalUtteranceId = null;
        }
        if (textToSpeech != null) textToSpeech.stop();
        releaseSpeechAudioFocus();
    }

    private void dispatchTtsEvent(String eventName, String requestId) {
        if (requestId == null || webView == null) return;
        String script = "window.dispatchEvent(new CustomEvent("
                + JSONObject.quote(eventName)
                + ",{detail:{id:"
                + JSONObject.quote(requestId)
                + "}}));";
        webView.post(() -> webView.evaluateJavascript(script, null));
    }

    private final class AndroidTtsBridge {
        @JavascriptInterface
        public void speak(String text, double rate, int repeat, String requestId) {
            if (text == null || text.trim().isEmpty() || requestId == null) return;
            runOnUiThread(() -> queueSpeech(text.trim(), (float) rate, repeat, requestId));
        }

        @JavascriptInterface
        public void stop() {
            runOnUiThread(MainActivity.this::stopNativeSpeech);
        }

        @JavascriptInterface
        public String getStatus() {
            synchronized (MainActivity.this) {
                if (ttsReady) return "ready:" + activeTtsEngine;
                if (ttsInitializing) return "initializing";
                return ttsInitFailed ? "failed" : "unavailable";
            }
        }

        @JavascriptInterface
        public void openSettings() {
            runOnUiThread(MainActivity.this::openTtsSettings);
        }
    }

    private void openTtsSettings() {
        try {
            startActivity(new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA));
            return;
        } catch (ActivityNotFoundException ignored) {
            // Fall back to the general settings app on devices without a TTS installer screen.
        }
        try {
            startActivity(new Intent(Settings.ACTION_SETTINGS));
        } catch (ActivityNotFoundException ignored) {
            Toast.makeText(this, R.string.tts_settings_missing, Toast.LENGTH_LONG).show();
        }
    }

    private final class AndroidFilesBridge {
        @JavascriptInterface
        public void saveJson(String fileName, String content) {
            runOnUiThread(() -> {
                pendingJsonContent = content;
                Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT)
                        .addCategory(Intent.CATEGORY_OPENABLE)
                        .setType("application/json")
                        .putExtra(Intent.EXTRA_TITLE, fileName);
                try {
                    startActivityForResult(intent, SAVE_JSON_REQUEST);
                } catch (ActivityNotFoundException error) {
                    pendingJsonContent = null;
                    Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQUEST) {
            if (filePathCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == SAVE_JSON_REQUEST) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingJsonContent != null) {
                try (OutputStream stream = getContentResolver().openOutputStream(data.getData())) {
                    if (stream == null) throw new IOException("No output stream");
                    stream.write(pendingJsonContent.getBytes(StandardCharsets.UTF_8));
                    Toast.makeText(this, R.string.file_saved, Toast.LENGTH_SHORT).show();
                } catch (IOException error) {
                    Toast.makeText(this, R.string.file_save_failed, Toast.LENGTH_LONG).show();
                }
            }
            pendingJsonContent = null;
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
        if (ttsInitFailed && !ttsInitializing) initializePreferredTts();
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (webView == null) {
            super.onBackPressed();
            return;
        }
        String script = "(function(){"
                + "const d=document.querySelector('dialog[open]');"
                + "if(d){d.close();return 'handled';}"
                + "const study=document.getElementById('studyView');"
                + "const library=document.getElementById('libraryView');"
                + "if((study&&!study.hidden)||(library&&!library.hidden)){"
                + "document.querySelector('[data-view-target=\"home\"]').click();return 'handled';}"
                + "return 'exit';})()";
        webView.evaluateJavascript(script, result -> {
            if (!"\"handled\"".equals(result)) closeActivityFromBack();
        });
    }

    @SuppressWarnings("deprecation")
    private void closeActivityFromBack() {
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        stopNativeSpeech();
        mainHandler.removeCallbacksAndMessages(null);
        ttsGeneration += 1;
        if (textToSpeech != null) {
            textToSpeech.shutdown();
            textToSpeech = null;
        }
        ttsReady = false;
        ttsInitializing = false;
        if (webView != null) {
            webView.removeJavascriptInterface("AndroidTts");
            webView.removeJavascriptInterface("AndroidFiles");
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
