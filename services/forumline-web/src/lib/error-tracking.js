// Error tracking via GlitchTip (Sentry-compatible)
// DSN is injected at runtime by the Go server as window.GLITCHTIP_DSN.
// If no DSN is configured, error tracking is silently disabled.

import * as Sentry from '@sentry/browser';
import { captureConsoleIntegration, httpClientIntegration } from '@sentry/browser';

let initialized = false;

export function initErrorTracking() {
  const dsn = window.GLITCHTIP_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: location.hostname === 'app.forumline.net' ? 'production' : 'development',
    tracesSampleRate: 0,
    sampleRate: 1.0,
    sendDefaultPii: false,
    integrations: [
      // Auto-capture failed fetch responses (4xx, 5xx) as Sentry events
      httpClientIntegration({ failedRequestStatusCodes: [[400, 599]] }),
      // Auto-forward console.error() calls to Sentry
      captureConsoleIntegration({ levels: ['error'] }),
    ],
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
