// Adsum FCM background handler — delivers emergency push notifications
// (e.g. "flagged absent — see your Rep") even when the app tab is closed.
// Registered as a module service worker from app.js when the user enables
// push notifications in Account Settings.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import { getMessaging, onBackgroundMessage } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging-sw.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUtViZ-mef1dSV-XpSos4-oh1HpQ7jpyw",
  authDomain: "attendify-4c93d.firebaseapp.com",
  projectId: "attendify-4c93d",
  storageBucket: "attendify-4c93d.firebasestorage.app",
  messagingSenderId: "912075322838",
  appId: "1:912075322838:web:c8e5a9a16b1acf7667e077",
};

const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);

onBackgroundMessage(messaging, (payload) => {
  const notification = payload.notification || {};
  const data = payload.data || {};
  self.registration.showNotification(notification.title || "Adsum", {
    body:
      notification.body ||
      "You have a new attendance alert. Open Adsum to review it.",
    tag: data.type || "adsum-alert",
    data: { link: data.link || "/" },
    vibrate: [200, 100, 200],
    requireInteraction: data.type === "absent_flag",
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientList) => {
        for (const client of clientList) {
          if ("focus" in client) return client.focus();
        }
        return self.clients.openWindow(link);
      }),
  );
});
