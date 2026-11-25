package com.novacore.mobile;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class MainActivity extends Activity {
    private static final String USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36";
    private static final int TIMEOUT_MS = 15000;
    private static final int MAX_RESULTS = 8;
    private static final Pattern TITLE_ANCHOR =
            Pattern.compile("<a\\b[^>]*\\bclass=[\"'][^\"']*\\b(?:result__a|result-link)\\b[^\"']*[\"'][^>]*>",
                    Pattern.CASE_INSENSITIVE);
    private static final Pattern HREF =
            Pattern.compile("\\bhref\\s*=\\s*([\"'])(.*?)\\1", Pattern.CASE_INSENSITIVE);
    private static final Pattern SNIPPET =
            Pattern.compile("<(a|div|td)\\b(?=[^>]*\\bclass=[\"'][^\"']*\\b(?:result__snippet|result-snippet)\\b[^\"']*[\"'])[^>]*>([\\s\\S]*?)</\\1>",
                    Pattern.CASE_INSENSITIVE);
    private static final Pattern SOURCE_URL =
            Pattern.compile("<(?:a|span)\\b(?=[^>]*\\bclass=[\"'][^\"']*\\bresult__url\\b[^\"']*[\"'])[^>]*>([\\s\\S]*?)</(?:a|span)>",
                    Pattern.CASE_INSENSITIVE);
    private static final Pattern TAG =
            Pattern.compile("<[^>]*>");

    private static final class WebResult {
        final String title;
        final String url;
        final String description;
        final String source;

        WebResult(String title, String url, String description, String source) {
            this.title = title;
            this.url = url;
            this.description = description;
            this.source = source;
        }
    }

    private WebView webView;
    private volatile String inFlightSearchError = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().setStatusBarColor(Color.rgb(8, 11, 23));
        getWindow().setNavigationBarColor(Color.rgb(8, 11, 23));
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat bars = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        bars.setAppearanceLightStatusBars(false);
        bars.setAppearanceLightNavigationBars(false);

        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 11, 23));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);
        ViewCompat.setOnApplyWindowInsetsListener(webView, (view, windowInsets) -> {
            Insets insets = windowInsets.getInsets(WindowInsetsCompat.Type.systemBars());
            view.setPadding(insets.left, insets.top, insets.right, insets.bottom);
            return windowInsets;
        });

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(false);
        settings.setAllowUniversalAccessFromFileURLs(false);
        settings.setBlockNetworkLoads(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.addJavascriptInterface(new SearchBridge(), "NovaCoreAndroidSearch");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) && uri.getPath() != null
                        && uri.getPath().startsWith("/android_asset/")) {
                    return false;
                }
                if ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme())) {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                }
                return true;
            }
        });

        setContentView(webView);
        webView.loadUrl("file:///android_asset/index.html");
    }

    /** JavaScript bridge used by the bundled NovaCore app for live DuckDuckGo search. */
    private final class SearchBridge {
        // Android's @JavascriptInterface only converts java.lang.String parameters. Declaring
        // Object here keeps the call working whatever the page passes, instead of failing to
        // resolve the method (which surfaces as a generic TypeError in JavaScript).
        @JavascriptInterface
        public String search(Object queryArgument) {
            String query = queryArgument == null ? "" : String.valueOf(queryArgument);
            if (query.trim().isEmpty() || query.length() > 4000) {
                inFlightSearchError = "Enter a search query between 1 and 4,000 characters.";
                return inFlightSearchError;
            }
            try {
                JSONObject payload = runSearch(query.trim());
                inFlightSearchError = "";
                return payload.toString();
            } catch (Exception error) {
                String message = error.getMessage();
                if (message == null || message.trim().isEmpty()) {
                    message = "DuckDuckGo could not complete the search. Check the connection and try again.";
                }
                inFlightSearchError = message;
                return message;
            }
        }

        @JavascriptInterface
        public boolean getLastSearchFailed() {
            return !inFlightSearchError.isEmpty();
        }

        @JavascriptInterface
        public String getLastSearchError() {
            return inFlightSearchError;
        }
    }

    private JSONObject runSearch(String query) throws IOException, JSONException {
        List<WebResult> webResults = new ArrayList<>();
        String webError = "";
        for (String endpoint : new String[]{
                "https://html.duckduckgo.com/html/",
                "https://lite.duckduckgo.com/lite/"}) {
            try {
                String html = httpGet(endpoint + "?q=" + URLEncoder.encode(query, "UTF-8") + "&kp=1");
                if (html.contains("anomaly.js") || html.toLowerCase().contains("captcha")) {
                    webError = "DuckDuckGo is asking to verify this search.";
                    continue;
                }
                webResults = parseWebResults(html);
                if (!webResults.isEmpty()) {
                    break;
                }
            } catch (Exception error) {
                webError = error.getMessage() != null
                        ? error.getMessage()
                        : "Could not connect to DuckDuckGo.";
            }
        }
        if (webResults.isEmpty() && webError.isEmpty()) {
            webError = "DuckDuckGo returned no web results for this query.";
        }

        List<JSONObject> imageResults = new ArrayList<>();
        String imageError = "";
        try {
            JSONObject images = fetchImages(query);
            JSONArray parsed = images.optJSONArray("results");
            if (parsed != null) {
                for (int index = 0; index < parsed.length() && imageResults.size() < MAX_RESULTS; index++) {
                    JSONObject item = normalizeImage(parsed.optJSONObject(index));
                    if (item != null) {
                        imageResults.add(item);
                    }
                }
            }
        } catch (Exception error) {
            imageError = error.getMessage() != null
                    ? error.getMessage()
                    : "DuckDuckGo image search failed.";
        }

        if (webResults.isEmpty() && imageResults.isEmpty()) {
            throw new IOException(!webError.isEmpty() ? webError : imageError);
        }

        JSONArray web = new JSONArray();
        for (WebResult result : webResults) {
            JSONObject item = new JSONObject();
            item.put("title", result.title);
            item.put("url", result.url);
            item.put("description", result.description);
            item.put("source", result.source);
            web.put(item);
        }

        JSONArray images = new JSONArray();
        for (JSONObject item : imageResults) {
            images.put(item);
        }

        JSONArray warnings = new JSONArray();
        if (webResults.isEmpty() && !webError.isEmpty()) {
            warnings.put("Web results unavailable: " + webError);
        }
        if (imageResults.isEmpty() && !imageError.isEmpty()) {
            warnings.put("Image results unavailable: " + imageError);
        }

        JSONObject payload = new JSONObject();
        payload.put("provider", "DuckDuckGo");
        payload.put("query", query);
        payload.put("webResults", web);
        payload.put("imageResults", images);
        payload.put("warnings", warnings);
        return payload;
    }

    private JSONObject fetchImages(String query) throws IOException, JSONException {
        String landing = httpGet("https://duckduckgo.com/?q=" + URLEncoder.encode(query, "UTF-8") + "&kp=1&iax=images&ia=images");
        Matcher token = Pattern.compile("\\bvqd\\s*[:=]\\s*[\"']([^\"']+)[\"']").matcher(landing);
        if (!token.find()) {
            throw new IOException("DuckDuckGo did not provide an image-search token.");
        }
        String body = httpGet("https://duckduckgo.com/i.js?l=us-en&o=json&kp=1&p=1&f=,,,&vqd="
                + URLEncoder.encode(token.group(1), "UTF-8")
                + "&q=" + URLEncoder.encode(query, "UTF-8"));
        return new JSONObject(body);
    }

    private JSONObject normalizeImage(JSONObject result) {
        if (result == null) {
            return null;
        }
        String image = safeUrl(result.optString("image", ""));
        String thumbnail = safeUrl(result.optString("thumbnail", ""));
        String page = safeUrl(result.optString("url", ""));
        if (image.isEmpty()) {
            return null;
        }
        if (thumbnail.isEmpty()) {
            thumbnail = image;
        }
        if (page.isEmpty()) {
            page = image;
        }
        try {
            JSONObject item = new JSONObject();
            item.put("title", result.optString("title", "").substring(0, Math.min(300, result.optString("title", "").length())));
            item.put("pageUrl", page);
            item.put("imageUrl", image);
            item.put("thumbnailUrl", thumbnail);
            item.put("source", result.optString("source", ""));
            return item;
        } catch (JSONException error) {
            return null;
        }
    }

    private List<WebResult> parseWebResults(String html) {
        List<WebResult> results = new ArrayList<>();
        Set<String> seen = new LinkedHashSet<>();
        Matcher anchor = TITLE_ANCHOR.matcher(html);
        List<int[]> starts = new ArrayList<>();
        List<String> tags = new ArrayList<>();
        while (anchor.find() && starts.size() <= MAX_RESULTS * 2) {
            starts.add(new int[]{anchor.start(), anchor.end()});
            tags.add(anchor.group());
        }
        for (int index = 0; index < starts.size() && results.size() < MAX_RESULTS; index++) {
            int titleStart = starts.get(index)[1];
            int titleEnd = html.indexOf("</a>", titleStart);
            if (titleEnd < 0) {
                continue;
            }
            Matcher href = HREF.matcher(tags.get(index));
            String url = href.find() ? canonicalUrl(href.group(2)) : "";
            if (url.isEmpty() || !seen.add(url)) {
                continue;
            }
            int blockEnd = index + 1 < starts.size() ? starts.get(index + 1)[0] : html.length();
            String after = html.substring(titleEnd, blockEnd);
            Matcher snippet = SNIPPET.matcher(after);
            Matcher source = SOURCE_URL.matcher(after);
            String title = toText(html.substring(titleStart, titleEnd));
            String sourceLabel = source.find() ? toText(source.group(1)) : "";
            results.add(new WebResult(
                    title.isEmpty() ? url : title,
                    url,
                    snippet.find() ? toText(snippet.group(2)) : "",
                    sourceLabel.isEmpty() ? hostOf(url) : sourceLabel));
        }
        return results;
    }

    private String httpGet(String address) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(address).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(TIMEOUT_MS);
        connection.setReadTimeout(TIMEOUT_MS);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("Accept", "text/html,application/json");
        connection.setRequestProperty("Accept-Language", "en-US,en;q=0.8");
        connection.setRequestProperty("User-Agent", USER_AGENT);
        connection.setRequestProperty("Referer", "https://duckduckgo.com/");
        try {
            int status = connection.getResponseCode();
            if (status >= 400) {
                throw new IOException("DuckDuckGo search failed (HTTP " + status + ").");
            }
            InputStream stream = connection.getInputStream();
            StringBuilder builder = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                char[] buffer = new char[8192];
                int read;
                while ((read = reader.read(buffer)) != -1) {
                    builder.append(buffer, 0, read);
                    if (builder.length() > 2_000_000) {
                        break;
                    }
                }
            }
            return builder.toString();
        } finally {
            connection.disconnect();
        }
    }

    private static String toText(String value) {
        return TAG.matcher(value).replaceAll(" ")
                .replace("&amp;", "&")
                .replace("&quot;", "\"")
                .replace("&#x27;", "'")
                .replace("&#39;", "'")
                .replace("&lt;", "<")
                .replace("&gt;", ">")
                .replace("&nbsp;", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }

    private static String safeUrl(String value) {
        if (value == null || value.isEmpty() || value.length() > 4096) {
            return "";
        }
        try {
            URI uri = new URI(value);
            String scheme = uri.getScheme();
            if (("https".equalsIgnoreCase(scheme) || "http".equalsIgnoreCase(scheme))
                    && uri.getHost() != null
                    && uri.getUserInfo() == null) {
                return uri.toString();
            }
        } catch (Exception ignored) {
            return "";
        }
        return "";
    }

    private static String canonicalUrl(String value) {
        String decoded = value;
        if (decoded.startsWith("//")) {
            decoded = "https:" + decoded;
        }
        try {
            URI uri = new URI(decoded);
            String query = uri.getRawQuery();
            if (query != null) {
                for (String part : query.split("&")) {
                    if (part.startsWith("uddg=")) {
                        String target = java.net.URLDecoder.decode(part.substring(5), "UTF-8");
                        String safe = safeUrl(target);
                        if (!safe.isEmpty()) {
                            return safe;
                        }
                    }
                }
            }
            return safeUrl(decoded);
        } catch (Exception error) {
            return "";
        }
    }

    private static String hostOf(String url) {
        try {
            String host = new URI(url).getHost();
            return host == null ? "" : host;
        } catch (Exception error) {
            return "";
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.removeJavascriptInterface("NovaCoreAndroidSearch");
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
