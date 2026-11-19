// No push server (D7 adapted): the page itself fires a notification through the
// service worker ~2 min before each interchange while the app is open.
// iOS only delivers these for the installed home-screen app, and suspends
// timers once the app is fully backgrounded — the trip screen stays the primary UI.

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export async function requestNotifications() {
  if (!notificationsSupported()) return 'unsupported' as const;
  return Notification.requestPermission();
}

export async function showNotification(title: string, body: string, tag: string) {
  if (notificationPermission() !== 'granted') return;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.showNotification(title, { body, tag, icon: `${import.meta.env.BASE_URL}icon.svg`, badge: `${import.meta.env.BASE_URL}icon.svg` });
      return;
    }
  } catch {
    /* fall through */
  }
  new Notification(title, { body, tag });
}
