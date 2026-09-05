package com.qilin.englishrecite;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
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
import java.util.Locale;

public class MainActivity extends Activity {
    private static final String APP_URL = "https://appassets.androidplatform.net/assets/www/index.html";
    private static final int FILE_CHOOSER_REQUEST = 501;
    private static final int SAVE_JSON_REQUEST = 502;

    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private TextToSpeech textToSpeech;
    private boolean textToSpeechReady;
    private PendingSpeech pendingSpeech;
    private String activeRequestId;
    private String finalUtteranceId;
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
        initializeTextToSpeech();
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

    private void initializeTextToSpeech() {
        textToSpeech = new TextToSpeech(this, status -> {
            textToSpeechReady = status == TextToSpeech.SUCCESS;
            if (textToSpeechReady) {
                int result = textToSpeech.setLanguage(Locale.US);
                textToSpeechReady = result != TextToSpeech.LANG_MISSING_DATA
                        && result != TextToSpeech.LANG_NOT_SUPPORTED;
                installUtteranceListener();
            }

            if (pendingSpeech != null) {
                PendingSpeech speech = pendingSpeech;
                pendingSpeech = null;
                if (textToSpeechReady) {
                    queueSpeech(speech.text, speech.rate, speech.repeat, speech.requestId);
                } else {
                    dispatchTtsEvent("native-tts-error", speech.requestId);
                }
            }
        });
    }

    private void installUtteranceListener() {
        textToSpeech.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                // No UI update is needed here; JavaScript already marks the button as playing.
            }

            @Override
            public void onDone(String utteranceId) {
                if (utteranceId != null && utteranceId.equals(finalUtteranceId)) {
                    String finishedRequest = activeRequestId;
                    activeRequestId = null;
                    finalUtteranceId = null;
                    dispatchTtsEvent("native-tts-done", finishedRequest);
                }
            }

            @Override
            public void onError(String utteranceId) {
                String failedRequest = activeRequestId;
                activeRequestId = null;
                finalUtteranceId = null;
                dispatchTtsEvent("native-tts-error", failedRequest);
            }
        });
    }

    private void queueSpeech(String text, float rate, int repeat, String requestId) {
        if (!textToSpeechReady) {
            pendingSpeech = new PendingSpeech(text, rate, repeat, requestId);
            return;
        }

        textToSpeech.stop();
        textToSpeech.setLanguage(Locale.US);
        textToSpeech.setSpeechRate(Math.max(0.5f, Math.min(2f, rate)));
        int safeRepeat = Math.max(1, Math.min(3, repeat));
        activeRequestId = requestId;
        finalUtteranceId = requestId + "-final";

        for (int index = 0; index < safeRepeat; index += 1) {
            String utteranceId = index == safeRepeat - 1
                    ? finalUtteranceId
                    : requestId + "-" + index;
            textToSpeech.speak(
                    text,
                    index == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD,
                    null,
                    utteranceId
            );
        }
    }

    private void stopNativeSpeech() {
        pendingSpeech = null;
        activeRequestId = null;
        finalUtteranceId = null;
        if (textToSpeech != null) textToSpeech.stop();
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
        if (textToSpeech != null) {
            textToSpeech.shutdown();
            textToSpeech = null;
        }
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
