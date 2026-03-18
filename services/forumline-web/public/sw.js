// Forumline — Push Notification Service Worker

self.addEventListener('push', event => {
  if (!event.data) return;

  const data = event.data.json();
  const { title, body, link, forum_domain } = data;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // If a Forumline tab is focused, send message to page for in-app handling
      const focusedClient = windowClients.find(
        c => c.focused && c.url.includes(self.location.origin),
      );
      if (focusedClient) {
        focusedClient.postMessage({
          type: 'push-message',
          title,
          body,
          link,
          forum_domain,
        });
        return;
      }

      // Tab not focused or closed — show OS notification
      return self.registration.showNotification(title, {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: link || 'forumline',
        data: { link, forum_domain },
      });
    }),
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  const { link, forum_domain } = event.notification.data || {};

  // Open the Forumline app, optionally navigating to the forum/link
  const url =
    forum_domain && link ? `/?forum=${forum_domain}&path=${encodeURIComponent(link)}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      // Focus existing tab if one exists
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin)) {
          client.focus();
          client.postMessage({ type: 'notification-click', forum_domain, link });
          return;
        }
      }
      // Otherwise open a new tab
      return clients.openWindow(url);
    }),
  );
});
