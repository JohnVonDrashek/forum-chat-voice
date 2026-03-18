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
    environment: location.hostname.endsWith('.forumline.net') ? 'production' : 'development',
    tracesSampleRate: 0,
    sampleRate: 1.0,
    sendDefaultPii: false,
    initialScope: {
      tags: {
        app: 'hosted-forum',
        forum: location.hostname.replace('.forumline.net', ''),
      },
    },
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = event.request.url.replace(/access_token=[^&]+/, 'access_token=[REDACTED]');
      }
      return event;
    },
  });

  initialized = true;
}

/** Tag errors with the current forum user */
export function setErrorTrackingUser(userId, username) {
  if (!initialized) return;
  Sentry.setUser({ id: userId, username });
}

export function clearErrorTrackingUser() {
  if (!initialized) return;
  Sentry.setUser(null);
}
