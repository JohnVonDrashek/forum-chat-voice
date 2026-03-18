// Error tracking via GlitchTip (Sentry-compatible)
// DSN is injected at runtime by the Go server as window.GLITCHTIP_DSN.
// If no DSN is configured, error tracking is silently disabled.

import * as Sentry from '@sentry/browser';

let initialized = false;

export function initErrorTracking() {
  const dsn = window.GLITCHTIP_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: location.hostname === 'app.forumline.net' ? 'production' : 'development',
    // Keep sample rate low — we want errors, not performance traces
    tracesSampleRate: 0,
    // Send 100% of errors (GlitchTip handles dedup)
    sampleRate: 1.0,
    // Don't send PII by default
    sendDefaultPii: false,
    // Tag every event with the app name
    initialScope: {
      tags: { app: 'forumline-web' },
    },
    beforeSend(event) {
      // Strip access tokens from URLs (SSE endpoints pass tokens in query string)
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/access_token=[^&]+/, 'access_token=[REDACTED]');
      }
      return event;
    },
  });

  initialized = true;
}

/** Tag errors with the current user (call after auth completes) */
export function setErrorTrackingUser(userId, username) {
  if (!initialized) return;
  Sentry.setUser({ id: userId, username });
}

/** Clear user context on logout */
export function clearErrorTrackingUser() {
  if (!initialized) return;
  Sentry.setUser(null);
}
