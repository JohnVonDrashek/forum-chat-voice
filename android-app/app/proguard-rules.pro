# Keep the JS bridge interface methods (called via reflection by WebView)
-keepclassmembers class net.forumline.app.WebViewBridge {
    @android.webkit.JavascriptInterface <methods>;
}
