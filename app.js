// 🔖 BUILD MARKER — proves which version of app.js the browser is running.
// If your console does NOT print "build 256052f-drawer", the running JS is stale.
console.log("%cVeriPresenX build: premium-design-system (palette refresh, button micro-interactions, success celebration, skeleton shimmer, toast slide-in)", "color:#7C6CF0;font-weight:bold");

// --- SUCCESS CELEBRATION (premium check-in moment) ---
function showCheckInSuccess() {
  const overlay = document.createElement("div");
  overlay.className = "success-overlay";
  overlay.innerHTML =
    '<svg class="success-checkmark" viewBox="0 0 24 24" fill="none"><path d="M4 12l5 5L20 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
    '<div class="success-text">Checked In! 🎉</div>';
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.transition = "opacity 0.4s ease";
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 400);
  }, 1400);
}

// --- FIREBASE IMPORTS & CONFIGURATION ---
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.18.0/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  sendEmailVerification,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  // `runTransaction` was imported for the client-side rep-slot race that Phase 5
  // deleted. The rep role is now granted by the server inside
  // api/onboarding.js, so the client has no transaction left to run.
  getDocs,
  query,
  where,
  orderBy,
  limit,
  updateDoc,
  deleteDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
  addDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-firestore.js";

// ============================================================
// UI HELPER: REFRESH ICONS
// ============================================================
function refreshIcons() {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================
function showToast(message, type = "info", title = "") {
  const container = document.getElementById("toast-container");
  if (!container) {
    console.warn(message);
    return;
  }

  const icons = {
    success:
      '<i data-lucide="check-circle" style="color: var(--success); width:18px; height:18px;"></i>',
    error:
      '<i data-lucide="x-circle" style="color: var(--danger); width:18px; height:18px;"></i>',
    warning:
      '<i data-lucide="alert-triangle" style="color: #fd7e14; width:18px; height:18px;"></i>',
    info: '<i data-lucide="info" style="color: var(--teal); width:18px; height:18px;"></i>',
  };
  const titles = {
    success: "Success",
    error: "Error",
    warning: "Warning",
    info: "Info",
  };

  const existingMessages = container.querySelectorAll(".toast-message");
  for (const el of existingMessages) {
    if (el.textContent === message) return;
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  // Icons are trusted constants and may be HTML; the title/message are plain
  // text set via textContent so caller data (e.g. Firestore matrics) can
  // never inject markup.
  toast.innerHTML = `
    <span class="toast-icon">${icons[type] || "ℹ️"}</span>
    <div class="toast-body">
      <div class="toast-title"></div>
      <div class="toast-message"></div>
    </div>
  `;
  toast.querySelector(".toast-title").textContent = title || titles[type] || "";
  toast.querySelector(".toast-message").textContent = message || "";

  container.appendChild(toast);

  const duration = type === "error" ? 5000 : 3500;
  setTimeout(() => {
    toast.classList.add("toast-exit");
    toast.addEventListener("animationend", () => toast.remove(), {
      once: true,
    });
  }, duration);
}

// Convenience wrappers
const toast = {
  success: (msg, title) => showToast(msg, "success", title),
  error: (msg, title) => showToast(msg, "error", title),
  warning: (msg, title) => showToast(msg, "warning", title),
  info: (msg, title) => showToast(msg, "info", title),
};

// ============================================================
// APP NAVIGATION HISTORY (Android back button / swipe support)
// ============================================================
// The app is a single page that swaps views. We keep ONE trap entry in the
// browser history: every back-press lands on the trap and we decide what
// "back" means for the view the user is actually on — like a native app.
let currentNavView = "auth";

function replaceNavState(view) {
  currentNavView = view;
  try {
    history.replaceState({ veripresenx: true, view }, "");
  } catch (e) {
    /* older browsers — ignore */
  }
}

function pushNavTrap(view) {
  currentNavView = view;
  try {
    history.pushState({ veripresenx: true, view }, "");
  } catch (e) {
    /* ignore */
  }
}

window.addEventListener("popstate", (event) => {
  const state = event.state || {};
  const view = state.view || currentNavView;

  // A modal is open? Back closes the modal instead of the app.
  const openModal = document.querySelector(".modal.show");
  if (openModal) {
    openModal.classList.remove("show");
    pushNavTrap(currentNavView);
    return;
  }

  // Mission-Control drawer open? Back closes the drawer first.
  if (window.__veripresenxCloseDrawer && window.__veripresenxCloseDrawer()) {
    pushNavTrap(currentNavView);
    return;
  }

  if (view === "portal" && currentNavView === "portal") {
    pushNavTrap("portal");
    return;
  }

  if (currentNavView === "portal" && window.__veripresenxReturnToDashboard) {
    // Back from a course portal → return to the dashboard.
    window.__veripresenxReturnToDashboard();
    return;
  }

  if (currentNavView === "dashboard") {
    showConfirm({
      title: "Log out?",
      message: "Do you want to log out of VeriPresenX?",
      okText: "Yes, Log out",
      cancelText: "Stay",
      icon: "log-out",
      danger: false,
    }).then((yes) => {
      if (yes) {
        signOut(auth);
      }
      pushNavTrap("dashboard");
    });
    return;
  }

  // Auth screen — the user is about to leave the app entirely.
  showConfirm({
    title: "Leave VeriPresenX?",
    message: "You are about to exit the app. Are you sure?",
    okText: "Leave",
    cancelText: "Stay",
    icon: "log-out",
    danger: false,
  }).then((yes) => {
    if (yes) {
      history.back(); // genuinely exit — no trap re-push
    } else {
      pushNavTrap("auth");
    }
  });
});

// Initial trap entry — every back-press from here on hits our handler.
pushNavTrap("auth");

// ============================================================
// NETWORK QUALITY CHIP (is the network good right now?)
// ============================================================
function updateNetworkChips() {
  const chips = document.querySelectorAll(".network-chip");
  if (!chips.length) return;
  let label;
  let color;
  if (!navigator.onLine) {
    label = "🔴 Offline";
    color = "var(--danger)";
  } else {
    const conn =
      navigator.connection ||
      navigator.mozConnection ||
      navigator.webkitConnection;
    const type = conn ? conn.effectiveType : "";
    const down =
      conn && typeof conn.downlink === "number" ? conn.downlink : null;
    if (type === "slow-2g" || type === "2g" || (down !== null && down < 0.2)) {
      label = "📶 Very slow";
      color = "var(--danger)";
    } else if (type === "3g" || (down !== null && down < 1.5)) {
      label = "📶 Weak";
      color = "#fd7e14";
    } else {
      label = "📶 Good";
      color = "var(--success)";
    }
  }
  chips.forEach((c) => {
    c.textContent = label;
    c.style.color = color;
    c.style.borderColor = color;
  });
}

window.addEventListener("online", updateNetworkChips);
window.addEventListener("offline", updateNetworkChips);
document.addEventListener("visibilitychange", updateNetworkChips);
if (navigator.connection) {
  navigator.connection.addEventListener("change", updateNetworkChips);
}
setInterval(updateNetworkChips, 20000);
updateNetworkChips();

// ============================================================
// FETCH WITH TIMEOUT (slow networks must fail fast, not hang forever)
// ============================================================
async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================
// SPLASH SCREEN (pure cosmetic — click anywhere to continue)
// ============================================================
const splashScreen = document.getElementById("splashScreen");
if (splashScreen) {
  // ⏸ The entrance animation runs 1.1s and the idle float starts at 1.3s.
  // A tap in the first moment skipped all of it, so the user saw a static
  // logo. This short lockout guarantees the animation is actually seen without
  // making anyone wait for it.
  const SPLASH_MIN_MS = 900;
  const splashShownAt = Date.now();
  splashScreen.addEventListener("click", () => {
    if (splashScreen.classList.contains("splash-fade-out")) return;
    const waited = Date.now() - splashShownAt;
    if (waited < SPLASH_MIN_MS) {
      setTimeout(() => splashScreen.click(), SPLASH_MIN_MS - waited);
      return;
    }
    splashScreen.classList.add("splash-fade-out");
    setTimeout(() => {
      splashScreen.style.display = "none";
    }, 650);
  });
}

// ============================================================
// CUSTOM CONFIRM DIALOG  (replaces window.confirm)
// ============================================================
function showConfirm({
  title,
  message,
  okText = "Confirm",
  cancelText = "Cancel",
  danger = true,
  icon = "⚠️",
  details = null, // optional [{label, value}] table — e.g. the signup double-check
}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("confirm-overlay");
    const iconEl = document.getElementById("confirm-icon");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");

    if (!overlay) {
      // Fallback to browser confirm if custom dialog not available
      console.warn("Custom confirm dialog not found, using browser default");
      resolve(window.confirm(message));
      return;
    }

    iconEl.innerHTML = `<i data-lucide="${icon}" style="width: 32px; height: 32px;"></i>`;
    titleEl.textContent = title || "Are you sure?";
    msgEl.textContent = message || "";

    // Optional key/value table (the signup double-check). Values are written
    // via textContent so user-supplied strings can never inject markup.
    const detailsEl = document.getElementById("confirm-details");
    if (detailsEl) {
      detailsEl.innerHTML = "";
      if (Array.isArray(details) && details.length) {
        details.forEach(({ label, value } = {}) => {
          const row = document.createElement("div");
          row.className = "confirm-detail-row";
          const labelEl = document.createElement("span");
          labelEl.className = "confirm-detail-label";
          labelEl.textContent = String(label ?? "");
          const valueEl = document.createElement("span");
          valueEl.className = "confirm-detail-value";
          valueEl.textContent = String(value ?? "");
          row.appendChild(labelEl);
          row.appendChild(valueEl);
          detailsEl.appendChild(row);
        });
        detailsEl.classList.remove("hidden");
      } else {
        detailsEl.classList.add("hidden");
      }
    }

    okBtn.innerHTML = danger
      ? `<i data-lucide="trash-2" style="width:16px; height:16px;"></i> ${okText}`
      : `<i data-lucide="check" style="width:16px; height:16px;"></i> ${okText}`;
    cancelBtn.textContent = cancelText;

    okBtn.className = danger ? "confirm-ok" : "confirm-ok ok-safe";
    okBtn.id = "confirm-ok"; // keep id

    overlay.classList.add("show");

    const cleanup = (result) => {
      overlay.classList.remove("show");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      resolve(result);
    };

    const onOk = () => cleanup(true);
    const onCancel = () => cleanup(false);

    okBtn.addEventListener("click", onOk, { once: true });
    cancelBtn.addEventListener("click", onCancel, { once: true });
  });
}

const firebaseConfig = {
  apiKey: "AIzaSyDUtViZ-mef1dSV-XpSos4-oh1HpQ7jpyw",
  authDomain: "attendify-4c93d.firebaseapp.com",
  projectId: "attendify-4c93d",
  storageBucket: "attendify-4c93d.firebasestorage.app",
  messagingSenderId: "912075322838",
  appId: "1:912075322838:web:c8e5a9a16b1acf7667e077",
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// 📶 OFFLINE-FIRST FIRESTORE: writes made while the network is down are
// queued in IndexedDB and synced automatically the moment connectivity
// returns — critical for lecture halls where 200 students share one router.
export let db;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager(),
    }),
  });
} catch (err) {
  console.warn("Offline persistence unavailable, using default cache:", err);
  db = getFirestore(app);
}

// ============================================================
// OPTIONAL HARDENING KEYS (fill these from the Firebase Console)
// ============================================================
// App Check: Console → App Check → Apps → register the web app (reCAPTCHA v3),
// then paste the site key here. Leave empty to run without App Check — the
// backend only enforces it when ENFORCE_APP_CHECK=true is set on the API env.
const APP_CHECK_SITE_KEY = "";

// FCM Web Push: Console → Cloud Messaging → Web Push certificates ("VAPID").
// Leave empty and emergency alerts fall back to in-app toasts + banners only.
const FCM_VAPID_KEY =
  "BGnLSA_9ZszaBxhB7eAWnvXJYgxQuDB1m6bN7vdKFolrse2GSMcE1EZRpNXounLaYA7_x8wjqjJqFkhLzs0J8ao";

if (APP_CHECK_SITE_KEY) {
  import("https://www.gstatic.com/firebasejs/12.18.0/firebase-app-check.js")
    .then(({ initializeAppCheck, ReCaptchaV3Provider }) => {
      initializeAppCheck(app, {
        provider: new ReCaptchaV3Provider(APP_CHECK_SITE_KEY),
        isTokenAutoRefreshEnabled: true,
      });
      console.info("Firebase App Check active.");
    })
    .catch((err) => console.warn("App Check init skipped:", err));
}

// --- GLOBAL APP STATES ---
let courses = [];
let currentUser = null;
let activeCourse = null;
let countdownInterval = null;
let isCreatingAccount = false; // 👈 ADD THIS LINE HERE%
let studentExemptions = []; // Cache for student exemptions
let securityOverlayActive = false; // Track if security overlay is showing

// --- SECURITY: SCREENSHOT/RECORDING + BACKGROUND APP DETECTION ---
// Honest capability note: a web page CAN catch desktop screenshot keyboard
// shortcuts, and it CAN see when the tab/app is hidden (which is exactly
// what happens when someone switches to a screen recorder or another app).
// It cannot block hardware screenshots on mobile — so every signal we can
// see is shown to the student AND logged permanently for the rep to review.
let securityHiddenAt = 0;
let securityLastEventAt = {};
let securityEventCount = 0;
let securityEventCountSession = null;

function isLiveSessionNow() {
  return Boolean(
    activeCourse &&
      activeCourse.activeSession &&
      !activeCourse.activeSession.expired,
  );
}

// Persists a soft-security signal to courses/{id}/securityEvents so the
// rep sees it in their dashboard. Debounced + capped so a misbehaving
// client can't flood the rep with noise. Failures are non-fatal.
async function logSecurityEvent(type, extra = {}) {
  try {
    if (!isLiveSessionNow() || !auth.currentUser) return;
    // Give every session its own 20-event budget — otherwise a student who
    // screenshot-heavy first session empties the cap for all later ones.
    const sessionExp = activeCourse.activeSession.expiresAt || 0;
    if (securityEventCountSession !== sessionExp) {
      securityEventCountSession = sessionExp;
      securityEventCount = 0;
    }
    if (securityEventCount >= 20) return;
    const now = Date.now();
    const last = securityLastEventAt[type] || 0;
    if (now - last < 5000) return;
    securityLastEventAt[type] = now;
    securityEventCount++;

    await setDoc(
      doc(collection(db, "courses", activeCourse.id, "securityEvents")),
      {
        uid: auth.currentUser.uid,
        matric: currentUser ? currentUser.matric : "",
        type,
        sessionExpiresAt: activeCourse.activeSession.expiresAt || 0,
        ...extra,
        loggedAt: serverTimestamp(),
      },
    );
  } catch (err) {
    console.warn("Security event not logged:", err.message);
  }
}

function setupSecurityMonitoring() {
  const securityOverlay = document.getElementById("securityOverlay");
  const dismissSecurityBtn = document.getElementById("dismissSecurityAlert");

  if (!securityOverlay) return;

  const showSecurityOverlay = () => {
    if (securityOverlayActive) return;
    securityOverlayActive = true;
    securityOverlay.classList.remove("hidden");
    securityOverlay.classList.add("show");
  };

  const hideSecurityOverlay = () => {
    securityOverlayActive = false;
    securityOverlay.classList.remove("show");
    securityOverlay.classList.add("hidden");
  };

  if (dismissSecurityBtn) {
    dismissSecurityBtn.addEventListener("click", hideSecurityOverlay);
  }

  // Keyboard shortcuts for screenshots (desktop)
  document.addEventListener("keydown", (e) => {
    if (!isLiveSessionNow()) return;

    const isPrintScreen = e.key === "PrintScreen";
    const isShortcutShot =
      (e.metaKey || e.ctrlKey) &&
      e.shiftKey &&
      ["3", "4", "5"].includes(e.key);
    if (!isPrintScreen && !isShortcutShot) return;

    e.preventDefault();
    showSecurityOverlay();
    logSecurityEvent("screenshot_attempt", {
      method: isPrintScreen ? "printscreen" : "keyboard_shortcut",
    });
    toast.error(
      "Screenshots are blocked during attendance sessions — this attempt was recorded.",
      "🚫 Security Alert",
    );
  });

  // Background app detection: fires on mobile app switching AND desktop
  // tab/minimize. A short absence (<3s) is normal (notification shade,
  // permission prompts) and ignored; anything longer is logged + alerted.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      if (isLiveSessionNow()) securityHiddenAt = Date.now();
      return;
    }
    if (!securityHiddenAt) return;
    const awayMs = Date.now() - securityHiddenAt;
    securityHiddenAt = 0;
    if (!isLiveSessionNow() || awayMs < 3000) return;

    logSecurityEvent("left_app", { awayMs });
    toast.warning(
      `You left the app during attendance for ${Math.round(
        awayMs / 1000,
      )}s. This was recorded for your Course Rep.`,
      "👁️ Background Detected",
    );
  });

  // Fallback for browsers that don't fire visibilitychange reliably.
  window.addEventListener("blur", () => {
    if (isLiveSessionNow() && !securityHiddenAt) securityHiddenAt = Date.now();
  });

  return { showSecurityOverlay, hideSecurityOverlay };
}

// Initialize security monitoring
const securityControls = setupSecurityMonitoring();

// --- CLOCK SKEW SYNC & DEVICE BINDING ---
let serverClockSkewMs = 0;

async function syncServerClock() {
  try {
    const start = Date.now();
    const resp = await fetch("/", { method: "HEAD", cache: "no-store" });
    const dateHeader = resp.headers.get("date");
    if (dateHeader) {
      const serverTime = new Date(dateHeader).getTime();
      const latency = (Date.now() - start) / 2;
      serverClockSkewMs = serverTime + latency - Date.now();
    }
  } catch (e) {
    console.warn("Clock sync ping fallback:", e);
  }
}
syncServerClock();

function getAccurateNow() {
  return Date.now() + serverClockSkewMs;
}

// Countdown formatting: always M:SS so timers never show confusing raw
// numbers like "1020" — 5 minutes reads as "5:00", 23 seconds as "0:23".
function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

function applyPortalCourseUpdate(updated) {
  if (!updated) return;
  if (!activeCourse || activeCourse.id !== updated.id) {
    activeCourse = updated;
    return;
  }
  const prevHistory = activeCourse.attendanceHistory;
  const prevSession = activeCourse.activeSession;
  const prevFlags = activeCourse.deviceFlags;
  activeCourse = {
    ...updated,
    attendanceHistory: Array.isArray(prevHistory)
      ? prevHistory
      : updated.attendanceHistory || [],
    deviceFlags: Array.isArray(prevFlags)
      ? prevFlags
      : updated.deviceFlags || [],
  };
  if (updated.activeSession && prevSession) {
    // Only carry local-only fields (PIN cache, rotation time, local deadline)
    // across snapshots of the SAME session. A brand-new session (different
    // expiresAt) must start clean — otherwise stale values from a previous
    // lecture leak into the new one and corrupt the countdown on this device.
    const sameSession =
      prevSession.expiresAt === updated.activeSession.expiresAt;
    activeCourse.activeSession = {
      ...updated.activeSession,
      ...(sameSession
        ? {
            pin: prevSession.pin || updated.activeSession.pin || null,
            previousPin:
              prevSession.previousPin ||
              updated.activeSession.previousPin ||
              null,
            pinRotationTime:
              prevSession.pinRotationTime ||
              updated.activeSession.pinRotationTime ||
              Date.now(),
            // Union, never replace: a fresh snapshot (course doc published
            // by the rep, or the live-publish from the check-in API) must not
            // shrink a fuller list we already hold. The roster can only grow
            // during a session, so a union is both safe and converges.
            attendees: (() => {
              const upd = (updated.activeSession.attendees || [])
                .map(normalizeMatric)
                .filter(Boolean);
              const prev = (prevSession.attendees || [])
                .map(normalizeMatric)
                .filter(Boolean);
              return Array.from(new Set([...prev, ...upd]));
            })(),
            qrMode:
              updated.activeSession.qrMode === true ||
              prevSession.qrMode === true,
            rejectedFixes: prevSession.rejectedFixes || [],
          }
        : {}),
      locationMode:
        updated.activeSession.locationMode ||
        prevSession.locationMode ||
        "no_gps",
      sessionDuration:
        updated.activeSession.sessionDuration ||
        prevSession.sessionDuration ||
        300,
      pinRotationInterval:
        updated.activeSession.pinRotationInterval ||
        prevSession.pinRotationInterval ||
        30,
    };
  }
}

function getBestGpsPosition(timeoutMs = 8000, onProgress = null) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject({
        code: 2,
        message: "Geolocation is not supported by your browser.",
      });
      return;
    }

    let best = null;
    let watchId = null;
    let settled = false;

    const finish = (value, isError) => {
      if (settled) return;
      settled = true;
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (isError) reject(value);
      else resolve(value);
    };

    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (!best || pos.coords.accuracy < best.coords.accuracy) best = pos;
        if (typeof onProgress === "function") {
          onProgress(pos.coords.accuracy, pos);
        }
        if (pos.coords.accuracy <= 50) finish(pos, false);
      },
      (err) => {
        if (best) finish(best, false);
        else finish(err, true);
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );

    setTimeout(() => {
      if (best) finish(best, false);
      else
        finish(
          { code: 3, message: "GPS timed out before a usable lock." },
          true,
        );
    }, timeoutMs);
  });
}

// 🔁 BRAND MIGRATION — this app shipped as "Attendify" before the VeriPresenX
// rebrand, so existing users still hold their device UUID and theme under the
// old "attendify_*" keys. Read-through migration preserves that identity instead
// of silently minting a fresh device UUID (which the server's device lock would
// treat as a brand-new device) and resetting every user to the default theme.
function readLocalWithMigration(newKey, legacyKey) {
  try {
    const current = localStorage.getItem(newKey);
    if (current !== null) return current;
    const legacy = localStorage.getItem(legacyKey);
    if (legacy === null) return null;
    localStorage.setItem(newKey, legacy);
    localStorage.removeItem(legacyKey);
    return legacy;
  } catch (_) {
    return null; // private mode / storage disabled → treat as "no stored value"
  }
}

function getOrCreateDeviceId() {
  let deviceId = readLocalWithMigration(
    "veripresenx_device_uuid",
    "attendify_device_uuid",
  );
  if (!deviceId) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      deviceId = "dev_" + crypto.randomUUID().replace(/-/g, "");
    } else {
      deviceId =
        "dev_" +
        Math.random().toString(36).substring(2, 12) +
        Date.now().toString(36);
    }
    localStorage.setItem("veripresenx_device_uuid", deviceId);
  }
  return deviceId;
}

// G1: seed the server-minted device cookie (fire-and-forget) so check-ins
// carry an unforgeable identity anchor. Never blocks login.
async function seedServerDevice() {
  try {
    if (!auth.currentUser) return;
    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch("/api/session?action=registerDevice", {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}` },
    });
    const result = await response.json();
    if (result && result.deviceId && typeof result.deviceId === "string") {
      const key = "veripresenx_device_uuid";
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, result.deviceId);
      }
    }
  } catch (_) {
    /* non-fatal — check-in mints the cookie server-side anyway */
  }
}

// ============================================================
// HIDDEN FAIL-SAFE: 3-STRIKE MANUAL OVERRIDE TRACKER
// Consecutive automated check-in failures are counted silently and
// NEVER shown to the student. On the 3rd consecutive failure within
// the same session, the hidden "Request Manual Verification" escape
// hatch unlocks. A successful check-in wipes the counter instantly.
// ============================================================
const MANUAL_OVERRIDE_STRIKES_REQUIRED = 3;

function getFailureState(courseId) {
  try {
    const raw = localStorage.getItem(`veripresenx_failures_${courseId}`);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.count === "number"
      ? parsed
      : { count: 0, sessionKey: "" };
  } catch (e) {
    return { count: 0, sessionKey: "" };
  }
}

function setFailureState(courseId, state) {
  try {
    localStorage.setItem(
      `veripresenx_failures_${courseId}`,
      JSON.stringify(state),
    );
  } catch (e) {
    /* storage unavailable — the override simply stays locked */
  }
}

function currentSessionKey(courseId) {
  const session =
    activeCourse && activeCourse.id === courseId
      ? activeCourse.activeSession
      : null;
  return session && session.expiresAt
    ? String(session.expiresAt)
    : "no_session";
}

function recordCheckInFailure(courseId) {
  const sessionKey = currentSessionKey(courseId);
  const state = getFailureState(courseId);
  // A brand-new session silently resets the counter.
  const count = state.sessionKey === sessionKey ? state.count + 1 : 1;
  setFailureState(courseId, { count, sessionKey });
  if (count >= MANUAL_OVERRIDE_STRIKES_REQUIRED) {
    syncManualOverrideUI();
  }
}

function resetCheckInFailures(courseId) {
  setFailureState(courseId, {
    count: 0,
    sessionKey: currentSessionKey(courseId),
  });
  syncManualOverrideUI();
}

// Shows the escape hatch ONLY when: student view + 3 strikes this session.
// The strike count itself is never rendered anywhere.
function syncManualOverrideUI() {
  const wrap = document.getElementById("manualOverrideWrap");
  if (!wrap || !currentUser || !activeCourse) return;
  const studentControls = document.getElementById("studentControls");
  if (!studentControls || studentControls.classList.contains("hidden")) {
    wrap.classList.add("hidden");
    return;
  }
  const state = getFailureState(activeCourse.id);
  const unlocked =
    state.sessionKey === currentSessionKey(activeCourse.id) &&
    state.count >= MANUAL_OVERRIDE_STRIKES_REQUIRED;
  wrap.classList.toggle("hidden", !unlocked);
  if (unlocked) refreshIcons();
}

// Student submits a manual verification request (one per course, uid-keyed).
async function submitManualRequest() {
  if (!currentUser || !activeCourse || !auth.currentUser) return;
  const reasonInput = document.getElementById("manualReasonInput");
  const sendBtn = document.getElementById("sendManualRequestBtn");
  const statusEl = document.getElementById("manualRequestStatus");
  const reason = reasonInput ? reasonInput.value.trim() : "";
  if (!reason) {
    toast.warning(
      "Please type a short reason so your Rep knows what happened.",
    );
    return;
  }

  try {
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending...";
    }
    await setDoc(
      doc(
        db,
        "courses",
        activeCourse.id,
        "manualRequests",
        auth.currentUser.uid,
      ),
      {
        uid: auth.currentUser.uid,
        name: currentUser.name || "Student",
        matric: normalizeMatric(currentUser.matric),
        reason,
        status: "pending",
        sessionExpiresAt:
          activeCourse.activeSession && activeCourse.activeSession.expiresAt
            ? activeCourse.activeSession.expiresAt
            : null,
        requestedAt: serverTimestamp(),
      },
    );
    if (reasonInput) reasonInput.value = "";
    toast.success(
      "Request sent. Raise your hand so your Rep can see you.",
      "Manual Request Sent",
    );
    if (statusEl) {
      statusEl.classList.remove("hidden");
      statusEl.style.background = "rgba(253, 126, 20, 0.1)";
      statusEl.style.color = "#fd7e14";
      statusEl.textContent =
        "⏳ Request sent — waiting for your Rep to verify you.";
    }
  } catch (error) {
    console.error("Manual request error:", error);
    toast.error(error.message || "Could not send your request. Try again.");
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = '<i data-lucide="send"></i> Send Request to Rep';
      refreshIcons();
    }
  }
}

// --- DATA NORMALIZERS (v0 Fixes) ---
function normalizeMatric(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

// 🧑‍🎓 TRANSPARENCY DISPLAY RULE: "Name (MATRIC)" everywhere a human reads a
// list. Matric is the stable ID; names live on course members. Unknown names
// fall back to matric-only — never blank.
function nameForMatric(matric) {
  const norm = normalizeMatric(matric);
  if (!norm) return "";
  const rec =
    typeof activeCourse !== "undefined" &&
    activeCourse &&
    Array.isArray(activeCourse.members)
      ? activeCourse.members.find((m) => normalizeMatric(m.matric) === norm)
      : null;
  const nm = rec && rec.name ? String(rec.name).trim() : "";
  return nm ? `${nm} (${norm})` : norm;
}

// 🛡️ XSS DEFENCE — escape any string before it touches innerHTML.
// User-controlled values (matric, names, reasons, dates) flow through this
// helper so a crafted value like `<img src=x onerror=alert(1)>` renders as
// literal text instead of executing.
function escapeHTML(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function normalizeCourseCode(value) {
  const raw = String(value || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
  const match = raw.match(/^([A-Z]{2,5})(\d{3,4})$/);
  return match ? `${match[1]} ${match[2]}` : raw;
}

// --- DEFAULT THEME ICON SYNC ---
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("themeToggle");
  const htmlElement = document.documentElement;

  // 🎨 THEME PERSISTENCE — restore the saved theme before first paint.
  // Falls back to the HTML attribute default ("dark") if nothing is stored.
  // Uses the branded-key migration so a theme chosen pre-rebrand still applies.
  const savedTheme = readLocalWithMigration(
    "veripresenx_theme",
    "attendify_theme",
  );
  if (savedTheme === "light" || savedTheme === "dark") {
    htmlElement.setAttribute("data-theme", savedTheme);
  }

  if (themeToggle) {
    themeToggle.innerHTML =
      htmlElement.getAttribute("data-theme") === "dark"
        ? '<i data-lucide="sun"></i>'
        : '<i data-lucide="moon"></i>';
    refreshIcons();
  }
});

// --- HAMBURGER MENU LOGIC ---
const mobileMenuBtn = document.getElementById("mobileMenuBtn");
const navLinks = document.getElementById("navLinks");

if (mobileMenuBtn && navLinks) {
  mobileMenuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("show-menu");
    mobileMenuBtn.innerHTML = navLinks.classList.contains("show-menu")
      ? '<i data-lucide="x"></i>'
      : '<i data-lucide="menu"></i>';
    refreshIcons();
  });

  navLinks.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") {
      navLinks.classList.remove("show-menu");
      mobileMenuBtn.innerHTML = '<i data-lucide="menu"></i>';
      refreshIcons();
    }
  });
}

  // --- REAL-TIME FIRESTORE SYNC ---
  let unsubscribeCourses = null;
  // Map of courseId → unsubscribe function for per-course member listeners
  const memberListeners = {};

  function startMemberListener(courseId) {
    if (memberListeners[courseId]) return; // already listening
    memberListeners[courseId] = onSnapshot(
      collection(db, "courses", courseId, "members"),
      (snap) => {
        const members = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        const idx = courses.findIndex((c) => c.id === courseId);
        if (idx < 0) return;

        // Optimize: Check if member data actually changed
        const existingMembers = courses[idx].members || [];
        if (JSON.stringify(members) === JSON.stringify(existingMembers)) return;

        courses[idx] = {
          ...courses[idx],
          members,
          // Include rep role so rep counts in enrolled total and analytics
          enrolled: members
            .filter((m) => m.role === "student" || m.role === "rep")
            .map((m) => normalizeMatric(m.matric)),
          assistants: members
            .filter(
              (m) => m.role === "assistant" || m.role === "session_assistant",
            )
            .map((m) => normalizeMatric(m.matric)),
        };
        if (currentUser) {
          renderCourses();
          if (activeCourse && activeCourse.id === courseId) {
            applyPortalCourseUpdate(courses[idx]);
            renderPortalState();
          }
        }
      },
      (error) => console.error(`Member listener error (${courseId}):`, error),
    );
  }

  function stopAllMemberListeners() {
    Object.values(memberListeners).forEach((unsub) => unsub());
    Object.keys(memberListeners).forEach((k) => delete memberListeners[k]);
  }

  function startCourseListener() {
    if (unsubscribeCourses) return;
    unsubscribeCourses = onSnapshot(
      collection(db, "courses"),
      async (snapshot) => {
        const loadedCourses = await Promise.all(
          snapshot.docs.map(async (docSnap) => {
            const course = { id: docSnap.id, ...docSnap.data() };

            // If a member listener is already running for this course, it owns
            // the enrolled/assistants/members fields — don't overwrite them with
            // a one-time getDocs that may race against an in-flight transaction.
            if (memberListeners[docSnap.id]) {
              const existing = courses.find((c) => c.id === docSnap.id);
              startMemberListener(docSnap.id); // no-op since guard is already set
              return {
                ...course,
                members: existing ? existing.members : [],
                enrolled: existing ? existing.enrolled : [],
                assistants: existing ? existing.assistants : [],
              };
            }

            // First time seeing this course — do the initial members read
            const membersSnap = await getDocs(
              collection(db, "courses", docSnap.id, "members"),
            );
            const members = membersSnap.docs.map((memberSnap) => ({
              uid: memberSnap.id,
              ...memberSnap.data(),
            }));
            // Start a live listener for this course's members subcollection
            startMemberListener(docSnap.id);
            return {
              ...course,
              members,
              // Include rep role so rep counts in enrolled total and analytics
              enrolled: members
                .filter(
                  (member) =>
                    member.role === "student" || member.role === "rep",
                )
                .map((member) => normalizeMatric(member.matric)),
              assistants: members
                .filter(
                  (member) =>
                    member.role === "assistant" ||
                    member.role === "session_assistant",
                )
                .map((member) => normalizeMatric(member.matric)),
            };
          }),
        );

        // Optimize: Only update if courses actually changed
        if (JSON.stringify(loadedCourses) !== JSON.stringify(courses)) {
          courses = loadedCourses;
          if (currentUser) {
            renderCourses();
            if (activeCourse) {
              const updated = courses.find((c) => c.id === activeCourse.id);
              if (updated) {
                applyPortalCourseUpdate(updated);
                renderPortalState();
              }
            }
          }
        }
        // QR scan deep-link: a scanned ?code=&qrpin= link can only be routed
        // once the student's course list has loaded — try on every snapshot
        // until it resolves.
        tryHandlePendingQrScan();
      },
      (error) => {
        console.error("Course listener error:", error);
        if (courseGrid) {
          courseGrid.innerHTML = `<p style="color: var(--danger);">⚠️ Couldn't load your courses. Check your connection and try refreshing.</p>`;
        }
      },
    );
  }

  function stopCourseListener() {
    if (unsubscribeCourses) {
      unsubscribeCourses();
      unsubscribeCourses = null;
    }
    stopAllMemberListeners();
  }

  // --- THEME TOGGLE LOGIC ---
  const themeToggleBtn = document.getElementById("themeToggle");
  const htmlElement = document.documentElement;
  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const currentTheme = htmlElement.getAttribute("data-theme");
      const newTheme = currentTheme === "light" ? "dark" : "light";
      htmlElement.setAttribute("data-theme", newTheme);
      localStorage.setItem("veripresenx_theme", newTheme);
      themeToggleBtn.innerHTML =
        newTheme === "dark"
          ? '<i data-lucide="sun"></i>'
          : '<i data-lucide="moon"></i>';
      refreshIcons();
    });
  }

  // --- AUTOCOMPLETE DATA & LOGIC ---
  const NIGERIAN_INSTITUTIONS = [
    "University of Ilorin (UNILORIN)",
    "University of Ibadan (UI)",
    "University of Lagos (UNILAG)",
    "Obafemi Awolowo University (OAU)",
    "Ahmadu Bello University (ABU)",
    "University of Nigeria, Nsukka (UNN)",
    "University of Benin (UNIBEN)",
    "University of Port Harcourt (UNIPORT)",
    "Bayero University Kano (BUK)",
    "University of Calabar (UNICAL)",
    "Federal University of Technology, Akure (FUTA)",
    "Federal University of Technology, Minna (FUTMINNA)",
    "Federal University of Technology, Owerri (FUTO)",
    "University of Jos (UNIJOS)",
    "University of Maiduguri (UNIMAID)",
    "Usmanu Danfodiyo University Sokoto (UDUS)",
    "Nnamdi Azikiwe University (UNIZIK)",
    "Ladoke Akintola University of Technology (LAUTECH)",
    "Federal University of Agriculture, Abeokuta (FUNAAB)",
    "University of Uyo (UNIUYO)",
    "Ekiti State University (EKSU)",
    "Lagos State University (LASU)",
    "Rivers State University (RSU)",
    "Delta State University (DELSU)",
    "Ambrose Alli University (AAU)",
    "Enugu State University of Science and Technology (ESUT)",
    "Kaduna State University (KASU)",
    "Kano University of Science and Technology (KUST)",
    "Imo State University (IMSU)",
    "Abia State University (ABSU)",
    "Benue State University (BSU)",
    "Kogi State University (KSU)",
    "Niger State Polytechnic",
    "Ondo State University of Science and Technology (OSUSTECH)",
    "Osun State University (UNIOSUN)",
    "Plateau State University",
    "Taraba State University",
    "Covenant University",
    "Babcock University",
    "Bowen University",
    "Afe Babalola University (ABUAD)",
    "Bells University of Technology",
    "Pan-Atlantic University",
    "Landmark University",
    "Redeemer's University",
    "American University of Nigeria (AUN)",
    "Igbinedion University",
    "Elizade University",
    "Crawford University",
    "Caleb University",
    "Lead City University",
    "Al-Hikmah University",
    "Adeleke University",
    "Chrisland University",
    "Veritas University",
    "Yaba College of Technology (YABATECH)",
    "The Polytechnic, Ibadan",
    "Federal Polytechnic, Nekede",
    "Federal Polytechnic, Ilaro",
    "Kaduna Polytechnic (KADPOLY)",
    "Auchi Polytechnic",
    "Federal Polytechnic, Offa",
    "Rufus Giwa Polytechnic",
    "Moshood Abiola Polytechnic (MAPOLY)",
    "Lagos State Polytechnic (LASPOTECH)",
    "Federal College of Education (Technical)",
    "Federal University Oye-Ekiti (FUOYE)",
    "Federal University Dutse (FUD)",
    "Federal University Lokoja (FULOKOJA)",
    "Federal University Dutsin-Ma (FUDMA)",
    "Michael Okpara University of Agriculture (MOUAU)",
    "University of Agriculture, Makurdi",
    "Modibbo Adama University (MAU)",
    "Abubakar Tafawa Balewa University (ATBU)",
  ];

  const NIGERIAN_DEPARTMENTS = [
    "Computer Science",
    "Geology",
    "Geophysics",
    "Civil Engineering",
    "Electrical Engineering",
    "Mechanical Engineering",
    "Chemical Engineering",
    "Petroleum Engineering",
    "Mining Engineering",
    "Agricultural Engineering",
    "Biomedical Engineering",
    "Architecture",
    "Estate Management",
    "Quantity Surveying",
    "Urban and Regional Planning",
    "Building Technology",
    "Surveying and Geoinformatics",
    "Physics",
    "Chemistry",
    "Biochemistry",
    "Microbiology",
    "Botany",
    "Zoology",
    "Mathematics",
    "Statistics",
    "Industrial Chemistry",
    "Biology",
    "Environmental Science",
    "Accounting",
    "Banking and Finance",
    "Business Administration",
    "Economics",
    "Marketing",
    "Insurance",
    "Actuarial Science",
    "Public Administration",
    "Political Science",
    "Mass Communication",
    "Sociology",
    "Psychology",
    "Criminology",
    "International Relations",
    "Medicine and Surgery",
    "Nursing Science",
    "Pharmacy",
    "Physiology",
    "Anatomy",
    "Medical Laboratory Science",
    "Physiotherapy",
    "Public Health",
    "Dentistry",
    "Radiography",
    "Law",
    "English Language",
    "History and International Studies",
    "Theatre Arts",
    "Linguistics",
    "Philosophy",
    "Religious Studies",
    "French",
    "Library and Information Science",
    "Education",
    "Guidance and Counselling",
    "Human Kinetics and Health Education",
    "Agricultural Economics",
    "Animal Science",
    "Crop Science",
    "Soil Science",
    "Forestry and Wildlife",
    "Fisheries and Aquaculture",
    "Food Science and Technology",
    "Home Science and Management",
  ];

  const ACADEMIC_LEVELS = [
    "ND 1",
    "ND 2",
    "HND 1",
    "HND 2",
    "100 Level",
    "200 Level",
    "300 Level",
    "400 Level",
    "500 Level",
    "600 Level",
  ];

  function setupAutocomplete(inputId, suggestionsId, dataList) {
    const input = document.getElementById(inputId);
    const box = document.getElementById(suggestionsId);
    if (!input || !box) return;

    function renderMatches() {
      const query = input.value.trim().toLowerCase();
      box.innerHTML = "";

      if (!query) {
        box.classList.add("hidden");
        return;
      }

      const matches = dataList
        .filter((item) => item.toLowerCase().includes(query))
        .slice(0, 8);
      if (matches.length === 0) {
        box.classList.add("hidden");
        return;
      }

      matches.forEach((match) => {
        const item = document.createElement("div");
        item.className = "suggestion-item";
        item.textContent = match;
        item.addEventListener("mousedown", (e) => {
          e.preventDefault();
          input.value = match;
          box.classList.add("hidden");
          box.innerHTML = "";
        });
        box.appendChild(item);
      });

      box.classList.remove("hidden");
    }

    input.addEventListener("input", renderMatches);
    input.addEventListener("focus", () => {
      if (input.value.trim()) renderMatches();
    });
    input.addEventListener("blur", () => {
      setTimeout(() => box.classList.add("hidden"), 100);
    });
  }

  setupAutocomplete(
    "signupInstitution",
    "institutionSuggestions",
    NIGERIAN_INSTITUTIONS,
  );
  setupAutocomplete(
    "signupDepartment",
    "departmentSuggestions",
    NIGERIAN_DEPARTMENTS,
  );
  setupAutocomplete("signupLevel", "levelSuggestions", ACADEMIC_LEVELS);

  // --- INPUT MASKS ---
  function maskCourseCodeInput(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const raw = el.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const letters = raw.slice(0, 3).replace(/[0-9]/g, "");
      const numbers = raw
        .slice(letters.length)
        .replace(/[^0-9]/g, "")
        .slice(0, 3);
      el.value = numbers ? `${letters} ${numbers}` : letters;
    });
  }

  function maskMatricInput(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener("input", () => {
      const cursor = el.selectionStart;
      el.value = el.value.toUpperCase();
      el.setSelectionRange(cursor, cursor);
    });
  }

  maskCourseCodeInput("courseCodeInput");
  maskCourseCodeInput("joinCode");
  maskMatricInput("signupMatric");
  maskMatricInput("settingsMatric");

  const authContainer = document.getElementById("authContainer");
  const signupCard = document.getElementById("signupCard");
  const loginCard = document.getElementById("loginCard");
  const dashboardSection = document.getElementById("dashboardSection");
  const displayName = document.getElementById("displayName");
  const displayMatric = document.getElementById("displayMatric");
  const logoutBtn = document.getElementById("logoutBtn");
  const openSettingsBtn = document.getElementById("openSettingsBtn");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");

  const showLoginBtn = document.getElementById("showLogin");
  if (showLoginBtn) {
    showLoginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showAuthView("login");
    });
  }

  const showSignupBtn = document.getElementById("showSignup");
  if (showSignupBtn) {
    showSignupBtn.addEventListener("click", (e) => {
      e.preventDefault();
      showAuthView("picker");
    });
  }

  // --- PHASE 2: ROLE PICKER — browse free, lock only on signup success ---
  // pendingRole is just a *draft intention* (signup subtitle + rep checkbox).
  // It NEVER persists and NEVER locks anything until createUser succeeds.
  let pendingRole = null;
  const rolePicker = document.getElementById("rolePicker");
  const roleTrack = document.getElementById("roleTrack");
  const roleCards = rolePicker ? Array.from(rolePicker.querySelectorAll(".role-card")) : [];
  const roleDots = Array.from(document.querySelectorAll(".role-dot"));
  const rolePrev = document.getElementById("rolePrev");
  const roleNext = document.getElementById("roleNext");
  const roleContextBanner = document.getElementById("roleContextBanner");
  const roleContextText = document.getElementById("roleContextText");
  const signupTitle = document.getElementById("signupTitle");
  const signupSubtitle = document.getElementById("signupSubtitle");

  // 🔑 A verified adviser holds role "level_anchor", NOT "adviser" (see
  // utils/roles.js). The old map had no level_anchor key, so every verified
  // adviser rendered as the raw string "level_anchor" in the header and in the
  // settings profile. The unverified pending value stays listed so those
  // applicants see "Level Adviser — verification pending" rather than nothing.
  const ROLE_LABEL = {
    student: "Regular Student",
    rep: "Course Rep",
    adviser: "Level Adviser (pending)",
    level_anchor: "Level Adviser",
  };
  const ROLE_SUB = {
    adviser: "Staff verification first — then import your level roster.",
    rep: "Your adviser must have picked you — otherwise you join as a student.",
    student: "Join your courses and check in. Device-locked, real-time.",
  };

  function setActiveRoleCard(index) {
    roleCards.forEach((c, i) => c.classList.toggle("active", i === index));
    roleDots.forEach((d, i) => d.classList.toggle("active", i === index));
  }

  function activeRoleIndex() {
    if (!roleTrack || roleCards.length === 0) return 0;
    let best = 0, bestDist = Infinity;
    const center = roleTrack.scrollLeft + roleTrack.clientWidth / 2;
    roleCards.forEach((c, i) => {
      const dist = Math.abs(c.offsetLeft + c.offsetWidth / 2 - center);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    return best;
  }

  function scrollRoleTo(index) {
    if (!roleTrack || !roleCards[index]) return;
    const c = roleCards[index];
    roleTrack.scrollTo({ left: c.offsetLeft - (roleTrack.clientWidth - c.offsetWidth) / 2, behavior: "smooth" });
    setActiveRoleCard(index);
  }

  if (roleTrack) {
    let raf = null;
    roleTrack.addEventListener("scroll", () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = null; setActiveRoleCard(activeRoleIndex()); });
    }, { passive: true });
    setActiveRoleCard(window.innerWidth >= 900 ? 1 : 0);
  }

  if (rolePrev) rolePrev.addEventListener("click", () => scrollRoleTo(Math.max(0, activeRoleIndex() - 1)));
  if (roleNext) roleNext.addEventListener("click", () => scrollRoleTo(Math.min(roleCards.length - 1, activeRoleIndex() + 1)));
  roleDots.forEach((d) => d.addEventListener("click", () => scrollRoleTo(Number(d.dataset.dot || 0))));

  function applyRoleToForm() {
    // pendingRole: 'adviser' | 'rep' | 'student' | null (generic fallback).
    // Card is the ONLY distinction: checkbox is gone.
    const isAdviser = pendingRole === "adviser";
    const isStudentLike = pendingRole === "rep" || pendingRole === "student";
    document.querySelectorAll(".role-adviser-only").forEach((el) => el.classList.toggle("hidden", !isAdviser));
    document.querySelectorAll(".role-student-only").forEach((el) => el.classList.toggle("hidden", !isStudentLike));
    document.querySelectorAll(".role-generic-only").forEach((el) => el.classList.toggle("hidden", isAdviser || isStudentLike));
    const label = ROLE_LABEL[pendingRole] || "Account";
    if (roleContextBanner) roleContextBanner.classList.toggle("hidden", !pendingRole);
    if (roleContextText && pendingRole) roleContextText.textContent = "Joining as " + label;
    if (signupTitle) signupTitle.textContent = pendingRole ? "Join as " + label : "Create Account";
    if (signupSubtitle) signupSubtitle.textContent = (pendingRole && ROLE_SUB[pendingRole]) || "Sign up to start managing or joining classes.";
    const emailLabel = document.getElementById("signupEmailLabel");
    if (emailLabel) emailLabel.textContent = isAdviser ? "School Email" : "Email Address";
    const submitLabel = document.getElementById("signupSubmitLabel");
    if (submitLabel) submitLabel.textContent = pendingRole ? "Join as " + label : "Sign Up";
    refreshIcons();
  }

  function showAuthView(view, role) {
    if (rolePicker) rolePicker.classList.toggle("hidden", view !== "picker");
    signupCard.classList.toggle("hidden", view !== "signup");
    loginCard.classList.toggle("hidden", view !== "login");
    if (view === "signup") {
      if (role && ROLE_LABEL[role]) pendingRole = role; // draft only — safe to change
      // A signup view is meant to be reached through a role card, but if any
      // path ever lands here with no role we fall back to "student" rather
      // than null. With null, applyRoleToForm() hides EVERY role-specific field
      // and shows only the generic "Full Name" box, while the submit handler
      // still defaults to the student path and demands first/middle/last +
      // matric — a form the user can see but can never satisfy.
      else if (!ROLE_LABEL[pendingRole]) pendingRole = "student";
      applyRoleToForm();
    }
    refreshIcons();
  }

  document.querySelectorAll("[data-go-role]").forEach((btn) => {
    btn.addEventListener("click", () => showAuthView("signup", btn.dataset.goRole));
  });
  // Tapping a card (not its button) just brings it into focus — still no lock.
  roleCards.forEach((card, i) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-go-role]")) return;
      scrollRoleTo(i);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); scrollRoleTo(i); }
    });
  });

  const backToRoles = document.getElementById("backToRolesFromSignup");
  if (backToRoles) backToRoles.addEventListener("click", () => showAuthView("picker"));
  const backToRolesLogin = document.getElementById("backToRolesFromLogin");
  if (backToRolesLogin) backToRolesLogin.addEventListener("click", () => showAuthView("picker"));
  const changeRoleBtn = document.getElementById("changeRoleBtn");
  if (changeRoleBtn) changeRoleBtn.addEventListener("click", () => showAuthView("picker"));
  const showLoginFromPicker = document.getElementById("showLoginFromPicker");
  if (showLoginFromPicker) showLoginFromPicker.addEventListener("click", (e) => { e.preventDefault(); showAuthView("login"); });

  function checkAuth() {
    if (currentUser) {
      replaceNavState("dashboard");
      authContainer.classList.add("hidden");
      dashboardSection.classList.remove("hidden");
      logoutBtn.classList.remove("hidden");
      if (openSettingsBtn) openSettingsBtn.classList.remove("hidden");

      displayName.textContent = currentUser.name;
      // Advisers have NO matric — the trust chain keys them on
      // institution/department/level, not a student number. Assigning the raw
      // `null` to textContent renders the literal string "null" in the
      // dashboard greeting, so branch on it and show the role instead.
      if (displayMatric) {
        const hasMatric = Boolean(currentUser.matric);
        displayMatric.textContent = hasMatric
          ? currentUser.matric
          : ROLE_LABEL[currentUser.role] || "Member";
        const matricLabel = document.getElementById("displayMatricLabel");
        if (matricLabel) {
          matricLabel.textContent = hasMatric ? "Matric No:" : "Role:";
        }
      }

      const displaySchoolInfo = document.getElementById("displaySchoolInfo");
      if (displaySchoolInfo) {
        displaySchoolInfo.textContent = `${currentUser.institution || "GEN"} • ${currentUser.department || "GEN"} • ${currentUser.level || "GEN"}`;
      }

      const openCreateModalBtn = document.getElementById("openCreateModal");
      if (openCreateModalBtn) {
        // 🔒 Assistants help run THEIR appointed course only — they never get
        // course-creation powers anywhere else. Only true reps can create.
        if (currentUser.isRep) {
          openCreateModalBtn.classList.remove("hidden");
        } else {
          openCreateModalBtn.classList.add("hidden");
        }
      }

      renderCourses();
    } else {
      replaceNavState("auth");
      authContainer.classList.remove("hidden");
      dashboardSection.classList.add("hidden");
      logoutBtn.classList.add("hidden");
      if (openSettingsBtn) openSettingsBtn.classList.add("hidden");
      // Default landing for logged-out users is the role picker (browse free).
      // Login/signup are one tap away; nothing locks until signup succeeds.
      if (typeof showAuthView === "function") showAuthView("picker");
      else { signupCard.classList.add("hidden"); loginCard.classList.add("hidden"); if (rolePicker) rolePicker.classList.remove("hidden"); }
    }
  }

  // --- FIREBASE AUTHENTICATION LOGIC ---
  const signupForm = document.getElementById("signupForm");
  if (signupForm) {
    signupForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = signupForm.querySelector("button[type='submit']");
      // Role comes ONLY from the card (pendingRole). Checkbox is gone.
      const signedRole = pendingRole === "adviser" ? "adviser" : pendingRole === "rep" ? "rep" : "student";
      const isAdviserSignup = signedRole === "adviser";
      const isRepSignup = signedRole === "rep";

      // Name handling per role
      let name = "";
      let firstName = "", middleName = "", lastName = "";
      if (isAdviserSignup) {
        firstName = document.getElementById("adviserFirstName").value.trim();
        lastName = document.getElementById("adviserLastName").value.trim();
        if (!firstName || !lastName) { toast.error("Please enter your first and last name.", "Missing name"); return; }
        name = firstName + " " + lastName;
      } else if (signedRole === "rep" || signedRole === "student") {
        firstName = document.getElementById("signupFirstName").value.trim();
        middleName = document.getElementById("signupMiddleName").value.trim();
        lastName = document.getElementById("signupLastName").value.trim();
        if (!firstName || !lastName) { toast.error("Please enter your first and last name.", "Missing name"); return; }
        name = [firstName, middleName, lastName].filter(Boolean).join(" ");
      } else {
        name = document.getElementById("signupName").value.trim();
        if (!name) { toast.error("Please enter your full name.", "Missing name"); return; }
      }

      // Matric: required for rep/student, hidden & skipped for adviser
      let matric = "";
      if (!isAdviserSignup) {
        matric = normalizeMatric(document.getElementById("signupMatric").value);
        if (!matric) { toast.error("Please enter your matric number.", "Missing matric"); return; }
      }
      const email = document
        .getElementById("signupEmail")
        .value.trim()
        .toLowerCase();
      if (!email) { toast.error("Please enter your " + (isAdviserSignup ? "school email." : "email address."), "Missing email"); return; }
      const password = document.getElementById("signupPassword").value;
      const passwordConfirm = document.getElementById("signupPasswordConfirm").value;
      if (!password || password.length < 6) { toast.error("Password must be at least 6 characters.", "Weak password"); return; }
      if (password !== passwordConfirm) { toast.error("Passwords do not match. Please retype.", "Password mismatch"); return; }
      const isRep = isRepSignup; // card decides, not a checkbox

      const institutionInput = document.getElementById("signupInstitution");
      const departmentInput = document.getElementById("signupDepartment");
      const levelInput = document.getElementById("signupLevel");

      const institution = institutionInput
        ? institutionInput.value.trim().toUpperCase()
        : "GENERAL";
      const department = departmentInput
        ? departmentInput.value.trim()
        : "GENERAL";
      const level = levelInput
        ? levelInput.value.trim().toUpperCase()
        : "GENERAL";
      if (!institution || !department || !level || institution === "GENERAL" || department === "GENERAL" || level === "GENERAL") {
        toast.error("Please fill Institution, Department and Level.", "Missing details"); return;
      }

      // 🛑 DOUBLE-CHECK GATE: the form does NOT create anything yet. First the
      // user reviews every value they entered and explicitly confirms. Their
      // matric number is shown as locked because it becomes their permanent
      // identity across courses and can NEVER be changed after signup.
      const confirmDetails = [
        { label: "Full Name", value: name },
      ];
      if (!isAdviserSignup) {
        confirmDetails.push({
          label: "🔒 Matric Number",
          value: `${matric} (permanent — cannot be changed)`,
        });
      }
      confirmDetails.push(
        { label: "Institution", value: institution },
        { label: "Department", value: department },
        { label: "Level", value: level },
        { label: isAdviserSignup ? "School Email" : "Email", value: email },
        { label: "Account Type", value: ROLE_LABEL[signedRole] || signedRole },
      );
      const confirmMessage = isAdviserSignup
        ? "Please double-check everything below. You are joining as a Level Adviser — email verification comes next."
        : "Please double-check everything below. Your matric number is PERMANENT — it cannot be changed after signup.";
      const confirmed = await showConfirm({
        title: "Confirm Your Details",
        message: confirmMessage,
        okText: "Yes, Create Account",
        cancelText: "No, Let Me Fix It",
        danger: false,
        icon: "📝",
        details: confirmDetails,
      });
      if (!confirmed) return; // form stays filled so they can correct and retry

      isCreatingAccount = true; // 🔒 LOCK THE BLOCKER
      let signupSucceeded = false;

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML =
            '<i data-lucide="loader" class="lucide-spin" style="margin-right:6px; vertical-align:-3px;"></i> Creating Account...';
          refreshIcons();
        }

        const userCredential = await createUserWithEmailAndPassword(
          auth,
          email,
          password,
        );
        const uid = userCredential.user.uid;

        // 🔒 PHASE 5: the profile is written by the SERVER, not here.
        //
        // This used to claim `departmentReps/{rep_INST_DEPT_LEVEL}` on the
        // client and then setDoc the profile, which meant the rep badge was won
        // by whoever signed up first — a race, not a decision. The server now
        // checks this matric against `chosenRepMatric` on the level roster and
        // writes whatever role is actually warranted, so the client's request
        // is a REQUEST and never a grant.
        //
        // A rep refusal is NOT a failure: the account is created as a student
        // and the response says so.
        let signup = null;
        try {
          const idToken = await userCredential.user.getIdToken();
          const res = await fetch("/api/onboarding?action=createProfile", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              role: signedRole,
              name,
              firstName: firstName || "",
              middleName: middleName || "",
              lastName: lastName || "",
              matric: matric || "",
              institution,
              department,
              level,
              email,
            }),
          });
          signup = await res.json();
          if (!res.ok) {
            throw new Error(
              (signup && signup.error) || "Unable to create your account profile.",
            );
          }
        } catch (apiErr) {
          // The Auth account exists but has no profile, and a profile-less
          // account is a "ghost" that handleAuthState() refuses. Removing the
          // Auth user keeps the two in step.
          try {
            await userCredential.user.delete();
          } catch (_) {
            /* best effort — the ghost is also caught on next sign-in */
          }
          throw apiErr;
        }

        // 🛑 The account is real and the profile is on disk. THIS flag is what
        // the `finally` block below needs to re-run handleAuthState() by hand:
        // onAuthStateChanged() swallowed the only auth event (isCreatingAccount
        // was still locked) and Firebase never fires it again. Without this
        // assignment a brand-new user sits on the auth screen forever.
        signupSucceeded = true;
        signupForm.reset();

        // --- PHASE 3: ADVISER EMAIL VERIFICATION (Firebase built-in link) ---
        // Pilot path: the adviser signs up with their school email and we send
        // Firebase's own verification link. The link only proves INBOX OWNERSHIP.
        // It does NOT promote the account: `role` stays "adviser" and
        // `verificationStatus` stays "pending_email" until api/verification.js
        // runs the 6-digit code check, claims the adviserSlots row and writes
        // role: "level_anchor". So we must NOT tell the user their access has
        // unlocked here — that promise was never backed by any code.
        // NIN stays a disabled placeholder (index.html) until after the pilot.
        if (isAdviserSignup) {
          try {
            await sendEmailVerification(userCredential.user);
            toast.info(
              "Account created. We sent a verification link to your school email — click it to prove the address is yours. Adviser tools stay locked until that check passes.",
              "Verify your school email 📧",
            );
          } catch (verifyErr) {
            console.warn("Adviser verification email failed:", verifyErr);
            toast.warning(
              "Account created, but the verification email could not be sent. Log in later and use \"Resend verification\".",
              "Check your inbox",
            );
          }
        } else if (signup && signup.repRequest) {
          // 🔒 PHASE 5: they asked for the rep card and the server said no.
          // Say exactly why, so "why am I not the rep?" is never a mystery.
          const why = {
            NO_ROSTER:
              "Your Level Adviser has not imported this level's roster yet. Ask them to import it, then sign in again.",
            NO_REP_CHOSEN:
              "Your Level Adviser has not chosen a course rep for this level yet. Ask them to pick one, then sign in again.",
            NOT_THE_CHOSEN_REP:
              "You're enrolled as a student. Your Level Adviser hasn't selected you as the course rep — only the student they name gets that role.",
          };
          toast.info(
            why[signup.repRequest.reason] ||
              "You're enrolled as a student. Only the rep your Level Adviser chooses gets the rep role.",
            "Enrolled as a student 👨‍🎓",
          );
        } else if (signup && signup.rosterStatus === "unverified") {
          // 🔒 PHASE 6: the account is real, but this matric is not on the
          // level roster the adviser imported. Say so and name the next step —
          // never leave "why isn't my attendance counting?" unexplained.
          const why = {
            NO_ROSTER:
              "Your Level Adviser hasn't imported this level's roster yet. Ask them to import it and check back.",
            NOT_ON_ROSTER:
              "Your matric isn't on the level roster your adviser imported. Ask your course rep to approve you, or ask your adviser to re-import the list.",
          };
          toast.info(
            why[signup.rosterReason] ||
              "Your matric isn't on the level roster yet. Ask your course rep to approve you.",
            "Account created — awaiting roster check",
          );
        } else {
          toast.success(
            "Your account is ready. Welcome to VeriPresenX!",
            "Account Created 🎉",
          );
        }
        // The account now owns its role, so the picker is done for this session.
        pendingRole = null;
      } catch (error) {
        console.error("Signup error:", error);
        toast.error(error.message, "Something went wrong");
      } finally {
        isCreatingAccount = false; // 🔓 UNLOCK THE BLOCKER NO MATTER WHAT
        if (signupSucceeded && auth.currentUser) {
          // Firebase fired the auth-state event while the blocker was still
          // locked, the listener swallowed it, and it never fires again —
          // so re-run the bootstrap manually or the fresh user idles on the
          // auth screen forever (the "post-signup limbo").
          handleAuthState(auth.currentUser);
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          // Re-apply the role context instead of hardcoding a label: the previous
          // `'...> Sign Up'` reset every role-specific field visibility and
          // clobbered the "Join as Course Rep" button text.
          applyRoleToForm();
        }
      }
    });
  }

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = loginForm.querySelector("button[type='submit']");
      const email = document
        .getElementById("loginEmail")
        .value.trim()
        .toLowerCase();
      const password = document.getElementById("loginPassword").value;

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Logging in... ⏳";
        }

        await signInWithEmailAndPassword(auth, email, password);
        loginForm.reset();
      } catch (error) {
        console.error("Login error:", error);
        toast.error(
          "Invalid email or password. Please check your credentials.",
          "Login Failed",
        );
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Log In 🔓";
        }
      }
    });
  }

  // 🛡️ v0 Logout Fix: Let onAuthStateChanged handle UI updates cleanly
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        await signOut(auth);
      } catch (error) {
        console.error("Logout error:", error);
        toast.error("Unable to log out. Please try again.");
      }
    });
  }

  // Auth bootstrap for every state transition. Extracted from the
  // onAuthStateChanged callback so the signup flow can re-run it manually
  // (see the signup finally block — the "post-signup limbo" fix).
  const handleAuthState = async (user) => {
    if (user) {
      const userDoc = await getDoc(doc(db, "users", user.uid));

      if (userDoc.exists()) {
        currentUser = userDoc.data();
        startCourseListener();
        startNotificationsListener();
        checkAuth();
        // G1: seed the server-minted device cookie (fire-and-forget) so
        // check-ins carry an unforgeable identity anchor.
        seedServerDevice();
        // Phase 4: reveal the roster dashboard only for a VERIFIED adviser.
        syncAdviserDashboard();
      } else {
        console.warn("Ghost user blocked: No Firestore profile found.");
        toast.error(
          "Your account data could not be found. It may have been deleted.",
          "Access Denied",
        );
        await signOut(auth);
        currentUser = null;
        checkAuth();
      }
    } else {
      currentUser = null;
      if (portalSection) portalSection.classList.add("hidden");
      hideAllManagementPanels();
      const mgmtToolbarOut = document.getElementById("managementToolbar");
      if (mgmtToolbarOut) mgmtToolbarOut.classList.add("hidden");
      if (typeof syncDrawerTabVisibility === "function") {
        syncDrawerTabVisibility();
      }

      activeCourse = null;
      if (countdownInterval) clearInterval(countdownInterval);
      stopPortalListeners();

      stopCourseListener();
      checkAuth();
      // Phase 4: the roster dashboard is adviser-only, so it goes on sign-out.
      syncAdviserDashboard();
    }
  };

  // Phase 4: wire the dashboard's controls once the DOM is available. The
  // handlers themselves re-check authorisation on every call, so a panel that
  // is somehow left visible still cannot write anything.
  initAdviserDashboard();

  onAuthStateChanged(auth, (user) => {
    if (isCreatingAccount) return; // 🛑 Ignore during active registration sequence!
    handleAuthState(user);
  });

  if (deleteAccountBtn) {
    deleteAccountBtn.addEventListener("click", async () => {
      if (
        await showConfirm({
          title: "Delete Account",
          message:
            "This will permanently delete your account, remove you from all courses, and release your matric number. This cannot be undone.",
          okText: "Yes, Delete",
          cancelText: "Keep Account",
          icon: "🗑️",
          danger: true,
        })
      ) {
        try {
          const idToken = await auth.currentUser.getIdToken();

          const response = await fetch("/api/account?action=deleteAccount", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
          });

          if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            throw new Error(result.error || "Server error during deletion.");
          }

          localStorage.removeItem("veripresenx_device_uuid");
          localStorage.removeItem("veripresenx_theme");
          // Clear any pre-rebrand keys too, in case this device never triggered
          // a read-through migration before the account was deleted.
          localStorage.removeItem("attendify_device_uuid");
          localStorage.removeItem("attendify_theme");

          toast.info(
            "Your account has been deleted. Goodbye! 👋",
            "Account Deleted",
          );

          // Redirect to auth screen after a short delay
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        } catch (error) {
          console.error("Delete account error:", error);
          toast.error(
            "Something went wrong while deleting your account. Please check your connection.",
            "Delete Failed",
          );
        }
      }
    });
  }

  // --- MODALS & CLOSE HANDLERS ---
  const createModal = document.getElementById("createModal");
  const joinModal = document.getElementById("joinModal");
  const forgotModal = document.getElementById("forgotModal");
  const guideModal = document.getElementById("guideModal");
  const settingsModal = document.getElementById("settingsModal");
  const openGuideBtn = document.getElementById("openGuideBtn");

  const openCreateModalBtn = document.getElementById("openCreateModal");
  if (openCreateModalBtn) {
    openCreateModalBtn.addEventListener("click", () => {
      if (createModal) createModal.classList.add("show");
    });
  }

  const openJoinModalBtn = document.getElementById("openJoinModal");
  if (openJoinModalBtn) {
    openJoinModalBtn.addEventListener("click", () => {
      if (joinModal) joinModal.classList.add("show");
    });
  }

  const openForgotModalBtn = document.getElementById("openForgotModal");
  if (openForgotModalBtn) {
    openForgotModalBtn.addEventListener("click", (e) => {
      e.preventDefault();
      if (forgotModal) forgotModal.classList.add("show");
    });
  }

  document.querySelectorAll(".close-modal").forEach((btn) => {
    btn.addEventListener("click", () => {
      const parentModal = btn.closest(".modal");
      if (parentModal) parentModal.classList.remove("show");
    });
  });

  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("show");
    });
  });

  if (openGuideBtn && guideModal) {
    openGuideBtn.addEventListener("click", () => {
      guideModal.classList.add("show");
    });
  }

  // --- ACCOUNT SETTINGS MODAL ---
  const settingsForm = document.getElementById("settingsForm");

  if (openSettingsBtn && settingsModal) {
    openSettingsBtn.addEventListener("click", () => {
      if (!currentUser) return;
      const settingsNameInput = document.getElementById("settingsName");
      const settingsMatricInput = document.getElementById("settingsMatric");
      const settingsLevelInput = document.getElementById("settingsLevel"); // NEW

      if (settingsNameInput) settingsNameInput.value = currentUser.name || "";
      if (settingsMatricInput)
        settingsMatricInput.value = currentUser.matric || "";
      if (settingsLevelInput)
        settingsLevelInput.value = currentUser.level || ""; // NEW

      settingsModal.classList.add("show");
    });
  }

  if (settingsForm) {
    settingsForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = settingsForm.querySelector("button[type='submit']");
      const newName = document.getElementById("settingsName").value.trim();
      const newMatric = normalizeMatric(
        document.getElementById("settingsMatric").value,
      );
      const newLevel = document.getElementById("settingsLevel")
        ? document.getElementById("settingsLevel").value
        : currentUser.level || "GENERAL"; // NEW

      // Advisers carry NO matric (matric is null on their profile), so the
      // matric field is legitimately empty for them. The old guard required a
      // matric for EVERY account, which made the settings form a silent no-op
      // for advisers — it returned with no toast and no error, looking frozen.
      // Matric is also readonly in the DOM, so it can never actually change;
      // we must NOT send it back, because writing `matric: ""` over a stored
      // `null` fails the rules' `matric == resource.data.matric` check and the
      // whole save is rejected with permission-denied.
      // ⚠️ This must be the ROLE, never the presence of a matric. Inferring
      // "adviser" from `!matric` was wrong twice over: a student who somehow
      // saved a blank matric would be treated as staff, and a verified adviser
      // (role "level_anchor", no matric) needed the same branch. Role is the
      // authoritative field — see utils/roles.js.
      const isAdviserAccount =
        currentUser && (currentUser.role === "adviser" || currentUser.role === "level_anchor");
      if (!newName || !currentUser || !auth.currentUser) return;
      if (!newMatric && !isAdviserAccount) {
        toast.error("Your matric number is missing. Please contact support.", "Profile Error");
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Saving... ⏳";
        }

        const oldMatric = normalizeMatric(currentUser.matric);
        const uid = auth.currentUser.uid;

        // Update name, matric, and level in database.
        // `matric` is only sent for accounts that actually have one. Advisers
        // store `null`, and writing `""` over it would violate the rules'
        // `matric == resource.data.matric` pin and fail the entire update.
        const profilePatch = { name: newName, level: newLevel };
        if (newMatric) profilePatch.matric = newMatric;
        await updateDoc(doc(db, "users", uid), profilePatch);

        // Note: matric changes no longer propagate into courses' enrolled[]/
        // assistants[] arrays here. Tonight's rules rewrite restricts course
        // document writes to course staff only, so a plain student can't
        // legally make this write anymore — attempting it threw a permission
        // error right after the profile itself had already saved, which was
        // more confusing than useful. If matric-change propagation matters
        // (e.g. attendance history keyed by old matric), that needs a small
        // backend endpoint using Admin credentials — worth doing later, not
        // tonight.

        // Update local UI state
        currentUser.name = newName;
        if (newMatric) currentUser.matric = newMatric; // advisers keep their null
        currentUser.level = newLevel; // NEW

        if (displayName) displayName.textContent = newName;
        if (displayMatric) {
          displayMatric.textContent = currentUser.matric || ROLE_LABEL[currentUser.role] || "Member";
          const matricLabel = document.getElementById("displayMatricLabel");
          if (matricLabel) {
            matricLabel.textContent = currentUser.matric ? "Matric No:" : "Role:";
          }
        }

        const displaySchoolInfo = document.getElementById("displaySchoolInfo");
        if (displaySchoolInfo) {
          displaySchoolInfo.textContent = `${currentUser.institution || "GEN"} • ${currentUser.department || "GEN"} • ${currentUser.level || "GEN"}`;
        }

        settingsModal.classList.remove("show");
        toast.success("Your profile has been updated.", "Profile Saved");
      } catch (error) {
        console.error("Settings update error:", error);
        toast.error(error.message, "Something went wrong");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Save Changes 💾";
        }
      }
    });
  }

  const forgotPasswordForm = document.getElementById("forgotPasswordForm");
  if (forgotPasswordForm) {
    forgotPasswordForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = forgotPasswordForm.querySelector(
        "button[type='submit']",
      );
      const email = document
        .getElementById("forgotEmail")
        .value.trim()
        .toLowerCase();

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Sending Link... ⏳";
        }

        await sendPasswordResetEmail(auth, email);
        toast.success(
          "Check your inbox or spam folder for the reset link.",
          "Reset Email Sent 📧",
        );
        forgotPasswordForm.reset();
        if (forgotModal) forgotModal.classList.remove("show");
      } catch (error) {
        console.error("Password reset error:", error);
        toast.error(error.message, "Something went wrong");
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Update Password 🔄";
        }
      }
    });
  }

  // --- COURSES & PORTAL MANAGEMENT ---
  const courseGrid = document.getElementById("courseGrid");
  const portalSection = document.getElementById("portalSection");

  function renderCourses() {
    if (!courseGrid) return;
    courseGrid.innerHTML = "";

    const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");

    const myCourses = courses.filter((course) => {
      if (!currentUser) return false;
      const isRep = course.repUid === currentUser.uid; // Strict UID check
      const isAssistant = (course.assistants || [])
        .map(normalizeMatric)
        .includes(userMatric);
      const isEnrolled = (course.enrolled || [])
        .map(normalizeMatric)
        .includes(userMatric);
      return isRep || isAssistant || isEnrolled;
    });

    if (myCourses.length === 0) {
      courseGrid.innerHTML = `<p style="color: var(--muted);">No courses joined yet. Create or join one above! 🚀</p>`;
      return;
    }

    myCourses.forEach((course) => {
      const card = document.createElement("div");
      card.className = "card";
      card.style.maxHeight = "none";
      card.style.position = "relative";

      const enrolledCount = Array.isArray(course.enrolled)
        ? course.enrolled.length
        : 0;
      const isThisUserRep = currentUser && course.repUid === currentUser.uid;

      const actionIcon = isThisUserRep
        ? `<button onclick="deleteCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; color: var(--danger);" title="Delete Course"><i data-lucide="trash-2"></i></button>`
        : `<button onclick="leaveCourse('${course.id}')" style="position: absolute; top: 15px; right: 15px; background: transparent; border: none; cursor: pointer; color: var(--muted);" title="Leave Course"><i data-lucide="log-out"></i></button>`;

      card.innerHTML = `
      ${actionIcon}
      <h3 style="color: var(--navy); margin-bottom: 5px;">${escapeHTML(course.name || "Unnamed Course")}</h3>
      <p style="font-size: 0.85rem; margin-bottom: 5px;">Code: <strong>${escapeHTML(course.code)}</strong> | Rep: ${escapeHTML(course.rep || "—")}</p>
      <p style="font-size: 0.75rem; color: var(--muted); margin-bottom: 15px;">
        <i data-lucide="building" style="width:12px; height:12px;"></i> ${escapeHTML(course.institution || "GEN")} • 
        <i data-lucide="book-open" style="width:12px; height:12px;"></i> ${escapeHTML(course.department || "GEN")}
      </p>
      
      <div style="background: var(--bg); padding: 10px; border-radius: 8px; margin-bottom: 15px; font-size: 0.85rem; display: flex; justify-content: space-between; align-items: center;">
        <span><i data-lucide="users" style="width:14px; height:14px;"></i> Enrolled Students:</span>
        <strong>${enrolledCount}</strong>
      </div>

      <button class="btn" style="padding: 10px; font-size: 0.9rem;" onclick="openPortal('${course.id}')">
        <i data-lucide="external-link" style="width:16px; height:16px; margin-right:6px; vertical-align:-3px;"></i> Open Portal
      </button>
    `;
      courseGrid.appendChild(card);
    });

    // DON'T FORGET THIS LINE AT THE VERY END OF THE FUNCTION
    refreshIcons();
  }

  window.deleteCourse = async function (courseId) {
    const course = courses.find((c) => c.id === courseId);
    if (
      await showConfirm({
        title: "Delete Course",
        message: `Deleting "${course ? course.name : "this course"}" will permanently remove it and all attendance records. This cannot be undone.`,
        okText: "Delete Course",
        cancelText: "Cancel",
        icon: "🗑️",
        danger: true,
      })
    ) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/course?action=delete", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ courseId }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to delete course.");
        // Remove from local state immediately
        courses = courses.filter((c) => c.id !== courseId);
        renderCourses();
      } catch (error) {
        console.error("Delete course error:", error);
        toast.error("Unable to delete course. Please try again.");
      }
    }
  };

  window.leaveCourse = async function (courseId) {
    const course = courses.find((c) => c.id === courseId);
    if (!course || !auth.currentUser) return;

    if (
      await showConfirm({
        title: "Leave Course",
        message: `Leave "${course.name}"? You can rejoin anytime using the course code.`,
        okText: "Leave",
        cancelText: "Stay",
        icon: "🚪",
        danger: false,
      })
    ) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/course?action=leave", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ courseId }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to leave course.");

        toast.info(`You have left ${course.name}.`, "Left Course 👋");
      } catch (error) {
        console.error("Leave course error:", error);
        toast.error("Unable to leave course. Please check your connection.");
      }
    }
  };

  // Per-portal live session listener — students and staff
  let unsubscribeSessionLive = null;
  let unsubscribeSessionSecret = null;
  let unsubscribeAttendance = null;
  let unsubscribeDeviceFlags = null;
  let unsubscribeManualRequests = null;
  let unsubscribeMyManualRequest = null;
  let unsubscribeAbsentFlags = null;
  let unsubscribeMyAbsentFlag = null;
  let unsubscribeNotifications = null;
  let unsubscribeGroups = null;

  // 👥 GROUPS: sub-sets inside a parent course ("Group A", "Group B"...).
  // One session per lecture, one PIN — groups only tag who belongs where.
  // Attendance records keep the group snapshot, so deleting a group never
  // erases history, and members always stay enrolled in the parent course.
  function startGroupsListener(courseId) {
    if (unsubscribeGroups) {
      unsubscribeGroups();
      unsubscribeGroups = null;
    }
    unsubscribeGroups = onSnapshot(
      collection(db, "courses", courseId, "groups"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        activeCourse.groups = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        renderGroupsList();
        renderPortalState(); // roster badges update with group info
      },
      (err) => console.error("Groups listener error:", err),
    );
  }

  function renderGroupsList() {
    const container = document.getElementById("groupsList");
    if (!container || !activeCourse) return;
    const groups = activeCourse.groups || [];
    const isRepHere = currentUser && activeCourse.repUid === currentUser.uid;

    if (groups.length === 0) {
      container.innerHTML =
        '<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 10px;">No groups yet. Create one above — e.g. "Group A".</p>';
      return;
    }

    container.innerHTML = "";
    groups.forEach((g) => {
      const members = (g.members || []).map(normalizeMatric);
      const memberChips =
        members
          .map(
            (m) => `
          <span style="display: inline-flex; align-items: center; gap: 6px; background: var(--bg); border: 1px solid var(--border); border-radius: 999px; padding: 3px 10px; font-size: 0.75rem; margin: 3px 4px 3px 0;">
            ${escapeHTML(m)}
            <button data-remove-member="${escapeHTML(g.id)}" data-matric="${escapeHTML(m)}" title="Remove from group (stays enrolled in course)" style="background: none; border: none; color: var(--danger); cursor: pointer; font-weight: bold; padding: 0;">&times;</button>
          </span>`,
          )
          .join("") ||
        '<span style="font-size: 0.8rem; color: var(--muted);">No members yet.</span>';

      const enrolled = (activeCourse.enrolled || []).map(normalizeMatric);
      const available = enrolled.filter((m) => !members.includes(m));
      const options = available
        .map((m) => `<option value="${escapeHTML(m)}">${escapeHTML(m)}</option>`)
        .join("");

      const card = document.createElement("div");
      card.style.cssText =
        "background: var(--card-bg); border: 1px solid var(--border); border-radius: 10px; padding: 12px; margin-bottom: 10px;";
      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px;">
          <strong style="color: var(--navy);">🏷️ ${escapeHTML(g.name || "Group")}</strong>
          <div style="display: flex; gap: 6px; align-items: center;">
            ${g.leadMatric ? `<span style="font-size: 0.7rem; background: #6f42c1; color: #fff; padding: 2px 6px; border-radius: 4px;">LEAD ${escapeHTML(g.leadMatric)}</span>` : ""}
            <span style="font-size: 0.7rem; background: var(--teal); color: #fff; padding: 2px 6px; border-radius: 4px;">${members.length} member(s)</span>
            ${isRepHere ? `<button data-delete-group="${escapeHTML(g.id)}" style="background: transparent; border: 1px solid var(--danger); color: var(--danger); border-radius: 6px; font-size: 0.7rem; font-weight: bold; padding: 3px 8px; cursor: pointer;">Delete</button>` : ""}
          </div>
        </div>
        <div style="margin-top: 8px;">${memberChips}</div>
        <div style="display: flex; gap: 8px; margin-top: 10px; flex-wrap: wrap;">
          <select data-member-select="${escapeHTML(g.id)}" style="flex: 1 1 140px; padding: 7px; border-radius: 8px; border: 1px solid var(--border); background: var(--card-bg); color: var(--text); font-size: 0.8rem;">
            <option value="">-- Add student to group --</option>
            ${options}
          </select>
          <button data-add-member="${escapeHTML(g.id)}" class="btn" style="width: auto; font-size: 0.75rem; padding: 7px 12px;">➕ Add</button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll("[data-add-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const gid = btn.dataset.addMember;
        const select = container.querySelector(
          `[data-member-select="${gid}"]`,
        );
        const matric = select ? select.value : "";
        if (!matric) {
          toast.warning("Pick a student to add first.");
          return;
        }
        try {
          await updateDoc(doc(db, "courses", activeCourse.id, "groups", gid), {
            members: arrayUnion(matric),
          });
          toast.success(`${matric} added to the group.`, "Group Updated 👥");
        } catch (err) {
          toast.error(err.message);
        }
      });
    });

    container.querySelectorAll("[data-remove-member]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await updateDoc(
            doc(
              db,
              "courses",
              activeCourse.id,
              "groups",
              btn.dataset.removeMember,
            ),
            { members: arrayRemove(btn.dataset.matric) },
          );
          toast.info(
            `${btn.dataset.matric} removed from the group (still enrolled in the course).`,
          );
        } catch (err) {
          toast.error(err.message);
        }
      });
    });

    container.querySelectorAll("[data-delete-group]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const ok = await showConfirm({
          title: "Delete Group",
          message:
            "Delete this group? Members stay enrolled in the course, and past attendance records keep their group tag. Continue?",
          okText: "Delete Group",
          danger: true,
        });
        if (!ok) return;
        try {
          await deleteDoc(
            doc(
              db,
              "courses",
              activeCourse.id,
              "groups",
              btn.dataset.deleteGroup,
            ),
          );
          toast.success(
            "Group deleted. Students remain in the parent course.",
            "Deleted",
          );
        } catch (err) {
          toast.error(err.message);
        }
      });
    });
  }

  const createGroupBtn = document.getElementById("createGroupBtn");
  if (createGroupBtn) {
    createGroupBtn.addEventListener("click", async () => {
      if (!activeCourse || !auth.currentUser) return;
      const input = document.getElementById("newGroupName");
      const name = input ? input.value.trim() : "";
      if (!name) {
        toast.warning("Give the group a name first (e.g., Group A).");
        return;
      }
      try {
        createGroupBtn.disabled = true;
        await addDoc(collection(db, "courses", activeCourse.id, "groups"), {
          name: name.slice(0, 60),
          leadUid: auth.currentUser.uid,
          leadMatric: normalizeMatric(currentUser ? currentUser.matric : ""),
          members: [],
          createdAt: serverTimestamp(),
        });
        if (input) input.value = "";
        toast.success(
          `Group "${name}" created. Add members below.`,
          "Group Created 👥",
        );
      } catch (err) {
        toast.error(err.message);
      } finally {
        createGroupBtn.disabled = false;
      }
    });
  }

  function startSessionLiveListener(courseId) {
    if (unsubscribeSessionLive) {
      unsubscribeSessionLive();
      unsubscribeSessionLive = null;
    }
    unsubscribeSessionLive = onSnapshot(
      doc(db, "courses", courseId, "session", "live"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        if (snap.exists()) {
          const data = snap.data();
          // 🎯 SERVER-ANCHORED CLOCK: the session was written "just now" by
          // Firestore's clock, so server time ≈ generatedAt + push delay.
          // Re-anchor the skew on EVERY session snapshot — this makes the
          // countdown identical on all devices even if a phone's clock is
          // wrong (the source of the "1020s" countdown bug).
          if (
            data.generatedAt &&
            typeof data.generatedAt.toMillis === "function"
          ) {
            serverClockSkewMs =
              data.generatedAt.toMillis() + 1500 - Date.now();
          }
          const accurateNow = getAccurateNow();
          const duration = (data.durationSeconds || 300) * 1000;
          const rawMsLeft = (data.expiresAt || 0) - accurateNow;
          const cappedMsLeft = Math.max(0, Math.min(rawMsLeft, duration));
          const isStillActive = data.active && cappedMsLeft > 0;
          if (isStillActive) {
            activeCourse.activeSession = {
              ...(activeCourse.activeSession || {}),
              expiresAt: data.expiresAt,
              expired: false,
              locationMode: data.locationMode || "no_gps",
              qrMode: data.qrMode === true,
              hallName: data.hallName || null,
              // 🔄 REFRESH RECOVERY. Duration and rotation interval are read
              // from the SERVER rather than remembered, so a rep who reloads
              // mid-class gets the real remaining time and keeps rotating.
              // The PIN itself arrives separately, from the secret listener.
              sessionDuration: data.durationSeconds || 300,
              pinRotationInterval: data.pinRotationInterval || 10,
              anchorAccuracy:
                typeof data.anchorAccuracy === "number"
                  ? data.anchorAccuracy
                  : activeCourse.activeSession?.anchorAccuracy ?? null,
            };
          } else if (activeCourse.activeSession) {
            activeCourse.activeSession.expired = true;
          }
          // 🔄 A rep who reloaded has no countdown running, because the
          // timer lives in memory. Restarting it here returns the PIN panel
          // to exactly how they left it, instead of a dead 0:00 while
          // students are still checking in.
          if (!isSessionTimerRunning) {
            isSessionTimerRunning = true;
            startSessionTimer();
          }
        } else if (activeCourse.activeSession) {
          activeCourse.activeSession.expired = true;
        }
        renderPortalState();
      },
      (err) => console.error("Session live listener error:", err),
    );
  }

  function startSessionSecretListener(courseId) {
    if (unsubscribeSessionSecret) {
      unsubscribeSessionSecret();
      unsubscribeSessionSecret = null;
    }
    unsubscribeSessionSecret = onSnapshot(
      doc(db, "courses", courseId, "session", "secret"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        if (!snap.exists()) return;
        const data = snap.data();
        if (!activeCourse.activeSession) {
          activeCourse.activeSession = {};
        }
        activeCourse.activeSession.pin = String(data.pin || "");
        activeCourse.activeSession.previousPin = data.previousPin || null;
        activeCourse.activeSession.pinRotationTime =
          data.pinRotationTime || Date.now();
        activeCourse.activeSession.attendees = data.attendees || [];
        activeCourse.activeSession.rejectedFixes = Array.isArray(
          data.rejectedFixes,
        )
          ? data.rejectedFixes
          : [];
        activeCourse.activeSession.locationMode =
          data.locationMode || activeCourse.activeSession.locationMode;
        activeCourse.activeSession.qrMode = data.qrMode === true;
        console.log(
          "Secret listener updated PIN:",
          activeCourse.activeSession.pin,
        );
        renderPortalState();
      },
      (err) => console.error("Session secret listener error:", err),
    );
  }

  function startAttendanceHistoryListener(courseId) {
    if (unsubscribeAttendance) {
      unsubscribeAttendance();
      unsubscribeAttendance = null;
    }
    unsubscribeAttendance = onSnapshot(
      query(
        collection(db, "courses", courseId, "attendance"),
        orderBy("closedAt", "asc"),
      ),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        // Optimize: Only update if data actually changed
        const newHistory = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((record) => Array.isArray(record.attendees));

        // Quick check if data actually changed before re-rendering
        if (
          JSON.stringify(newHistory) !==
          JSON.stringify(activeCourse.attendanceHistory)
        ) {
          activeCourse.attendanceHistory = newHistory;
          renderSemesterReport();
          renderPortalState();
        }
      },
      (err) => {
        console.error("Attendance history listener error:", err);
        loadAttendanceHistory();
      },
    );
  }

  function startDeviceFlagsListener(courseId) {
    if (unsubscribeDeviceFlags) {
      unsubscribeDeviceFlags();
      unsubscribeDeviceFlags = null;
    }
    unsubscribeDeviceFlags = onSnapshot(
      collection(db, "courses", courseId, "deviceFlags"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        activeCourse.deviceFlags = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        renderPortalState();
      },
      (err) => console.error("Device flags listener error:", err),
    );
  }

  // --- FAIL-SAFE OVERRIDE: staff request queue + student status ---
  function startManualRequestsListener(courseId) {
    if (unsubscribeManualRequests) {
      unsubscribeManualRequests();
      unsubscribeManualRequests = null;
    }
    unsubscribeManualRequests = onSnapshot(
      collection(db, "courses", courseId, "manualRequests"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        const requests = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        renderManualRequestQueue(requests);
      },
      (err) => console.error("Manual requests listener error:", err),
    );
  }

  // 🔔 Phase + attention state for the rep portal: the Live card only shows
  // while a session exists (or someone needs the rep), and new manual
  // requests pop the panel open with a toast + vibration — like a raised
  // hand the rep cannot miss, even though everything else is collapsed.
  let pendingManualCount = 0;

  function syncRepPhaseUI() {
    const session = activeCourse ? activeCourse.activeSession : null;
    const setupCard = document.getElementById("sessionSetupCard");
    const liveCard = document.getElementById("liveSessionCard");
    if (!setupCard || !liveCard) return;
    const showLive = !!session;
    liveCard.classList.toggle("hidden", !showLive);
    setupCard.classList.toggle("hidden", !!session);
  }

  function renderManualRequestQueue(requests) {
    const panel = document.getElementById("manualRequestsPanel");
    if (!panel) return;
    const pending = requests.filter((r) => r.status === "pending");
    const countEl = document.getElementById("manualRequestsCount");
    const listContainer = document.getElementById(
      "manualRequestsListContainer",
    );
    if (countEl) countEl.textContent = pending.length;
    pendingManualCount = pending.length;
    setDrawerBadge("checkin", pending.length);

    panel.classList.toggle("hidden", requests.length === 0);

    // Auto-attention: detect NEW pending requests since the last snapshot.
    const idsSignature = pending
      .map((r) => r.id)
      .sort()
      .join("|");
    if (pending.length > 0) {
      const prevIds = new Set(
        (panel.dataset.lastPendingIds || "")
          .split("|")
          .filter(Boolean),
      );
      const fresh = pending.filter((r) => !prevIds.has(r.id));
      const isFirstRender = panel.dataset.lastPendingIds === undefined;
      panel.dataset.lastPendingIds = idsSignature;
      if (!isFirstRender && fresh.length > 0) {
        panel.classList.remove("hidden");
        syncRepPhaseUI();
        const first = fresh[0];
        toast.info(
          `${first.name || "A student"} is requesting manual verification.`,
          "✋ Manual Request",
        );
        if (navigator.vibrate) navigator.vibrate([180, 90, 180]);
      }
    } else {
      panel.dataset.lastPendingIds = "";
    }

    if (!listContainer) return;

    if (pending.length === 0) {
      listContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 8px;">No pending manual requests. 👍</p>`;
      return;
    }

    listContainer.innerHTML = "";
    pending.forEach((request) => {
      const card = document.createElement("div");
      card.style.cssText =
        "background: var(--card-bg); padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid #fd7e14;";
      const whenText =
        request.requestedAt && request.requestedAt.toDate
          ? request.requestedAt.toDate().toLocaleTimeString()
          : "Just now";
      card.innerHTML = `
        <div style="font-size: 0.85rem;">
          ✋ <strong>${escapeHTML(request.name || "Student")}</strong> (${escapeHTML(request.matric || "?")})
        </div>
        <div style="font-size: 0.8rem; color: var(--muted); margin-top: 3px;">"${escapeHTML(request.reason || "")}" — ${whenText}</div>
        <input data-reject-reason="${request.id}" type="text" maxlength="120"
          placeholder="Reason (optional — shown to the student)"
          style="margin-top: 8px; width: 100%; font-size: 0.75rem; padding: 6px 8px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text);">
        <div class="manual-request-actions" style="margin-top: 8px;">
          <button data-approve-uid="${request.id}" class="btn" style="background: #28a745; font-size: 0.78rem; padding: 6px 12px; width: auto;">✅ Approve (I can see them)</button>
          <button data-reject-uid="${request.id}" class="btn" style="background: var(--danger); font-size: 0.78rem; padding: 6px 12px; width: auto;">🚩 Reject</button>
        </div>
      `;
      listContainer.appendChild(card);
    });

    listContainer
      .querySelectorAll("[data-approve-uid]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          approveManualRequest(btn.dataset.approveUid),
        ),
      );
    listContainer
      .querySelectorAll("[data-reject-uid]")
      .forEach((btn) =>
        btn.addEventListener("click", () =>
          rejectManualRequest(btn.dataset.rejectUid),
        ),
      );
    refreshIcons();
  }

  // Rep/assistant approves — the server records attendance as manual_override.
  async function approveManualRequest(targetUid) {
    if (!activeCourse || !auth.currentUser) return;
    const approveBtn = document.querySelector(
      `[data-approve-uid="${targetUid}"]`,
    );
    const rejectBtn = document.querySelector(
      `[data-reject-uid="${targetUid}"]`,
    );
    // ⚡ INSTANT feedback: on congested hall networks the request takes
    // seconds — the rep must see the tap registered immediately.
    if (approveBtn) {
      approveBtn.disabled = true;
      approveBtn.innerHTML = "⏳ Approving…";
    }
    if (rejectBtn) rejectBtn.disabled = true;

    // 🛡️ Approval reliability: serverless cold starts + slow networks can
    // legitimately take >15s. We allow 30s per attempt, and — critically —
    // after the last attempt fails we CHECK THE LIVE REQUEST STATE in
    // Firestore before showing an error. If the approval actually landed
    // (request doc deleted server-side), the rep sees success, not a scary
    // false "Slow Network" that makes them retry a finished decision.
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetchWithTimeout("/api/approval?action=approveManual",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ courseId: activeCourse.id, targetUid }),
          },
          30000,
        );
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Approval failed.");
        toast.success(
          result.message || "Manual attendance approved and logged.",
          "Approved ✅",
        );
        lastError = null;
        break;
      } catch (error) {
        console.error("Approve manual request error:", error);
        lastError = error;
        // A server-side decision (403/404/409) is final — retrying a
        // rejected/already-decided request just burns time.
        if (error && /403|404|already|final|Only the/i.test(error.message || "")) {
          break;
        }
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
    }
    if (lastError) {
      // Verify against live Firestore state: an approval that timed out on
      // the client may have succeeded on the server — the request doc then
      // EXISTS with status "approved" (it is never deleted).
      let actuallyApproved = false;
      try {
        const reqSnap = await getDoc(
          doc(db, "courses", activeCourse.id, "manualRequests", targetUid),
        );
        actuallyApproved =
          reqSnap.exists() && reqSnap.data().status === "approved";
      } catch (_) {
        /* can't verify — treat as failed */
      }
      if (actuallyApproved) {
        toast.success(
          "Manual attendance approved and logged.",
          "Approved ✅",
        );
      } else {
        toast.error(
          "Network is too slow right now — the approval did not go through. Tap Approve again in a moment.",
          "Slow Network",
        );
      }
    }
    // Restore buttons (the listener re-renders the card on success anyway).
    if (approveBtn) {
      approveBtn.disabled = false;
      approveBtn.innerHTML =
        '✅ Approve (I can see them)';
    }
    if (rejectBtn) rejectBtn.disabled = false;
  }

  // Rep/assistant rejects — decision is final and permanently logged.
  async function rejectManualRequest(targetUid) {
    if (!activeCourse || !auth.currentUser) return;
    const ok = await showConfirm({
      title: "Reject Manual Request",
      message:
        "Reject this manual verification request? The student will be told their Rep could not verify them. This decision is final and permanently logged.",
      okText: "Reject Request",
      danger: true,
      icon: "flag",
    });
    if (!ok) return;
    const reasonInput = document.querySelector(
      `[data-reject-reason="${targetUid}"]`,
    );
    const rejectedReason = reasonInput
      ? reasonInput.value.trim().slice(0, 120)
      : "";
    const rejectBtn = document.querySelector(
      `[data-reject-uid="${targetUid}"]`,
    );
    const approveBtn = document.querySelector(
      `[data-approve-uid="${targetUid}"]`,
    );
    if (rejectBtn) {
      rejectBtn.disabled = true;
      rejectBtn.innerHTML = "⏳ Rejecting…";
    }
    if (approveBtn) approveBtn.disabled = true;
    try {
      await updateDoc(
        doc(db, "courses", activeCourse.id, "manualRequests", targetUid),
        {
          status: "rejected",
          reviewedAt: serverTimestamp(),
          reviewedByUid: auth.currentUser.uid,
          ...(rejectedReason ? { rejectedReason } : {}),
        },
      );
      toast.info("Request rejected and permanently logged.", "Rejected");
    } catch (error) {
      console.error("Reject manual request error:", error);
      toast.error(error.message || "Could not reject the request.");
    } finally {
      if (rejectBtn) {
        rejectBtn.disabled = false;
        rejectBtn.innerHTML = "🚩 Reject";
      }
      if (approveBtn) approveBtn.disabled = false;
    }
  }

  // Student-side: live status of their own manual verification request.
  function startMyManualRequestListener(courseId) {
    if (unsubscribeMyManualRequest) {
      unsubscribeMyManualRequest();
      unsubscribeMyManualRequest = null;
    }
    if (!currentUser) return;
    unsubscribeMyManualRequest = onSnapshot(
      doc(db, "courses", courseId, "manualRequests", currentUser.uid),
      (snap) => {
        const statusEl = document.getElementById("manualRequestStatus");
        if (!statusEl) return;
        if (!snap.exists()) {
          statusEl.classList.add("hidden");
          return;
        }
        const data = snap.data();
        statusEl.classList.remove("hidden");
        if (data.status === "pending") {
          statusEl.style.background = "rgba(253, 126, 20, 0.1)";
          statusEl.style.color = "#fd7e14";
          statusEl.textContent =
            "⏳ Request sent — waiting for your Rep to verify you.";
        } else if (data.status === "approved") {
          statusEl.style.background = "rgba(40, 167, 69, 0.1)";
          statusEl.style.color = "#28a745";
          statusEl.textContent =
            "✅ Your Rep verified you. Attendance recorded!";
        } else if (data.status === "rejected") {
          statusEl.style.background = "rgba(220, 53, 69, 0.1)";
          statusEl.style.color = "#dc3545";
          statusEl.textContent = data.rejectedReason
            ? `❌ Your Rep could not verify you for this session. The decision is final. Reason: "${data.rejectedReason}"`
            : "❌ Your Rep could not verify you for this session. The decision is final.";
        }
      },
      (err) => console.error("My manual request listener error:", err),
    );
  }

  // --- STUDENT EXEMPTIONS LISTENER ---
  let unsubscribeStudentExemptions = null;

  function startStudentExemptionsListener(courseId, userMatric) {
    if (unsubscribeStudentExemptions) {
      unsubscribeStudentExemptions();
      unsubscribeStudentExemptions = null;
    }

    unsubscribeStudentExemptions = onSnapshot(
      query(
        collection(db, "courses", courseId, "exemptions"),
        where("matric", "==", userMatric)
      ),
      (snap) => {
        // Cache exemptions globally
        studentExemptions = snap.docs.map(doc => doc.data());
        // Trigger re-render of analytics when exemptions change
        if (activeCourse && activeCourse.id === courseId) {
          renderPortalState();
        }
      },
      (err) => console.error("Student exemptions listener error:", err)
    );
  }

  // --- ANTI-BEEF: absent flags (rep roster badges + student emergency alert) ---
  function startAbsentFlagsListener(courseId) {
    if (unsubscribeAbsentFlags) {
      unsubscribeAbsentFlags();
      unsubscribeAbsentFlags = null;
    }
    unsubscribeAbsentFlags = onSnapshot(
      collection(db, "courses", courseId, "absentFlags"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        activeCourse.absentFlags = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        // Drawer badge counts only CURRENT-session flags — stale flags from
        // past sessions must not inflate the roster badge.
        const liveExpiresAt =
          activeCourse && activeCourse.activeSession
            ? activeCourse.activeSession.expiresAt
            : null;
        const flagCount = activeCourse.absentFlags.filter(
          (f) =>
            f.status === "flagged" &&
            (!liveExpiresAt || f.sessionExpiresAt === liveExpiresAt),
        ).length;
        setDrawerBadge("roster", flagCount);
        renderPortalState();
      },
      (err) => console.error("Absent flags listener error:", err),
    );
  }

  // Student-side: the emergency alert for THEIR OWN flag (uid-keyed doc).
  // The flag badge lives in the student controls — impossible to miss.
  function startMyAbsentFlagListener(courseId) {
    if (unsubscribeMyAbsentFlag) {
      unsubscribeMyAbsentFlag();
      unsubscribeMyAbsentFlag = null;
    }
    if (!currentUser) return;
    unsubscribeMyAbsentFlag = onSnapshot(
      doc(db, "courses", courseId, "absentFlags", currentUser.uid),
      (snap) => {
        const banner = document.getElementById("absentFlagBanner");
        if (!banner) return;
        const msgEl = document.getElementById("absentFlagMessage");
        // 🛡️ SESSION-SCOPED: the flag doc persists across sessions (uid-keyed),
        // so only show the emergency alert if it belongs to the LIVE session —
        // otherwise a week-3 flag would re-appear in every later lecture.
        const data = snap.exists() ? snap.data() : null;
        const liveExpiresAt =
          activeCourse && activeCourse.activeSession
            ? activeCourse.activeSession.expiresAt
            : null;
        if (
          !data ||
          data.status !== "flagged" ||
          !liveExpiresAt ||
          data.sessionExpiresAt !== liveExpiresAt
        ) {
          banner.classList.add("hidden");
          return;
        }
        banner.classList.remove("hidden");
        if (msgEl) {
          const flaggedWhen =
            data.flaggedAt && data.flaggedAt.toDate
              ? data.flaggedAt.toDate().toLocaleTimeString()
              : "just now";
          msgEl.textContent = `You have been flagged absent for this lecture. If you are present, see your Rep immediately (flagged at ${flaggedWhen}).`;
        }
      },
      (err) => console.error("My absent flag listener error:", err),
    );
  }

  // Global (app-wide) emergency notification listener — the push-style alert
  // fires even if the student is browsing another course's portal. Each
  // notification toasts exactly once per login.
  const shownNotificationIds = new Set();
  function startNotificationsListener() {
    if (unsubscribeNotifications) {
      unsubscribeNotifications();
      unsubscribeNotifications = null;
    }
    if (!auth.currentUser) return;
    unsubscribeNotifications = onSnapshot(
      query(
        collection(db, "users", auth.currentUser.uid, "notifications"),
        where("read", "==", false),
      ),
      (snap) => {
        snap.docs.forEach((d) => {
          if (shownNotificationIds.has(d.id)) return;
          shownNotificationIds.add(d.id);
          const data = d.data();
          if (data.type === "absent_flag") {
            toast.error(
              data.message ||
                "You have been flagged absent for this lecture. If you are present, see your Rep immediately.",
              "⚠️ Flagged Absent",
            );
          } else if (data.type === "course_removal") {
            toast.error(
              data.message ||
                "You were removed from a course by the Course Rep.",
              "🗑️ Removed From Course",
            );
          }
        });
      },
      (err) => console.error("Notifications listener error:", err),
    );
  }

  // ============================================================
  // MODE 2: DYNAMIC ROTATING QR (PROJECTOR / LARGE HALL MODE)
  // ============================================================
  let qrLibPromise = null;
  function loadQrLibrary() {
    if (!qrLibPromise) {
      qrLibPromise = import("https://cdn.jsdelivr.net/npm/qrcode@1.5.4/+esm");
    }
    return qrLibPromise;
  }

  function buildQrPayload(pin) {
    // The 4-digit PIN is the real secret — it rotates every 10s and dies with
    // the session, so screenshots are as useless as shouting the PIN late.
    // The t= nonce just makes every refresh render a unique code visually.
    // The check-in pipeline only reads code + pin (all guardrails still run).
    const nonce = Math.floor(Date.now() / 15000);
    const courseCode = activeCourse ? activeCourse.code : "";
    return `${location.origin}${location.pathname}?code=${encodeURIComponent(
      courseCode,
    )}&qrpin=${encodeURIComponent(pin)}&t=${nonce}`;
  }

  // 🎨 Brand QR: stamp the VeriPresenX logo dead-center. Error-correction
  // level "H" tolerates ~30% occlusion, so a logo occupying ≤22% of the area
  // still scans reliably (same trick restaurant menu codes use).
  const QR_LOGO_SRC = "/brand/mark-256.png";
  let qrLogoImage = null;
  function loadQrLogo() {
    if (qrLogoImage) return Promise.resolve(qrLogoImage);
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        qrLogoImage = img;
        resolve(img);
      };
      img.onerror = () => resolve(null); // logo is decorative only
      img.src = QR_LOGO_SRC;
    });
  }

  async function renderQrOverlay() {
    const overlay = document.getElementById("qrModeOverlay");
    const canvas = document.getElementById("qrCanvas");
    if (!overlay || overlay.classList.contains("hidden") || !canvas) return;
    const session = activeCourse ? activeCourse.activeSession : null;
    const pin = session ? session.pin : "";
    if (!pin) return;

    const courseTitle = document.getElementById("qrCourseTitle");
    const pinText = document.getElementById("qrPinText");
    if (courseTitle && activeCourse)
      courseTitle.textContent = activeCourse.name;
    if (pinText) pinText.textContent = pin;

    // 📐 FIT-TO-VIEWPORT QR: the overlay is a vertical stack — title + QR +
    // PIN + instructions + countdown + Close button. On a PC the raw "760px
    // max" lets the QR eat the whole viewport and the Close button/countdown
    // fall off the bottom, forcing the rep to zoom out. We reserve the chrome
    // (~220px desktop / ~170px mobile) FIRST, then size the QR into whatever
    // is left. Canvas is CSS-clamped as a belt-and-braces guarantee.
    const reservedHeight = window.innerWidth <= 768 ? 170 : 230;
    const availableH = Math.max(200, window.innerHeight - reservedHeight);
    const availableW = Math.max(200, window.innerWidth - 50);
    const qrWidth = Math.min(availableH, availableW, 540);
    try {
      const lib = await loadQrLibrary();
      const QRCode = lib.default || lib;
      await QRCode.toCanvas(canvas, buildQrPayload(pin), {
        width: qrWidth,
        margin: 1,
        errorCorrectionLevel: "H",
        color: { dark: "#0b1220", light: "#ffffff" },
      });
      const logo = await loadQrLogo();
      if (logo) {
        const ctx = canvas.getContext("2d");
        const side = Math.round(canvas.width * 0.2); // ≤22% of QR area
        const x = (canvas.width - side) / 2;
        const y = (canvas.height - side) / 2;
        // White plate behind the logo keeps contrast for quiet-zone readers.
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(x, y, side, side);
        const pad = Math.round(side * 0.08);
        ctx.drawImage(logo, x + pad, y + pad, side - pad * 2, side - pad * 2);
      }
    } catch (err) {
      console.warn(
        "QR library unavailable — the live PIN is still displayed:",
        err,
      );
    }
  }

  window.closeQrMode = function () {
    const overlay = document.getElementById("qrModeOverlay");
    if (overlay) {
      overlay.classList.add("hidden");
    }
    if (window.__qrCountdownInterval) {
      clearInterval(window.__qrCountdownInterval);
      window.__qrCountdownInterval = null;
    }
    releaseQrWakeLock();
    try {
      if (document.fullscreenElement) document.exitFullscreen();
    } catch (_) {
      /* fullscreen already gone */
    }
  };

  // 🔋 Wake Lock: rotation is driven by the rep's device — if the phone
  // sleeps mid-lecture, the code freezes and every student's check-in
  // starts failing. Holding a wake lock keeps the projector screen alive.
  let qrWakeLock = null;
  async function requestQrWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        qrWakeLock = await navigator.wakeLock.request("screen");
        qrWakeLock.addEventListener("release", () => (qrWakeLock = null));
      }
    } catch (_) {
      /* denied/unsupported — normal screen timeout applies instead */
    }
  }
  function releaseQrWakeLock() {
    try {
      if (qrWakeLock) {
        qrWakeLock.release();
        qrWakeLock = null;
      }
    } catch (_) {
      /* already released */
    }
  }
  document.addEventListener("visibilitychange", () => {
    // Wake locks drop when the tab hides — reacquire on return if the
    // projector overlay is still open.
    const ov = document.getElementById("qrModeOverlay");
    if (
      document.visibilityState === "visible" &&
      qrWakeLock === null &&
      ov &&
      !ov.classList.contains("hidden")
    ) {
      requestQrWakeLock();
    }
  });

  window.showQrMode = function () {
    const overlay = document.getElementById("qrModeOverlay");
    if (!overlay || !activeCourse) return;
    const session = activeCourse.activeSession;
    if (!session || !session.pin) {
      toast.warning(
        "Generate a PIN first — the QR code carries the live rotating code.",
        "No Active PIN",
      );
      return;
    }
    overlay.classList.remove("hidden");
    renderQrOverlay();
    requestQrWakeLock();

    // 📺 PORTRAIT ONLY. Real-hall testing showed the orientation lock
    // clipped the overlay top and bottom on narrow phones, so landscape
    // was dropped. Fullscreen (best effort) + the biggest portrait QR.
    (async () => {
      try {
        if (!document.fullscreenElement) {
          await overlay.requestFullscreen();
        }
      } catch (_) {
        /* fullscreen denied — the inline overlay still works */
      }
    })();

    // Live countdown to the next rotation, driven by the secret doc timestamp.
    if (window.__qrCountdownInterval)
      clearInterval(window.__qrCountdownInterval);
    window.__qrCountdownInterval = setInterval(() => {
      const hint = document.getElementById("qrRotationHint");
      if (!hint || overlay.classList.contains("hidden")) {
        clearInterval(window.__qrCountdownInterval);
        window.__qrCountdownInterval = null;
        return;
      }
      const current = activeCourse ? activeCourse.activeSession : null;
      if (!current || !current.pin) {
        hint.textContent = "";
        return;
      }
      const rotationMs = ((current.pinRotationInterval || 10) * 1000);
      const base = current.pinRotationTime || Date.now();
      const msLeft = Math.max(
        0,
        rotationMs - ((Date.now() - base) % rotationMs),
      );
      hint.textContent = `Next code in: ${Math.ceil(msLeft / 1000)}s`;
    }, 1000);
  };

  const showQrBtn = document.getElementById("showQrBtn");
  if (showQrBtn) showQrBtn.addEventListener("click", () => window.showQrMode());
  const closeQrBtn = document.getElementById("closeQrBtn");
  if (closeQrBtn)
    closeQrBtn.addEventListener("click", () => window.closeQrMode());

  // Window resized while projecting? Re-render the QR at the new maximal
  // size and refresh the CSS-rotation fallback (portrait↔landscape flip).
  window.addEventListener("resize", () => {
    const ov = document.getElementById("qrModeOverlay");
    if (!ov || ov.classList.contains("hidden")) return;
    renderQrOverlay();
  });

  // ============================================================
  // FCM EMERGENCY PUSH (phone buzzes even when the app is closed)
  // ============================================================
  window.enablePushNotifications = async function () {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast.error("This phone's browser doesn't support push notifications.");
      return;
    }
    if (!FCM_VAPID_KEY) {
      toast.warning(
        "Push isn't configured yet — paste your Web Push certificate key into FCM_VAPID_KEY in app.js. In-app alerts still work.",
        "Setup Needed",
      );
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        toast.warning(
          "Allow notifications in your browser settings to get emergency alerts.",
          "Permission Needed",
        );
        return;
      }
      const { isSupported, getMessaging, getToken } =
        await import("https://www.gstatic.com/firebasejs/12.18.0/firebase-messaging.js");
      if (!(await isSupported())) {
        toast.warning(
          "Push messaging isn't supported on this browser.",
          "Not Supported",
        );
        return;
      }
      const registration = await navigator.serviceWorker.register(
        "/firebase-messaging-sw.js",
        { type: "module" },
      );
      const messaging = getMessaging(app);
      const token = await getToken(messaging, {
        vapidKey: FCM_VAPID_KEY,
        serviceWorkerRegistration: registration,
      });
      if (!token) throw new Error("No FCM token was returned.");
      await setDoc(doc(db, "users", auth.currentUser.uid, "fcmTokens", token), {
        token,
        userAgent: navigator.userAgent || "",
        createdAt: serverTimestamp(),
      });
      toast.success(
        "Your phone will now buzz if you're ever flagged absent.",
        "Push Enabled 🔔",
      );
    } catch (err) {
      console.error("Push enable error:", err);
      toast.error(err.message || "Could not enable push notifications.");
    }
  };

  const enablePushBtn = document.getElementById("enablePushBtn");
  if (enablePushBtn) {
    enablePushBtn.addEventListener("click", () =>
      window.enablePushNotifications(),
    );
  }

  // ============================================================
  // REP AUDIT PAGE: permanent removal log + flag history
  // ============================================================
  let unsubscribeAudit = null;

  function startAuditListener(courseId) {
    if (unsubscribeAudit) {
      unsubscribeAudit();
      unsubscribeAudit = null;
    }
    unsubscribeAudit = onSnapshot(
      collection(db, "courses", courseId, "removalLog"),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        activeCourse.removalLog = snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort(
            (a, b) =>
              ((b.removedAt && b.removedAt.seconds) || 0) -
              ((a.removedAt && a.removedAt.seconds) || 0),
          );
        renderAuditSection();
      },
      (err) => console.error("Audit listener error:", err),
    );
  }

  function renderAuditSection() {
    const container = document.getElementById("auditLogContainer");
    if (!container || !activeCourse) return;

    const removals = activeCourse.removalLog || [];
    const flags = (activeCourse.absentFlags || []).filter(
      (f) => f.status === "flagged",
    );

    if (removals.length === 0 && flags.length === 0) {
      container.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 8px;">No audit events yet. 👍</p>`;
      return;
    }

    const removalRows = removals
      .map((r) => {
        const when =
          r.removedAt && r.removedAt.toDate
            ? r.removedAt.toDate().toLocaleString()
            : "unknown date";
        return `<li style="font-size: 0.85rem; padding: 4px 0;">🚪 <strong>${escapeHTML(r.matric)}</strong> was removed on ${when}</li>`;
      })
      .join("");
    const flagRows = flags
      .map((f) => {
        const when =
          f.flaggedAt && f.flaggedAt.toDate
            ? f.flaggedAt.toDate().toLocaleString()
            : "just now";
        // An audit log is intentionally cumulative across sessions — label
        // each flag so a rep never mistakes a week-1 flag for current.
        const sessionLabel =
          f.sessionExpiresAt
            ? new Date(f.sessionExpiresAt).toLocaleString()
            : "unknown session";
        return `<li style="font-size: 0.85rem; padding: 4px 0;">🚩 <strong>${escapeHTML(f.matric)}</strong> flagged absent on ${when} (by ${escapeHTML(f.flaggedByRole || "rep")}, flagged ${f.flagCount || 1}× total) <span style="color: var(--muted); font-size: 0.72rem;">— session ${escapeHTML(sessionLabel)}</span></li>`;
      })
      .join("");

    container.innerHTML = `
      ${removals.length ? `<h4 style="font-size: 0.85rem; color: var(--navy); margin: 8px 0 4px;">Removed Students (${removals.length})</h4><ul style="list-style: none; padding-left: 0; margin: 0 0 10px;">${removalRows}</ul>` : ""}
      ${flags.length ? `<h4 style="font-size: 0.85rem; color: #dc3545; margin: 8px 0 4px;">Absent Flags (${flags.length})</h4><ul style="list-style: none; padding-left: 0; margin: 0;">${flagRows}</ul>` : ""}
    `;
  }

  // ============================================================
  // SESSION SECURITY SIGNALS (rep view of screenshot/left-app events)
  // ============================================================
  let unsubscribeSecurityEvents = null;

  function startSecurityEventsListener(courseId) {
    if (unsubscribeSecurityEvents) {
      unsubscribeSecurityEvents();
      unsubscribeSecurityEvents = null;
    }
    unsubscribeSecurityEvents = onSnapshot(
      query(
        collection(db, "courses", courseId, "securityEvents"),
        orderBy("loggedAt", "desc"),
      ),
      (snap) => {
        if (!activeCourse || activeCourse.id !== courseId) return;
        activeCourse.securityEvents = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        renderSecurityEventsPanel();
      },
      (err) => console.error("Security events listener error:", err),
    );
  }

  function renderSecurityEventsPanel() {
    const container = document.getElementById("securityEventsContainer");
    const countEl = document.getElementById("securityEventsCount");
    if (!container || !activeCourse) return;
    const events = activeCourse.securityEvents || [];
    if (countEl) countEl.textContent = events.length;
    if (events.length === 0) {
      container.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 8px;">No security signals. 👍</p>`;
      return;
    }

    const sorted = [...events].sort((a, b) => {
      const aT = a.loggedAt && a.loggedAt.toMillis ? a.loggedAt.toMillis() : 0;
      const bT = b.loggedAt && b.loggedAt.toMillis ? b.loggedAt.toMillis() : 0;
      return bT - aT;
    });

    container.innerHTML = "";
    sorted.slice(0, 30).forEach((ev) => {
      const when =
        ev.loggedAt && ev.loggedAt.toDate
          ? ev.loggedAt.toDate().toLocaleString()
          : "just now";
      const isShot = ev.type === "screenshot_attempt";
      const icon = isShot ? "📸" : "👋";
      const label = isShot
        ? `Screenshot attempt (${ev.method || "unknown method"})`
        : `Left the app mid-session for ${Math.round((ev.awayMs || 0) / 1000)}s`;
      const card = document.createElement("div");
      card.style.cssText =
        "background: var(--card-bg); padding: 8px 12px; border-radius: 8px; margin-bottom: 6px; border: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; gap: 8px;";
      card.innerHTML = `
        <span style="font-size: 0.85rem;">${icon} <strong>${escapeHTML(ev.matric || "Unknown")}</strong> — ${escapeHTML(label)}</span>
        <span style="font-size: 0.72rem; color: var(--muted); white-space: nowrap;">${when}</span>
      `;
      container.appendChild(card);
    });
  }

  function stopPortalListeners() {
    stopHotspotLogListener();
    if (unsubscribeSessionLive) {
      unsubscribeSessionLive();
      unsubscribeSessionLive = null;
    }
    if (unsubscribeSessionSecret) {
      unsubscribeSessionSecret();
      unsubscribeSessionSecret = null;
    }
    if (unsubscribeAttendance) {
      unsubscribeAttendance();
      unsubscribeAttendance = null;
    }
    if (unsubscribeDeviceFlags) {
      unsubscribeDeviceFlags();
      unsubscribeDeviceFlags = null;
    }
    if (unsubscribeManualRequests) {
      unsubscribeManualRequests();
      unsubscribeManualRequests = null;
    }
    if (unsubscribeMyManualRequest) {
      unsubscribeMyManualRequest();
      unsubscribeMyManualRequest = null;
    }
    if (unsubscribeAbsentFlags) {
      unsubscribeAbsentFlags();
      unsubscribeAbsentFlags = null;
    }
    if (unsubscribeMyAbsentFlag) {
      unsubscribeMyAbsentFlag();
      unsubscribeMyAbsentFlag = null;
    }
    if (unsubscribeNotifications) {
      unsubscribeNotifications();
      unsubscribeNotifications = null;
    }
    if (unsubscribeGroups) {
      unsubscribeGroups();
      unsubscribeGroups = null;
    }
    if (unsubscribeAudit) {
      unsubscribeAudit();
      unsubscribeAudit = null;
    }
    if (unsubscribeStudentExemptions) {
      unsubscribeStudentExemptions();
      unsubscribeStudentExemptions = null;
    }
    if (unsubscribeSecurityEvents) {
      unsubscribeSecurityEvents();
      unsubscribeSecurityEvents = null;
    }
    // Leaving the portal (or logging out) must also kill the projector view.
    if (window.closeQrMode) window.closeQrMode();
  }

  // ============================================================
  // QR SCAN ENTRY: ?code=XXX&qrpin=1234 → open portal → auto check-in
  // ============================================================
  let pendingQrScan = null;
  let qrScanHandled = false;
  (function parseQrScanParams() {
    try {
      const params = new URLSearchParams(location.search);
      const code = (params.get("code") || "").trim().toUpperCase();
      const pin = (params.get("qrpin") || "").trim();
      if (code && /^\d{4}$/.test(pin)) {
        pendingQrScan = { code, pin };
        // Strip the params so a refresh doesn't re-trigger the flow.
        history.replaceState(null, "", location.pathname);
      }
    } catch (err) {
      /* no-op */
    }
  })();

  function tryHandlePendingQrScan() {
    if (qrScanHandled || !pendingQrScan || !currentUser) return;
    const match = courses.find(
      (c) => (c.code || "").toUpperCase() === pendingQrScan.code,
    );
    if (!match) return; // courses not loaded yet — the next snapshot retries
    qrScanHandled = true;
    const { pin } = pendingQrScan;

    window.openPortal(match.id);
    const portalSection = document.getElementById("portalSection");
    if (portalSection && portalSection.classList.contains("hidden")) {
      // openPortal rejected us (not enrolled / not staff) — it already toasts.
      return;
    }

    const pinInput = document.getElementById("studentPinInput");
    const form = document.getElementById("checkInForm");
    if (pinInput && form) {
      pinInput.value = pin;
      toast.success(`Scanned code ${pin} — checking you in...`, "QR Scan 📸");
      // Give the portal a beat to settle, then auto-submit through the SAME
      // pipeline (UUID lock + geofence + PIN validation). If GPS or network is
      // slow, the PIN stays filled for a manual retry.
      setTimeout(() => {
        try {
          if (typeof form.requestSubmit === "function") {
            form.requestSubmit();
          } else {
            form.dispatchEvent(new Event("submit", { cancelable: true }));
          }
        } catch (err) {
          console.warn("QR auto-submit skipped:", err);
        }
      }, 400);
    }
  }

  // ============================================================
  // 📸 IN-APP QR SCANNER — students scan the class QR from their seat,
  // inside VeriPresenX (no third-party camera app). Uses the browser's
  // native BarcodeDetector (supported by every Android Chrome — the
  // student population's reality). Unsupported/denied browsers get a
  // clear message and fall back to the camera-app deep-link flow.
  // Detection REUSES the deep-link pipeline: the scanned URL sets
  // pendingQrScan → tryHandlePendingQrScan() routes, fills the PIN and
  // auto-submits through the SAME submit handler (device lock etc).
  // ============================================================
  let qrScannerStream = null;
  let qrScannerInterval = null;

  function stopQrScanner() {
    if (qrScannerInterval) {
      clearInterval(qrScannerInterval);
      qrScannerInterval = null;
    }
    if (qrScannerStream) {
      qrScannerStream.getTracks().forEach((t) => t.stop());
      qrScannerStream = null;
    }
    const sheet = document.getElementById("qrScannerSheet");
    if (sheet) sheet.classList.add("hidden");
  }

  function handleScannedQrText(text) {
    try {
      const url = new URL(String(text).trim(), location.origin);
      const code = (url.searchParams.get("code") || "").trim().toUpperCase();
      const pin = (url.searchParams.get("qrpin") || "").trim();
      if (!code || !/^\d{4}$/.test(pin)) {
        toast.warning(
          "That QR isn't an VeriPresenX class code. Point at the QR shown by your Course Rep.",
          "Wrong Code",
        );
        return false; // keep scanning
      }
      const match = courses.find(
        (c) => (c.code || "").toUpperCase() === code,
      );
      if (!match) {
        stopQrScanner();
        toast.error(
          `You are not enrolled in ${code}. Join the course first, then scan again.`,
          "Not Enrolled",
        );
        return true;
      }
      stopQrScanner();
      // Same entry as the camera-app deep link — the whole existing
      // routing (open portal, fill PIN, auto-submit) takes over from here.
      pendingQrScan = { code, pin };
      qrScanHandled = false;
      tryHandlePendingQrScan();
      return true;
    } catch (_) {
      return false; // unparsable — keep scanning
    }
  }

  window.openQrScanner = async function () {
    const sheet = document.getElementById("qrScannerSheet");
    const video = document.getElementById("qrScannerVideo");
    const status = document.getElementById("qrScannerStatus");
    if (!sheet || !video || !currentUser) return;

    sheet.classList.remove("hidden");
    if (status) status.textContent = "Starting camera…";
    try {
      qrScannerStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      video.srcObject = qrScannerStream;
      if (status) status.textContent = "Looking for a QR code…";
    } catch (err) {
      console.error("QR scanner camera error:", err);
      stopQrScanner();
      toast.error(
        "Camera access was blocked. Allow camera permission for VeriPresenX, or type the PIN below.",
        "Camera Blocked",
      );
      return;
    }

    // G4 📱 FULL SCANNER COVERAGE: Android Chrome uses the native
    // BarcodeDetector. Everywhere else (iOS Safari etc.) we lazily load the
    // tiny jsQR decoder from a CDN and decode canvas frames in-app — so no
    // student is ever forced out of VeriPresenX to scan. If the CDN is
    // unreachable, the clear fallback message still appears.
    const useNative = "BarcodeDetector" in window;
    if (!useNative) {
      try {
        if (status) status.textContent = "Loading scanner engine…";
        const mod = await import(
          "https://unpkg.com/jsqr@1.4.0/dist/jsQR.js"
        );
        window.__jsQR = (mod && (mod.jsQR || mod.default)) || window.jsQR;
      } catch (_) {
        window.__jsQR = null;
      }
      if (!window.__jsQR) {
        stopQrScanner();
        toast.info(
          "This browser can't scan in-app right now (scanner engine unreachable). Use your camera app on the class QR — VeriPresenX opens and checks you in automatically — or type the PIN below.",
          "Scanner Unavailable",
        );
        return;
      }
    }

    let detector = null;
    let canvas = null;
    try {
      if (useNative) {
        detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      }
    } catch (err) {
      console.error("BarcodeDetector setup error:", err);
      stopQrScanner();
      toast.info(
        "Scanning isn't supported here. Use your camera app on the class QR — VeriPresenX opens and checks you in automatically.",
        "Scanner Unavailable",
      );
      return;
    }

    qrScannerInterval = setInterval(async () => {
      if (!qrScannerStream || video.readyState < 2) return;
      try {
        if (useNative && detector) {
          const codes = await detector.detect(video);
          if (codes && codes.length > 0 && codes[0].rawValue) {
            handleScannedQrText(codes[0].rawValue);
            if (status && !sheet.classList.contains("hidden")) {
              status.textContent = "✅ QR detected — checking you in…";
            }
          }
          return;
        }
        // jsQR path: snap a canvas frame and decode it.
        const w = Math.min(video.videoWidth || 640, 960);
        const h = Math.round(w * ((video.videoHeight || 480) / Math.max(1, video.videoWidth || 640)));
        if (!canvas) {
          canvas = document.createElement("canvas");
        }
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const result = window.__jsQR(img.data, w, h);
        if (result && result.data) {
          handleScannedQrText(result.data);
          if (status && !sheet.classList.contains("hidden")) {
            status.textContent = "✅ QR detected — checking you in…";
          }
        }
      } catch (_) {
        /* frame not ready — next tick retries */
      }
    }, 250);
  };

  const scanQrBtn = document.getElementById("scanQrBtn");
  if (scanQrBtn)
    scanQrBtn.addEventListener("click", () => window.openQrScanner());
  const qrScannerCloseBtn = document.getElementById("qrScannerCloseBtn");
  if (qrScannerCloseBtn)
    qrScannerCloseBtn.addEventListener("click", () => stopQrScanner());

  window.openPortal = function (courseId) {
    const selectedCourse = courses.find((c) => c.id === courseId);
    if (!selectedCourse) return;

    replaceNavState("portal");
    const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");
    const isRep = currentUser && selectedCourse.repUid === currentUser.uid;
    const isAssistant =
      currentUser &&
      (selectedCourse.assistants || [])
        .map(normalizeMatric)
        .includes(userMatric);
    const isEnrolled =
      currentUser &&
      (selectedCourse.enrolled || []).map(normalizeMatric).includes(userMatric);

    if (!isRep && !isAssistant && !isEnrolled) {
      toast.warning(
        `You are not enrolled in "${selectedCourse.name}". Join using code [${selectedCourse.code}] first.`,
        "Access Denied",
      );
      return;
    }

    activeCourse = selectedCourse;

    if (dashboardSection) dashboardSection.classList.add("hidden");
    if (portalSection) portalSection.classList.remove("hidden");

    document.getElementById("portalCourseTitle").textContent =
      activeCourse.name;
    document.getElementById("portalCourseCode").textContent = activeCourse.code;
    document.getElementById("portalCourseRep").textContent = activeCourse.rep;

    const repControls = document.getElementById("repControls");
    const studentControls = document.getElementById("studentControls");
    const repArchiveSection = document.getElementById("repArchiveSection");
    const assistantManagementSection = document.getElementById(
      "assistantManagementSection",
    );

    if (isRep || isAssistant) {
      if (repControls) repControls.classList.remove("hidden");
      if (studentControls) studentControls.classList.add("hidden");

      // Mission-Control drawer: show the tab only for staff, default to the
      // check-in view.
      syncDrawerTabVisibility();
      showDrawerView("checkin");

      // Course Maintenance toolbar: visible to reps AND assistants (group
      // leads manage their own groups). Rep-only actions stay protected by
      // the backend regardless of who can see the buttons.
      const managementToolbar = document.getElementById("managementToolbar");
      if (managementToolbar) managementToolbar.classList.remove("hidden");
      hideAllManagementPanels();
      if (isRep) {
        renderAssistantDropdownAndList();
        populateExemptStudentDropdown();
        loadExemptions();
        startAuditListener(courseId);
        startSecurityEventsListener(courseId);
      }
      renderLectureHallOptions();
      syncHotspotChrome();
    } else {
      if (repControls) repControls.classList.add("hidden");
      hideAllManagementPanels();
      const mgmtToolbarEl = document.getElementById("managementToolbar");
      if (mgmtToolbarEl) mgmtToolbarEl.classList.add("hidden");

      // Students get their own Mission-Control drawer too. Default to the
      // Check-in view (one thing at a time, just like the rep) instead of
      // stacking everything on the page.
      showStudentView("checkin");

      if (typeof syncDrawerTabVisibility === "function") {
        syncDrawerTabVisibility();
      }
      syncStudentNav();
    }

    syncSemesterReportPanel();
    renderPortalState();
    startAttendanceHistoryListener(courseId);
    startSessionLiveListener(courseId);
    startGroupsListener(courseId);
    if (isRep || isAssistant) {
      startSessionSecretListener(courseId);
      startDeviceFlagsListener(courseId);
      startManualRequestsListener(courseId);
      startAbsentFlagsListener(courseId);
    } else {
      startMyManualRequestListener(courseId);
      startMyAbsentFlagListener(courseId);
      syncManualOverrideUI();
      startStudentExemptionsListener(courseId, userMatric);
    }
  };

  const backToDashboardBtn = document.getElementById("backToDashboard");
  if (backToDashboardBtn) {
    backToDashboardBtn.addEventListener("click", () => {
      returnToDashboard();
    });
  }

  // Shared by the header button AND the Android back button/swipe — one
  // code path so navigation behaves identically no matter how it's triggered.
  function returnToDashboard() {
    if (portalSection) portalSection.classList.add("hidden");
    if (dashboardSection) dashboardSection.classList.remove("hidden");

    hideAllManagementPanels();
    const mgmtToolbarBack = document.getElementById("managementToolbar");
    if (mgmtToolbarBack) mgmtToolbarBack.classList.add("hidden");

    activeCourse = null;
    if (countdownInterval) clearInterval(countdownInterval);
    stopPortalListeners();
    replaceNavState("dashboard");
  }
  window.__veripresenxReturnToDashboard = returnToDashboard;

  // --- CREATE COURSE FORM ---
  const createCourseForm = document.getElementById("createCourseForm");
  if (createCourseForm) {
    createCourseForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = createCourseForm.querySelector("button[type='submit']");
      const originalBtnText = submitBtn ? submitBtn.textContent : "";

      const name = document.getElementById("courseTitle").value.trim();
      const code = normalizeCourseCode(
        document.getElementById("courseCodeInput").value,
      );

      const repInstitution = currentUser
        ? currentUser.institution || "GENERAL"
        : "GENERAL";
      const repDepartment = currentUser
        ? currentUser.department || "GENERAL"
        : "GENERAL";
      const repLevel = currentUser ? currentUser.level || "GENERAL" : "GENERAL";
      const studentMatric = normalizeMatric(
        currentUser ? currentUser.matric : "",
      );

      if (!studentMatric) {
        toast.warning(
          "Your profile isn't fully loaded yet. Please wait a moment and try again.",
        );
        return;
      }

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Creating... ⏳";
        }

        // Query Firestore directly for the duplicate check instead of the
        // in-memory `courses` array — that array may not have finished
        // loading yet on a fresh page, the exact same race that used to make
        // "Join Course" say a real code wasn't found.
        const dupSnap = await getDocs(
          query(
            collection(db, "courses"),
            where("code", "==", code),
            where("institution", "==", repInstitution),
            where("level", "==", repLevel),
          ),
        );
        const duplicateExists = dupSnap.docs.some(
          (d) =>
            (d.data().department || "").toLowerCase() ===
            repDepartment.toLowerCase(),
        );

        if (duplicateExists) {
          toast.warning(
            `Course code "${code}" already exists in your department (${repDepartment} - ${repLevel}).`,
            "Course Code Taken",
          );
          return;
        }

        const newCourse = {
          name,
          code,
          rep: currentUser ? currentUser.name : "Unknown",
          repUid: currentUser ? currentUser.uid : "unknown-uid",
          institution: repInstitution,
          department: repDepartment,
          level: repLevel,
          enrolled: [studentMatric],
          assistants: [],
          attendanceHistory: [],
          activeSession: null,
        };

        const newDocRef = doc(collection(db, "courses"));
        await setDoc(newDocRef, newCourse);

        // Add the Rep to the secure members subcollection instantly
        await setDoc(
          doc(db, "courses", newDocRef.id, "members", currentUser.uid),
          {
            uid: currentUser.uid,
            matric: studentMatric,
            name: currentUser.name,
            role: "rep",
            joinedAt: Date.now(),
          },
        );

        // Update local state immediately rather than waiting on the
        // background listener's next snapshot round-trip.
        courses.push({ id: newDocRef.id, ...newCourse });

        if (createModal) createModal.classList.remove("show");
        createCourseForm.reset();
        checkAuth();
        toast.success(
          `"${name}" is ready. Share the code with your class!`,
          "Course Created 🚀",
        );
      } catch (error) {
        console.error("Create course error:", error);
        toast.error(
          "Something went wrong while creating the course. Check your connection.",
        );
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = originalBtnText;
        }
      }
    });
  }

  // --- COURSE MAINTENANCE TOOLBAR (accordion) ---
  // The four heavy management panels stay collapsed by default so the course
  // portal is short. Each toolbar button opens exactly one and closes the rest.
  function hideAllManagementPanels() {
    [
      "bulkImportSection",
      "exemptionManagementSection",
      "assistantManagementSection",
      "repEnrolledStudentsSection",
      "repArchiveSection",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    document
      .querySelectorAll(".manage-tool-btn")
      .forEach((b) => b.classList.remove("active"));
  }

  window.toggleManagementPanel = function (panelId) {
    hideAllManagementPanels();
    const target = document.getElementById(panelId);
    const targetBtn = Array.from(
      document.querySelectorAll(".manage-tool-btn"),
    ).find((b) => b.dataset.panel === panelId);
    if (target && target.classList.contains("hidden")) {
      target.classList.remove("hidden");
      if (targetBtn) targetBtn.classList.add("active");
      setTimeout(
        () => target.scrollIntoView({ behavior: "smooth", block: "start" }),
        60,
      );
    }
  };

  document
    .querySelectorAll(".manage-tool-btn")
    .forEach((b) => {
      if (!b.dataset.panel) return;
      b.addEventListener("click", (ev) => {
        ev.currentTarget.blur();
        window.toggleManagementPanel(b.dataset.panel);
      });
    });

// ============================================================
  // 🎛️ MISSION-CONTROL DRAWER — one portal view at a time.
  // The tab (draggable, edge-remembering) opens a slim slide-out from
  // whichever edge it's docked on. Staff/assistant-only chrome; students
  // never see it. Badges persist until the rep actually opens each view.
  // ============================================================
  const drawerTab = document.getElementById("drawerTab");
  const drawerTabBadge = document.getElementById("drawerTabBadge");
  const portalDrawer = document.getElementById("portalDrawer");
  const drawerBackdrop = document.getElementById("drawerBackdrop");
  const drawerCloseBtn = document.getElementById("drawerCloseBtn");

  // Which rep-view is showing right now. "checkin" = setup+live cards.
  let activeDrawerView = "checkin";
  // Which STUDENT-drawer view is showing right now (separate from the rep one).
  let activeStudentView = "checkin";
  let isDrawerOpen = false;

  // Unseen counts, keyed by drawer destination. Raising the badge value
  // waits until the rep actually opens that view, then clears.
  const drawerUnseen = {
    checkin: 0,
    roster: 0,
    students: 0,
    assistants: 0,
    bulk: 0,
    exemptions: 0,
    archive: 0,
    analytics: 0,
  };

  function capFirst(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  function setDrawerBadge(view, count) {
    drawerUnseen[view] = Math.max(0, count);
    const badgeEl = document.getElementById(`badge${capFirst(view)}`);
    if (badgeEl) {
      badgeEl.textContent = String(count);
      badgeEl.classList.toggle("hidden", count === 0);
    }
    updateDrawerTabBadge();
  }

  function updateDrawerTabBadge() {
    if (!drawerTabBadge) return;
    const total = Object.values(drawerUnseen).reduce(
      (sum, n) => sum + (n || 0),
      0,
    );
    drawerTabBadge.textContent = String(total);
    drawerTabBadge.classList.toggle("hidden", total === 0);
  }

  function markDrawerViewSeen(view) {
    if (drawerUnseen[view] > 0) setDrawerBadge(view, 0);
  }

  function openPortalDrawer() {
    isDrawerOpen = true;
    if (portalDrawer) portalDrawer.classList.add("show");
    if (drawerBackdrop) drawerBackdrop.classList.add("show");
    refreshIcons();
  }

  function closePortalDrawer() {
    isDrawerOpen = false;
    if (portalDrawer) portalDrawer.classList.remove("show");
    if (drawerBackdrop) drawerBackdrop.classList.remove("show");
  }
  // --- JOIN COURSE FORM ---
// One view at a time. Every section hides first, then exactly one target
  // shows. Connected panels (checkin includes manual requests + headcount;
  // archive includes audit/device flags/security signals) travel together.
  function showDrawerView(view) {
    if (!view || typeof view !== "string") return;
    if (!/^[a-z]+$/.test(view)) return;
    activeDrawerView = view;

    const allSections = [
      "sessionSetupCard",
      "liveSessionCard",
      "bulkImportSection",
      "exemptionManagementSection",
      "assistantManagementSection",
      "repEnrolledStudentsSection",
      "repArchiveSection",
      "studentAnalyticsSection",
      "rosterSection",
    ];
    allSections.forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });

    // Set the active class on drawer items + clear the badge for this view.
    document
      .querySelectorAll(".drawer-item")
      .forEach((b) => b.classList.remove("active"));
    const item = document.querySelector(`[data-view="${view}View"]`);
    if (item) item.classList.add("active");
    markDrawerViewSeen(view);

    switch (view) {
      case "checkin":
        syncRepPhaseUI();
        break;
      case "roster": {
        const el = document.getElementById("rosterSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "bulk": {
        const el = document.getElementById("bulkImportSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "exemptions": {
        const el = document.getElementById("exemptionManagementSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "assistants": {
        const el = document.getElementById("assistantManagementSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "students": {
        const el = document.getElementById("repEnrolledStudentsSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "archive": {
        const el = document.getElementById("repArchiveSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      case "analytics": {
        const el = document.getElementById("studentAnalyticsSection");
        if (el) el.classList.remove("hidden");
        break;
      }
      default:
        break;
    }

    closePortalDrawer();

    const targetEl = document.getElementById(
      {
        checkin: "liveSessionCard",
        roster: "rosterSection",
        bulk: "bulkImportSection",
        exemptions: "exemptionManagementSection",
        assistants: "assistantManagementSection",
        students: "repEnrolledStudentsSection",
        archive: "repArchiveSection",
        analytics: "studentAnalyticsSection",
      }[view] || "sessionSetupCard",
    );
    if (targetEl) {
      setTimeout(
        () => targetEl.scrollIntoView({ behavior: "smooth", block: "start" }),
        60,
      );
    }
  }

  // Drawer nav item clicks.
// Who is the current user in the active course?
  function isRepForActiveCourse() {
    return Boolean(
      activeCourse && currentUser && activeCourse.repUid === currentUser.uid,
    );
  }
  function isAssistantForActiveCourse() {
    if (!activeCourse || !currentUser) return false;
    const userMatric = normalizeMatric(currentUser.matric);
    return Boolean(
      (activeCourse.assistants || [])
        .map(normalizeMatric)
        .includes(userMatric),
    );
  }
  // A session hotspot is a TRUSTED STUDENT promoted for one class only —
  // not real staff. Their single job: display the rotating QR.
  function isSessionHotspotForActiveCourse() {
    if (!activeCourse || !currentUser) return false;
    if (isRepForActiveCourse()) return false;
    if (!isAssistantForActiveCourse()) return false;
    const rec = (activeCourse.members || []).find(
      (m) => normalizeMatric(m.matric) === normalizeMatric(currentUser.matric),
    );
    return Boolean(rec && rec.role === "session_assistant");
  }

  // 📡 HOTSPOT CHROME: strips every rep-only control from a hotspot's
  // screen — setup card, Close Class, headcount, manual queue, maintenance
  // toolbar, Mission-Control drawer — leaving only the live QR card and the
  // fullscreen "Show Rotating QR" button. closeSession.js matches this by
  // refusing session_assistant close requests server-side.
  function syncHotspotChrome() {
    if (!activeCourse || !currentUser) return;
    if (!isRepForActiveCourse() && !isAssistantForActiveCourse()) {
      const rc = document.getElementById("repControls");
      if (rc) rc.classList.remove("hotspot-view");
      return; // plain student — the student chrome handles everything
    }
    const isSessionHotspot = isSessionHotspotForActiveCourse();
    const repControls = document.getElementById("repControls");
    if (repControls && !repControls.classList.contains("hidden")) {
      repControls.classList.toggle("hotspot-view", isSessionHotspot);
    }
    const toolbar = document.getElementById("managementToolbar");
    if (toolbar) toolbar.classList.toggle("hidden", isSessionHotspot);
    const title = document.getElementById("repControlsTitle");
    if (title) {
      title.innerHTML = isSessionHotspot
        ? '<i data-lucide="radio"></i> 📡 Hotspot Screen — hold this up for students'
        : '<i data-lucide="shield-check"></i> Course Rep Control Center';
      if (typeof refreshIcons === "function") refreshIcons();
    }
    if (typeof syncDrawerTabVisibility === "function") {
      syncDrawerTabVisibility();
    }
  }

  // Show the tab only inside a portal for staff/assistants.
  function syncDrawerTabVisibility() {
    if (!drawerTab) return;
    const inPortal = Boolean(
      activeCourse &&
        portalSection &&
        !portalSection.classList.contains("hidden"),
    );
    // Staff chrome: the drawer is for the rep and permanent assistants —
    // session hotspots get the focused hotspot screen instead (their only
    // job is the QR, and everything they need lives on the portal itself).
    const staff =
      isRepForActiveCourse() ||
      (isAssistantForActiveCourse() && !isSessionHotspotForActiveCourse());
    // Plain students also get the side menu (their own tools) while inside
    // a portal. Hotspots are excluded — they stay on the focused QR screen.
    const isPlainStudent = inPortal && !staff && !isSessionHotspotForActiveCourse();
    const showTab = inPortal && (staff || isPlainStudent);
    drawerTab.classList.toggle("hidden", !showTab);
    if (!showTab && isDrawerOpen) closePortalDrawer();
    syncStudentNav();
  }

  // Draggable tab — pointer + touch, moves along the chosen axis, clamps to
  // the viewport, and remembers its edge + offset for next time.
  let tabDragState = null;

  function startTabDrag(e, pointer) {
    if (!drawerTab) return;
    const edge = drawerTab.dataset.edge || "right";
    const horizontalEdge = edge === "top" || edge === "bottom";
    // Base = where the tab's offset ACTUALLY is right now (inline value, or
    // the CSS default for this edge). Deltas apply on top of this — the old
    // code seeded from the raw pointer point, so every grab teleported the
    // tab and repeated taps walked it down the screen.
    let base = parseFloat(drawerTab.style.getPropertyValue("--tab-offset"));
    const hadCustom = !Number.isNaN(base);
    if (!hadCustom) {
      base = horizontalEdge
        ? Math.round(window.innerWidth * 0.4)
        : window.innerWidth >= 768
          ? 84
          : 76;
    }
    tabDragState = {
      edge,
      horizontalEdge,
      start: pointer,
      base,
      hadCustom,
      moved: false,
    };
    drawerTab.classList.add("dragging");
    drawerTab.setPointerCapture?.(e.pointerId);
  }

  // The tab lives in a fixed band near the top: never above the sticky
  // navbar, never below ~55% of the viewport. Enforced on drag, restore
  // AND resize — it can never sink out of sight again.
  const TAB_MIN = 72;

  function tabMaxOffset() {
    const h = (drawerTab && drawerTab.offsetHeight) || 80;
    return Math.max(
      TAB_MIN + 40,
      Math.min(
        Math.round(window.innerHeight * 0.55),
        window.innerHeight - h - 16,
      ),
    );
  }

  function clampTabToViewport() {
    if (!drawerTab) return;
    const edge = drawerTab.dataset.edge || "right";
    if (edge === "top" || edge === "bottom") return; // flush to an edge = always visible
    const raw = parseFloat(drawerTab.style.getPropertyValue("--tab-offset"));
    if (Number.isNaN(raw)) return; // nothing custom set — CSS default (near top) applies
    drawerTab.style.setProperty(
      "--tab-offset",
      `${Math.max(TAB_MIN, Math.min(tabMaxOffset(), raw))}px`,
    );
  }

  function updateTabDrag(pointer) {
    if (!tabDragState || !drawerTab) return;
    // Move uses the drag delta applied to the grab-time base: the tab follows
    // the finger 1:1 with no teleport. Track whether it actually moved so a
    // plain tap can still open the drawer (click fires after pointerup).
    const horizontalEdge = tabDragState.horizontalEdge;
    const delta = horizontalEdge
      ? pointer.x - tabDragState.start.x
      : pointer.y - tabDragState.start.y;
    if (Math.abs(delta) > 6) tabDragState.moved = true;
    // Keep the tab in the visible band below the navbar — and never below
    // the top ~55% of the screen, so it can't sink out of sight.
    const max = horizontalEdge
      ? window.innerWidth - 60
      : tabMaxOffset();
    const pos = Math.max(TAB_MIN, Math.min(max, tabDragState.base + delta));
    drawerTab.style.setProperty("--tab-offset", `${pos}px`);
  }

  function endTabDrag() {
    if (!tabDragState || !drawerTab) return;
    tabDragState = null;
    drawerTab.classList.remove("dragging");
    try {
      drawerTab.releasePointerCapture?.();
    } catch (e) {
      /* ignore */
    }
    persistTabPosition();
  }

  function persistTabPosition() {
    if (!drawerTab) return;
    const edge = drawerTab.dataset.edge || "right";
    const offsetVal = drawerTab.style.getPropertyValue("--tab-offset");
    try {
      localStorage.setItem(
        "veripresenx_drawer_tab_v5",
        JSON.stringify({ edge, offset: offsetVal }),
      );
    } catch (e) {
      /* ignore */
    }
  }

  function restoreTabPosition() {
    if (!drawerTab) return;
    try {
      const raw =
        localStorage.getItem("veripresenx_drawer_tab_v5") ||
        localStorage.getItem("veripresenx_drawer_tab_v4");
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.edge) {
        drawerTab.dataset.edge = saved.edge;
        if (saved.offset) {
          // Clamp the saved offset to the CURRENT viewport — a position
          // stored on a different screen size (or before an edge rotation)
          // could otherwise restore the tab off-screen, hiding it forever.
          const val = parseFloat(saved.offset);
          if (!Number.isNaN(val)) {
            const horizontalEdge =
              saved.edge === "top" || saved.edge === "bottom";
            const max = horizontalEdge
              ? window.innerWidth - 60
              : tabMaxOffset();
            const clamped = Math.max(TAB_MIN, Math.min(max, val));
            drawerTab.style.setProperty("--tab-offset", `${clamped}px`);
          }
        }
      }
    } catch (e) {
      /* ignore */
    }
  }

  // Mouse dragging.
  if (drawerTab) {
    drawerTab.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      startTabDrag(e, { x: e.clientX, y: e.clientY });
    });
    drawerTab.addEventListener("pointermove", (e) => {
      if (!tabDragState) return;
      updateTabDrag({ x: e.clientX, y: e.clientY });
      if (e.pointerType === "touch") e.preventDefault();
    });
    drawerTab.addEventListener("pointerup", () => {
      // No drag happened → plain tap: leave the offset exactly as it was (a
      // few px of finger wobble stays inside the 6px dead zone), then let the
      // normal click handler open the drawer. Only real drags are persisted.
      const wasTap = tabDragState && !tabDragState.moved;
      const hadCustom = tabDragState && tabDragState.hadCustom;
      endTabDrag();
      // endTabDrag persisted our (unchanged) offset — but a pure tap must not
      // CREATE a stored position out of nothing: without a custom offset
      // before, keep the CSS default.
      if (wasTap && !hadCustom) {
        drawerTab.style.removeProperty("--tab-offset");
        try {
          localStorage.removeItem("veripresenx_drawer_tab_v5");
        } catch (e) {
          /* ignore */
        }
      }
    });
    drawerTab.addEventListener("pointercancel", endTabDrag);
    // Long-press / right-click rotates the docked edge.
    drawerTab.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const edges = ["right", "bottom", "left", "top"];
      const next =
        edges[
          (edges.indexOf(drawerTab.dataset.edge || "right") + 1) % 4
        ];
      drawerTab.dataset.edge = next;
      drawerTab.style.removeProperty("--tab-offset");
      persistTabPosition();
    });
  }

  restoreTabPosition();
  // Zoom / window resize changes the CSS viewport — re-clamp so the tab can
  // never end up off-screen after the window changes shape.
  window.addEventListener("resize", clampTabToViewport);

  // Expose for back-button: drawer open → close drawer (modal-like trap).
  window.__veripresenxCloseDrawer = () => {
    if (isDrawerOpen) {
      closePortalDrawer();
      return true;
    }
    return false;
  };

  // Whenever the portal is closed, reset to the default view and hide the tab.
  const _drwReturnToDashboard =
    window.__veripresenxReturnToDashboard || function () {};
  window.__veripresenxReturnToDashboard = function () {
    closePortalDrawer();
    syncDrawerTabVisibility();
    _drwReturnToDashboard();
  };
  document
    .querySelectorAll(".drawer-item")
    .forEach((b) => {
      const view = b.dataset.view;
      if (!view) return;
      b.addEventListener("click", () => {
        showDrawerView(view.replace("View", ""));
      });
    });

  // ============================================================
  // 🎓 STUDENT MISSION-CONTROL DRAWER — students get the same one-view-at-
  // a-time side menu, but with their OWN tools: Check-in, Class Roster,
  // My Analytics, Class Exemptions (public board), Class Reports. The rep
  // drawer (showDrawerView) and its badges are untouched.
  // ============================================================
  const STUDENT_VIEWS = {
    checkin: "studentControls",
    roster: "rosterSection",
    analytics: "studentAnalyticsSection",
    exemptions: "classExemptionsSection",
    reports: "classReportsSection",
  };

  function showStudentView(view) {
    if (!view || !STUDENT_VIEWS[view]) return;
    activeStudentView = view;
    // Hide every student-side surface first, then show exactly one.
    Object.values(STUDENT_VIEWS).forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.classList.add("hidden");
    });
    const showEl = document.getElementById(STUDENT_VIEWS[view]);
    if (showEl) showEl.classList.remove("hidden");

    // Active state on the student nav items only.
    document
      .querySelectorAll(".drawer-item.student-only")
      .forEach((b) => b.classList.remove("active"));
    const item = document.querySelector(`[data-student-view="${view}View"]`);
    if (item) item.classList.add("active");

    if (view === "exemptions") renderStudentClassExemptions();
    if (view === "reports") renderClassReports();

    closePortalDrawer();
    if (showEl) {
      setTimeout(
        () => showEl.scrollIntoView({ behavior: "smooth", block: "start" }),
        60,
      );
    }
  }

  document
    .querySelectorAll(".drawer-item[data-student-view]")
    .forEach((b) => {
      const view = b.dataset.studentView;
      if (!view) return;
      b.addEventListener("click", () => {
        showStudentView(view.replace("View", ""));
      });
    });

  function syncStudentNav() {
    const inPortal = Boolean(
      activeCourse &&
        portalSection &&
        !portalSection.classList.contains("hidden"),
    );
    // Plain enrolled students get the student drawer set; staff/hotspots don't.
    const isPlainStudent =
      inPortal &&
      !isRepForActiveCourse() &&
      !isAssistantForActiveCourse();
    document.querySelectorAll(".drawer-item.staff-only").forEach((b) =>
      b.classList.toggle("hidden", isPlainStudent),
    );
    document.querySelectorAll(".drawer-item.student-only").forEach((b) => {
      b.classList.toggle("hidden", !isPlainStudent);
      if (!isPlainStudent) b.classList.remove("active");
    });
  }

  // 🛡️ PUBLIC class exemptions board: who is excused and on which dates.
  // The stored reason lives in the staff-only exemptionReasons collection,
  // so this view can never leak a private reason even if rules change.
  async function renderStudentClassExemptions() {
    const listEl = document.getElementById("classExemptionsList");
    if (!listEl || !activeCourse) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "courses", activeCourse.id, "exemptions"),
          orderBy("date", "desc"),
          limit(50),
        ),
      );
      const exemptions = snap.docs.map((d) => d.data());
      if (exemptions.length === 0) {
        listEl.innerHTML =
          '<p style="font-size:0.85rem; color:var(--muted); text-align:center; padding:10px;">No exemptions recorded yet.</p>';
        return;
      }
      listEl.innerHTML = exemptions
        .map((x) =>
          `<div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; border:1px solid var(--border); border-radius:8px; margin-bottom:6px; background:var(--card-bg);">
            <span style="font-size:0.85rem;">🎓 <strong>${escapeHTML(x.matric || "?")}</strong></span>
            <span style="font-size:0.75rem; color:var(--muted);">🛡️ ${escapeHTML(x.date || "?")}</span>
          </div>`,
        )
        .join("");
    } catch (err) {
      console.error("Class exemptions render error:", err);
      listEl.innerHTML =
        '<p style="font-size:0.85rem; color:var(--danger); text-align:center; padding:10px;">Could not load exemptions.</p>';
    }
  }

  // 📚 PUBLIC class reports: closed classes with present count, headcount
  // comparison, flags, auto-marked creator, and the Hotspots used. Same
  // facts the rep's archive shows — without other students' private details.
  async function renderClassReports() {
    const listEl = document.getElementById("classReportsList");
    if (!listEl || !activeCourse) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "courses", activeCourse.id, "attendance"),
          orderBy("closedAt", "desc"),
          limit(15),
        ),
      );
      const records = snap.docs.map((d) => d.data());
      if (records.length === 0) {
        listEl.innerHTML =
          '<p style="font-size:0.85rem; color:var(--muted); text-align:center; padding:10px;">No closed classes yet.</p>';
        return;
      }
      listEl.innerHTML = records
        .map((r) => {
          const present = (r.attendees || []).length;
          const pc = r.physicalHeadcount;
          const headcountLine =
            Number.isInteger(pc)
              ? pc === present
                  ? `<span style="color:#28a745;">✔ Headcount ${pc} matches system ${present}</span>`
                  : `<span style="color:#fd7e14;">⚠️ Physical headcount ${pc} vs system ${present}</span>`
              : `<span style="color:var(--muted);">No headcount taken</span>`;
          const flags = (r.flaggedAbsent || []).length;
          const auto =
            (r.autoMarked || []).map((a) => a.matric).join(", ") || "none";
          const hotspots =
            (r.hotspots || []).length > 0
              ? (r.hotspots || [])
                  .map((h) => `${h.name || h.matric}${h.grantedByMatric ? ` (by ${h.grantedByMatric})` : ""}`)
                  .join(", ")
              : "none";
          return `<div style="background:var(--card-bg); padding:10px 12px; border-radius:8px; margin-bottom:8px; border:1px solid var(--border);">
            <div style="font-size:0.85rem; font-weight:700; color:var(--navy);">📅 ${escapeHTML(r.date || "Unknown date")}</div>
            <div style="font-size:0.8rem; color:var(--text); margin-top:4px;">👥 <strong>${present}</strong> present · ${headcountLine}</div>
            <div style="font-size:0.78rem; color:var(--muted); margin-top:3px;">🚩 ${flags} flagged · ✒️ auto-marked: ${escapeHTML(auto)} · 📡 Hotspots: ${escapeHTML(hotspots)}</div>
          </div>`;
        })
        .join("");
    } catch (err) {
      console.error("Class reports render error:", err);
      listEl.innerHTML =
        '<p style="font-size:0.85rem; color:var(--danger); text-align:center; padding:10px;">Could not load class reports.</p>';
    }
  }

  const refreshClassReportsBtnEl = document.getElementById(
    "refreshClassReportsBtn",
  );
  if (refreshClassReportsBtnEl)
    refreshClassReportsBtnEl.addEventListener("click", () =>
      renderClassReports(),
    );

  if (drawerTab) {
    drawerTab.addEventListener("click", () => {
      if (!activeCourse) {
        drawerTab.classList.add("hidden");
        return;
      }
      const canOpen =
        isRepForActiveCourse() ||
        isAssistantForActiveCourse() ||
        !isSessionHotspotForActiveCourse();
      if (!canOpen) {
        drawerTab.classList.add("hidden");
        return;
      }
      if (isDrawerOpen) closePortalDrawer();
      else openPortalDrawer();
    });
  }

  if (drawerCloseBtn) drawerCloseBtn.addEventListener("click", closePortalDrawer);

  if (drawerBackdrop) {
    drawerBackdrop.addEventListener("click", closePortalDrawer);
  }
  const joinCourseForm = document.getElementById("joinCourseForm");
  if (joinCourseForm) {
    joinCourseForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const submitBtn = joinCourseForm.querySelector("button[type='submit']");
      const code = normalizeCourseCode(
        document.getElementById("joinCode").value,
      );
      const studentMatric = normalizeMatric(
        currentUser ? currentUser.matric : "",
      );

      try {
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.textContent = "Checking... ⏳";
        }

        const codeQuery = query(
          collection(db, "courses"),
          where("code", "==", code),
        );
        const querySnap = await getDocs(codeQuery);

        if (querySnap.empty) {
          toast.warning(
            `Course code "${code}" was not found. Double-check and try again.`,
            "Not Found",
          );
          return;
        }

        const foundDoc = querySnap.docs[0];
        const found = { id: foundDoc.id, ...foundDoc.data() };

        if (!auth.currentUser || !studentMatric) {
          throw new Error("Your account is missing a valid matric number.");
        }

        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/course?action=enroll", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({ courseCode: code }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(
            `__JOIN_ERR__${result.error || "Unable to join course."}`,
          );

        // The onSnapshot listener watches the courses collection, NOT subcollections.
        // It won't fire when members/ changes. A student can only read their own
        // member doc (not the full collection), so we update local state directly
        // using the data we already have from the join — no extra Firestore read needed.
        const myMatric = normalizeMatric(currentUser ? currentUser.matric : "");
        const existingIdx = courses.findIndex((c) => c.id === result.courseId);
        if (existingIdx >= 0) {
          // Add student's own matric to enrolled[] in local state
          const alreadyIn = (courses[existingIdx].enrolled || [])
            .map(normalizeMatric)
            .includes(myMatric);
          if (!alreadyIn) {
            courses[existingIdx] = {
              ...courses[existingIdx],
              enrolled: [...(courses[existingIdx].enrolled || []), myMatric],
            };
          }
        } else {
          // Course wasn't in local array yet — fetch the full course doc and add it
          const courseDocSnap = await getDoc(
            doc(db, "courses", result.courseId),
          );
          if (courseDocSnap.exists()) {
            courses.push({
              id: courseDocSnap.id,
              ...courseDocSnap.data(),
              // Seed with at least the current student so the card shows
              enrolled: [...(courseDocSnap.data().enrolled || []), myMatric],
              assistants: courseDocSnap.data().assistants || [],
              members: [],
            });
          }
        }

        renderCourses();
        toast.success(`You are now enrolled in ${found.name}!`, "Joined! 🎉");
      } catch (error) {
        console.error("Join course error:", error);
        if (error.message && error.message.startsWith("__JOIN_ERR__")) {
          toast.error(
            error.message.slice("__JOIN_ERR__".length),
            "Cannot Join",
          );
        } else {
          toast.error(
            "Something went wrong while joining. Please check your connection.",
          );
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Join Class 🏃‍♂️";
        }
        if (joinModal) joinModal.classList.remove("show");
        joinCourseForm.reset();
      }
    });
  }

  // --- BULK STUDENT IMPORT LOGIC ---
  const importCsvBtn = document.getElementById("importCsvBtn");
  const csvFileInput = document.getElementById("csvFileInput");
  const importProgress = document.getElementById("importProgress");
  const importStatus = document.getElementById("importStatus");
  const importResults = document.getElementById("importResults");

  if (importCsvBtn && csvFileInput) {
    importCsvBtn.addEventListener("click", async () => {
      if (!activeCourse || !auth.currentUser) {
        toast.error("No active course selected.");
        return;
      }

      const file = csvFileInput.files[0];
      if (!file) {
        toast.warning("Please select a CSV file first.");
        return;
      }

      if (!file.name.endsWith('.csv')) {
        toast.error("Please upload a CSV file.");
        return;
      }

      try {
        if (importProgress) importProgress.classList.remove("hidden");
        if (importStatus) importStatus.textContent = "Reading CSV file...";
        if (importResults) importResults.textContent = "";

        const csvText = await file.text();
        const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);

        // Parse CSV - handle both header and no-header formats
        let matrics = [];
        const hasHeader = lines[0].toLowerCase().includes('matric') || lines[0].toLowerCase().includes('number');

        const startIndex = hasHeader ? 1 : 0;
        for (let i = startIndex; i < lines.length; i++) {
          const line = lines[i];
          // Handle comma-separated or just one matric per line
          const parts = line.split(',').map(part => part.trim()).filter(part => part);
          if (parts.length > 0) {
            // Take the first non-empty part as the matric
            matrics.push(normalizeMatric(parts[0]));
          }
        }

        if (matrics.length === 0) {
          throw new Error("No valid matric numbers found in CSV.");
        }

        if (importStatus) importStatus.textContent = `Found ${matrics.length} matric numbers. Processing...`;

        // Filter out already enrolled students
        const currentEnrolled = (activeCourse.enrolled || []).map(normalizeMatric);
        const newMatrics = matrics.filter(m => !currentEnrolled.includes(m));

        if (newMatrics.length === 0) {
          if (importStatus) importStatus.textContent = "All students already enrolled.";
          if (importResults) importResults.textContent = `${matrics.length} total, 0 new.`;
          toast.info("All students from CSV are already enrolled.");
          return;
        }

        // Process in batches to avoid overwhelming Firestore
        const batchSize = 10;
        let successCount = 0;
        let failCount = 0;
        const failedMatrics = [];

        for (let i = 0; i < newMatrics.length; i += batchSize) {
          const batch = newMatrics.slice(i, i + batchSize);
          const batchPromises = batch.map(async (matric) => {
            try {
              // Generate a temporary UID for the student (they'll bind their real account on first login)
              const tempUid = `temp_${matric.replace(/[^a-zA-Z0-9]/g, '')}_${Date.now()}`;

              await setDoc(
                doc(db, "courses", activeCourse.id, "members", tempUid),
                {
                  uid: tempUid,
                  matric: matric,
                  name: matric, // Placeholder name until they register
                  role: "student",
                  joinedAt: Date.now(),
                  pendingRegistration: true, // Flag to indicate they need to register
                }
              );
              return { success: true, matric };
            } catch (error) {
              console.error(`Failed to add ${matric}:`, error);
              return { success: false, matric, error: error.message };
            }
          });

          const batchResults = await Promise.all(batchPromises);
          batchResults.forEach(result => {
            if (result.success) {
              successCount++;
            } else {
              failCount++;
              failedMatrics.push(result.matric);
            }
          });

          // Update progress
          const processed = Math.min(i + batchSize, newMatrics.length);
          if (importStatus) importStatus.textContent = `Processed ${processed}/${newMatrics.length} students...`;
        }

        // Update course document with new enrolled list
        activeCourse.enrolled = [...currentEnrolled, ...newMatrics.filter(m => {
          return failedMatrics.indexOf(m) === -1;
        })];
        await updateCourseInFirestore();

        // Show results
        if (importStatus) importStatus.textContent = "Import completed!";
        if (importResults) {
          importResults.innerHTML = `
            <div>✅ Successfully enrolled: ${successCount}</div>
            <div>❌ Failed: ${failCount}</div>
            ${failedMatrics.length > 0 ? `<div style="margin-top: 4px; color: var(--danger);">Failed: ${failedMatrics.slice(0, 5).join(', ')}${failedMatrics.length > 5 ? '...' : ''}</div>` : ''}
          `;
        }

        toast.success(`Successfully imported ${successCount} students. ${failCount > 0 ? `${failCount} failed.` : ''}`, "Import Complete 📥");

        // Refresh the UI
        renderPortalState();
        renderAssistantDropdownAndList();

      } catch (error) {
        console.error("CSV Import Error:", error);
        if (importStatus) importStatus.textContent = "Import failed.";
        if (importResults) importResults.textContent = error.message;
        toast.error(error.message || "Failed to import CSV file.");
      } finally {
        // Hide progress after a delay
        setTimeout(() => {
          if (importProgress) importProgress.classList.add("hidden");
        }, 5000);
      }
    });
  }

  // --- HOLIDAY/EXEMPTION MANAGEMENT LOGIC ---
  const addExemptionBtn = document.getElementById("addExemptionBtn");
  const exemptStudentSelect = document.getElementById("exemptStudentSelect");
  const exemptDate = document.getElementById("exemptDate");
  const exemptReason = document.getElementById("exemptReason");
  const exemptDetails = document.getElementById("exemptDetails");
  const exemptionsList = document.getElementById("exemptionsList");

  // Populate student dropdown when portal opens
  function populateExemptStudentDropdown() {
    if (!exemptStudentSelect || !activeCourse) return;

    exemptStudentSelect.innerHTML = '<option value="">-- Choose student --</option>';

    const enrolledMatrics = (activeCourse.enrolled || []).map(normalizeMatric);
    enrolledMatrics.forEach(matric => {
      const option = document.createElement("option");
      option.value = matric;
      option.textContent = matric;
      exemptStudentSelect.appendChild(option);
    });
  }

  if (addExemptionBtn) {
    addExemptionBtn.addEventListener("click", async () => {
      if (!activeCourse || !auth.currentUser) {
        toast.error("No active course selected.");
        return;
      }

      const studentMatric = exemptStudentSelect ? exemptStudentSelect.value : "";
      const date = exemptDate ? exemptDate.value : "";
      const reason = exemptReason ? exemptReason.value : "";
      const details = exemptDetails ? exemptDetails.value.trim() : "";

      if (!studentMatric) {
        toast.warning("Please select a student.");
        return;
      }
      if (!date) {
        toast.warning("Please select the date of absence.");
        return;
      }

      try {
        const exemptionId = `exempt_${studentMatric.replace(/[^a-zA-Z0-9]/g, '')}_${date.replace(/-/g, '')}`;

        // PUBLIC-FACING doc: matric + date only. The reason/details are
        // written to the staff-only exemptionReasons subcollection so no
        // classmate can ever read them from the public board.
        await setDoc(
          doc(db, "courses", activeCourse.id, "exemptions", exemptionId),
          {
            matric: studentMatric,
            date: date,
            approvedBy: auth.currentUser.uid,
            approvedByName: currentUser.name || "Rep",
            approvedAt: serverTimestamp(),
          }
        );
        await setDoc(
          doc(db, "courses", activeCourse.id, "exemptionReasons", exemptionId),
          {
            matric: studentMatric,
            date: date,
            reason: reason,
            details: details,
            approvedBy: auth.currentUser.uid,
          }
        );

        toast.success(`Exemption added for ${studentMatric} on ${date}.`, "Exemption Added 🛡️");

        // Clear form
        if (exemptStudentSelect) exemptStudentSelect.value = "";
        if (exemptDate) exemptDate.value = "";
        if (exemptReason) exemptReason.value = "medical";
        if (exemptDetails) exemptDetails.value = "";

        // Refresh exemptions list
        loadExemptions();

      } catch (error) {
        console.error("Add exemption error:", error);
        toast.error(error.message || "Failed to add exemption.");
      }
    });
  }

  async function loadExemptions() {
    if (!activeCourse || !exemptionsList) return;

    try {
      const exemptionsSnap = await getDocs(collection(db, "courses", activeCourse.id, "exemptions"));
      const exemptions = exemptionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // Join the staff-only reasons so the rep still sees the full picture.
      let reasonsById = new Map();
      try {
        const reasonsSnap = await getDocs(collection(db, "courses", activeCourse.id, "exemptionReasons"));
        reasonsById = new Map(reasonsSnap.docs.map((d) => [d.id, d.data()]));
      } catch (_) { /* reasons stay empty — list still shows */ }

      if (exemptions.length === 0) {
        exemptionsList.innerHTML = '<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 10px;">No exemptions recorded yet.</p>';
        return;
      }

      exemptionsList.innerHTML = "";
      exemptions.forEach(exemption => {
        const card = document.createElement("div");
        card.style.cssText = "background: var(--card-bg); padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--border);";
        const r = reasonsById.get(exemption.id) || {};

        const reasonLabels = {
          medical: "Medical Emergency",
          university_event: "University Event",
          family_emergency: "Family Emergency",
          religious: "Religious Observance",
          other: "Other"
        };

        card.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
            <strong style="color: var(--navy);">🎓 ${exemption.matric}</strong>
            <span style="font-size: 0.75rem; color: var(--muted);">${exemption.date}</span>
          </div>
          <div style="font-size: 0.8rem; color: var(--muted);">🛡️ ${reasonLabels[r.reason] || r.reason || "Excused"}</div>
          ${r.details ? `<div style="font-size: 0.75rem; color: var(--muted); margin-top: 4px;">"${r.details}"</div>` : ''}
          <button data-exemption-id="${exemption.id}" class="remove-exemption-btn" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.75rem; padding: 4px 6px; margin-top: 6px;">Remove ❌</button>
        `;

        exemptionsList.appendChild(card);
      });

      // Add remove handlers
      exemptionsList.querySelectorAll(".remove-exemption-btn").forEach(btn => {
        btn.addEventListener("click", async () => {
          const exemptionId = btn.getAttribute("data-exemption-id");
          if (await showConfirm({
            title: "Remove Exemption",
            message: "Remove this exemption? The student's absence will count against their attendance.",
            okText: "Remove",
            cancelText: "Cancel",
            icon: "trash-2",
            danger: true
          })) {
            try {
              await deleteDoc(doc(db, "courses", activeCourse.id, "exemptions", exemptionId));
              try {
                await deleteDoc(doc(db, "courses", activeCourse.id, "exemptionReasons", exemptionId));
              } catch (_) { /* reason already gone — fine */ }
              toast.success("Exemption removed.", "Removed 🗑️");
              loadExemptions();
            } catch (error) {
              console.error("Remove exemption error:", error);
              toast.error("Failed to remove exemption.");
            }
          }
        });
      });

    } catch (error) {
      console.error("Load exemptions error:", error);
      exemptionsList.innerHTML = '<p style="font-size: 0.85rem; color: var(--danger); text-align: center; padding: 10px;">Failed to load exemptions.</p>';
    }
  }

  // --- ASSISTANT REPS MANAGEMENT LOGIC ---
  // --- 👥 HOTSPOT MODE — trusted, physically-present students broadcast the
  // rotating QR from their own phones. Reuse the existing session_assistant
  // machinery: role auto-revokes at session close, secret listener keeps
  // every hotspot's QR in perfect sync with the rep's rotation clock.
  const HOTSPOTS_MAX = 5;

  function openHotspotPicker() {
    const modal = document.getElementById("hotspotPickerModal");
    if (!modal || !activeCourse) return;
    if (!currentUser || activeCourse.repUid !== currentUser.uid) {
      toast.warning(
        "Only the Course Rep can appoint Hotspot students.",
        "Rep Only",
      );
      return;
    }
    renderHotspotOptions();
    modal.classList.add("show");
  }

  function renderHotspotOptions() {
    const list = document.getElementById("hotspotOptionsList");
    if (!list || !activeCourse) return;

    // 🎯 PROOF-OF-PRESENCE picker: candidates must be regular students who
    // have ALREADY checked in to the live session. You cannot scan the rep's
    // screen from home, so an absent friend can never be appointed — the
    // rotating code can only reach devices of people who were verified in
    // the hall.
    const session = activeCourse.activeSession;
    const isSessionLive =
      session &&
      !session.expired &&
      getAccurateNow() < session.expiresAt &&
      activeCourse.activeSession.pin;
    const attendees = ((session && session.attendees) || [])
      .map(normalizeMatric)
      .filter(Boolean);

    if (!isSessionLive) {
      list.innerHTML =
        '<p style="font-size: 0.8rem; color: var(--muted); text-align: center;">No live session. Start the class first — hotspots can only be picked from students who have already checked in (proof-of-presence).</p>';
      return;
    }

    const currentAssistants = (activeCourse.assistants || [])
      .map(normalizeMatric);
    const eligible = (activeCourse.members || []).filter((m) => {
      if (m.role !== "student") return false;
      const matric = normalizeMatric(m.matric);
      return (
        matric &&
        !currentAssistants.includes(matric) &&
        attendees.includes(matric)
      );
    });

    if (eligible.length === 0) {
      list.innerHTML =
        '<p style="font-size: 0.8rem; color: var(--muted); text-align: center;">No eligible hotspots yet — a student must scan the code (or type the PIN) first. Everyone checked in appears here instantly.</p>';
      return;
    }

    list.innerHTML = "";
    eligible.forEach((member) => {
      const matric = normalizeMatric(member.matric);
      const label = document.createElement("label");
      label.style.cssText =
        "display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; font-size: 0.82rem; color: var(--text); cursor: pointer;";
      label.innerHTML = `<input type="checkbox" value="${escapeHTML(matric)}" data-hotspot-check style="accent-color: var(--teal); width: 16px; height: 16px;"><span><strong>${escapeHTML(matric)}</strong>${member.name ? ` · ${escapeHTML(member.name)}` : ""} <span style="color: #28a745; font-size: 0.7rem;">✅ checked in</span></span>`;
      list.appendChild(label);
    });
  }

  // 🔄 LIVE REFRESH — keep the (rep-only) picker current while it's open:
  // a student who checks in mid-selection appears instantly. Checkbox
  // selections are preserved across the rebuild so the rep never loses a tick.
  function renderHotspotPickerIfOpen() {
    const modal = document.getElementById("hotspotPickerModal");
    const list = document.getElementById("hotspotOptionsList");
    if (!modal || !list || !modal.classList.contains("show")) return;
    if (!activeCourse || !auth.currentUser) return;
    if (activeCourse.repUid !== auth.currentUser.uid) return;
    const kept = Array.from(
      list.querySelectorAll("input[data-hotspot-check]:checked"),
    ).map((el) => normalizeMatric(el.value));
    renderHotspotOptions();
    if (kept.length > 0) {
      list.querySelectorAll("input[data-hotspot-check]").forEach((el) => {
        if (kept.includes(normalizeMatric(el.value))) el.checked = true;
      });
    }
  }

  async function granthotspots() {
    const modal = document.getElementById("hotspotPickerModal");
    const list = document.getElementById("hotspotOptionsList");
    if (!modal || !list || !activeCourse || !auth.currentUser) return;
    if (activeCourse.repUid !== auth.currentUser.uid) {
      toast.warning("Only the Course Rep can grant Hotspot power.", "Rep Only");
      return;
    }

    const checked = Array.from(
      list.querySelectorAll("input[data-hotspot-check]:checked"),
    ).map((el) => normalizeMatric(el.value));
    if (checked.length === 0) {
      toast.warning("Tick at least one checked-in student first.");
      return;
    }
    // Fast client-side feedback; the server enforces the same cap strictly.
    const currentHotspotCount = (activeCourse.members || []).filter(
      (m) => m.role === "session_assistant",
    ).length;
    if (currentHotspotCount + checked.length > HOTSPOTS_MAX) {
      toast.error(
        `Hotspot cap is ${HOTSPOTS_MAX} per class — a QR shown on too many screens multiplies leak risk.`,
        "Too Many Hotspots",
      );
      return;
    }

    const grantBtn = document.getElementById("granthotspotsBtn");
    if (grantBtn) {
      grantBtn.disabled = true;
      grantBtn.textContent = "⏳ Granting…";
    }
    let granted = 0;
    const failures = [];
    try {
      const idToken = await auth.currentUser.getIdToken();
      for (const matric of checked) {
        try {
          const response = await fetchWithTimeout(
            "/api/approval?action=grantHotspot",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${idToken}`,
              },
              body: JSON.stringify({
                courseId: activeCourse.id,
                targetMatric: matric,
              }),
            },
            20000,
          );
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || "Grant failed.");
          granted++;
        } catch (err) {
          console.error("Grant hotspot error:", err);
          failures.push(err.message || "Unknown error");
        }
      }
    } finally {
      if (grantBtn) {
        grantBtn.disabled = false;
        grantBtn.innerHTML =
          '<i data-lucide="broadcast"></i> Grant Hotspot Power';
        refreshIcons();
      }
    }

    if (granted > 0) {
      toast.success(
        `${granted} hotspot${granted > 1 ? "s" : ""} on air — the whole class can see who they are, and the grant is permanently logged.`,
        "Hotspots On Air 📡",
      );
      renderHotspotOptions();
      renderHotspotStrip();
    }
    if (failures.length > 0) {
      toast.error(
        failures[0],
        failures.length > 1
          ? `${failures.length} grants failed`
          : "Grant failed",
      );
    }
    modal.classList.remove("show");
  }

  // 📡 PUBLIC HOTSPOT STRIP + GRANT LOG — transparency for the whole class.
  // Everyone enrolled sees who holds the rotating QR right now, granted by
  // whom and when. The log is backend-written (grantHotspot API) and
  // immutable from any client.
  let unsubscribeHotspotLog = null;
  let hotspotLogCourseId = null;
  let hotspotLogCache = [];

  function ensureHotspotLogListener() {
    if (!activeCourse || !activeCourse.id || !auth.currentUser) return;
    if (unsubscribeHotspotLog && hotspotLogCourseId === activeCourse.id)
      return;
    if (unsubscribeHotspotLog) {
      unsubscribeHotspotLog();
      unsubscribeHotspotLog = null;
    }
    hotspotLogCourseId = activeCourse.id;
    unsubscribeHotspotLog = onSnapshot(
      query(
        collection(db, "courses", activeCourse.id, "hotspotLog"),
        orderBy("grantedAt", "desc"),
        limit(30),
      ),
      (snap) => {
        hotspotLogCache = snap.docs.map((d) => ({
          id: d.id,
          ...d.data(),
        }));
        renderHotspotStrip();
      },
      (err) => console.error("Hotspot log listener error:", err),
    );
  }

  function stopHotspotLogListener() {
    if (unsubscribeHotspotLog) {
      unsubscribeHotspotLog();
      unsubscribeHotspotLog = null;
      hotspotLogCourseId = null;
      hotspotLogCache = [];
    }
  }

  function renderHotspotStrip() {
    const strip = document.getElementById("hotspotStrip");
    if (!strip || !activeCourse) return;
    const hotspots = (activeCourse.members || []).filter(
      (m) => m.role === "session_assistant",
    );
    if (hotspots.length === 0) {
      strip.classList.add("hidden");
      strip.innerHTML = "";
      return;
    }
    strip.classList.remove("hidden");
    const sessionExpiresAt = activeCourse.activeSession
      ? activeCourse.activeSession.expiresAt
      : null;
    const chips = hotspots
      .map((m) => {
        const matric = normalizeMatric(m.matric);
        const log = hotspotLogCache.find(
          (l) =>
            normalizeMatric(l.matric) === matric &&
            (!sessionExpiresAt || l.sessionExpiresAt === sessionExpiresAt),
        );
        const when =
          log && log.grantedAt && log.grantedAt.toDate
            ? log.grantedAt
                .toDate()
                .toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })
            : "";
        const by = log && log.grantedByMatric ? log.grantedByMatric : "rep";
        return `<span style="display:inline-block; background: var(--bg); border:1px solid var(--border); border-radius:999px; padding:3px 10px; margin:2px 4px 2px 0;">📡 <strong>${escapeHTML(m.name || matric)}</strong> (${escapeHTML(matric)}) — granted by <strong>${escapeHTML(by)}</strong>${when ? ` at ${escapeHTML(when)}` : ""}</span>`;
      })
      .join(" ");
    strip.innerHTML = `<strong>📡 Hotspots this class:</strong> ${chips}<div style="font-size:0.72rem; color:var(--muted); margin-top:4px;">Hotspots can only be picked from students who already checked in (proof-of-presence). Grants are public and end when class closes.</div>`;
  }

  const granthotspotsBtn = document.getElementById("granthotspotsBtn");
  if (granthotspotsBtn)
    granthotspotsBtn.addEventListener("click", () => granthotspots());
  const closeHotspotPickerBtn = document.getElementById(
    "closeHotspotPickerBtn",
  );
  if (closeHotspotPickerBtn)
    closeHotspotPickerBtn.addEventListener("click", () => {
      const modal = document.getElementById("hotspotPickerModal");
      if (modal) modal.classList.remove("show");
    });

  const hotspotsBtn = document.getElementById("hotspotsBtn");
  if (hotspotsBtn)
    hotspotsBtn.addEventListener("click", () => openHotspotPicker());
  const appointAssistantBtn = document.getElementById("appointAssistantBtn");
  if (appointAssistantBtn) {
    appointAssistantBtn.addEventListener("click", async () => {
      if (!activeCourse) return;

      const selectEl = document.getElementById("courseStudentSelect");
      const selectedMatric = normalizeMatric(selectEl ? selectEl.value : "");
      // Read the scope radio buttons (permanent vs session)
      const scopeEl = document.querySelector(
        'input[name="assistantScope"]:checked',
      );
      const isSessionScoped = scopeEl && scopeEl.value === "session";

      if (!selectedMatric) {
        toast.warning("Please select an enrolled student to appoint.");
        return;
      }

      if (!activeCourse.assistants) activeCourse.assistants = [];

      const currentAssistants = activeCourse.assistants.map(normalizeMatric);
      if (currentAssistants.includes(selectedMatric)) {
        toast.warning("This student is already an appointed assistant.");
        return;
      }

      // Update the member's role in Firestore via updateDoc
      // We store role as "assistant" (permanent) or "session_assistant" (auto-revoked on close)
      const newRole = isSessionScoped ? "session_assistant" : "assistant";

      // Find the member doc for this matric
      const memberRecord = (activeCourse.members || []).find(
        (m) => normalizeMatric(m.matric) === selectedMatric,
      );

      if (memberRecord) {
        try {
          await updateDoc(
            doc(db, "courses", activeCourse.id, "members", memberRecord.uid),
            { role: newRole },
          );
        } catch (err) {
          console.error("Could not update member role:", err);
          toast.error("Failed to assign assistant. Please try again.");
          return;
        }
      }

      activeCourse.assistants.push(selectedMatric);
      await updateCourseInFirestore();

      renderPortalState();
      renderAssistantDropdownAndList();

      const scopeLabel = isSessionScoped
        ? "Session Rep — auto-revoked after class"
        : "Permanent Assistant Rep";
      toast.success(
        `${scopeLabel} assigned to [${selectedMatric}].`,
        "Assistant Assigned 👑",
      );
    });
  }

  window.revokeAssistant = async function (matric) {
    if (!activeCourse || !activeCourse.assistants) return;

    if (
      await showConfirm({
        title: "Remove Assistant",
        message: "Remove this student's assistant badge?",
        okText: "Remove",
        cancelText: "Cancel",
        icon: "👑",
        danger: true,
      })
    ) {
      const targetMatric = normalizeMatric(matric);
      activeCourse.assistants = (activeCourse.assistants || [])
        .map(normalizeMatric)
        .filter((m) => m !== targetMatric);
      await updateCourseInFirestore();

      renderPortalState();
      renderAssistantDropdownAndList();

      toast.info("Assistant badge removed.");
    }
  };

  window.removeStudentFromCourse = async function (matric) {
    if (!activeCourse) return;

    if (
      await showConfirm({
        title: "Remove Student",
        message: `Remove [${matric}] from ${activeCourse.name}? They can rejoin using the course code.`,
        okText: "Remove",
        cancelText: "Cancel",
        icon: "🚪",
        danger: true,
      })
    ) {
      try {
        const idToken = await auth.currentUser.getIdToken();
        const response = await fetch("/api/course?action=remove", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            courseId: activeCourse.id,
            targetMatric: matric,
          }),
        });
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error || "Unable to remove student.");

        // Update local state to reflect the removal immediately
        const targetMatric = normalizeMatric(matric);
        if (activeCourse.enrolled) {
          activeCourse.enrolled = activeCourse.enrolled
            .map(normalizeMatric)
            .filter((m) => m !== targetMatric);
        }
        if (activeCourse.assistants) {
          activeCourse.assistants = activeCourse.assistants
            .map(normalizeMatric)
            .filter((m) => m !== targetMatric);
        }

        renderPortalState();
        renderAssistantDropdownAndList();
        toast.info(
          `Student [${targetMatric}] has been removed.`,
          "Student Removed",
        );
      } catch (error) {
        console.error("Remove student error:", error);
        toast.error("Unable to remove student. Please try again.");
      }
    }
  };

  function renderAssistantDropdownAndList() {
    if (!activeCourse) return;

    const selectEl = document.getElementById("courseStudentSelect");
    const listEl = document.getElementById("assistantsList");
    if (!selectEl || !listEl) return;

    // Event delegation for revoke buttons (XSS-safe: matric from data attribute)
    listEl.addEventListener("click", (e) => {
      const revokeBtn = e.target.closest(".revoke-assistant-btn");
      if (revokeBtn) {
        e.preventDefault();
        revokeAssistant(revokeBtn.dataset.matric);
      }
    });

    selectEl.innerHTML = `<option value="">-- Choose student to appoint --</option>`;
    const assistants = (activeCourse.assistants || []).map(normalizeMatric);

    // Only show students (not the rep, not already-assistants) in the dropdown
    (activeCourse.members || []).forEach((member) => {
      if (member.role !== "student") return; // skip rep, existing assistants
      const matric = normalizeMatric(member.matric);
      if (assistants.includes(matric)) return;
      const opt = document.createElement("option");
      opt.value = matric;
      opt.textContent = `${matric}`;
      selectEl.appendChild(opt);
    });

    if (assistants.length === 0) {
      listEl.innerHTML = `<li style="color: var(--muted); font-size: 0.85rem; padding: 5px;">No assistants appointed yet. ⏳</li>`;
    } else {
      listEl.innerHTML = "";
      assistants.forEach((matric) => {
        // Find member record to determine scope
        const memberRecord = (activeCourse.members || []).find(
          (m) => normalizeMatric(m.matric) === matric,
        );
        const isSession =
          memberRecord && memberRecord.role === "session_assistant";
        const scopeBadge = isSession
          ? `<span style="background: #fd7e14; color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.6rem; margin-left: 4px;">SESSION</span>`
          : `<span style="background: var(--teal); color: white; padding: 2px 4px; border-radius: 3px; font-size: 0.6rem; margin-left: 4px;">PERMANENT</span>`;

        const li = document.createElement("li");
        li.style.cssText =
          "display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--card-bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;";
        li.innerHTML = `<span>👑 ${escapeHTML(matric)} ${scopeBadge}</span> <button data-matric="${escapeHTML(matric)}" class="revoke-assistant-btn" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem;">Remove ❌</button>`;
        listEl.appendChild(li);
      });
    }
  }

  // --- LECTURE HALL MANAGEMENT LOGIC ---
  function renderLectureHallOptions() {
    const selectEl = document.getElementById("repHallSelect");
    const badgeEl = document.getElementById("hallInfoBadge");
    if (!selectEl || !activeCourse) return;

    const halls = activeCourse.savedHalls || [];
    const storedPreference = localStorage.getItem(
      `veripresenx_last_hall_${activeCourse.id}`,
    );
    // Legacy values ("no_gps"/"live_gps") used to live in this dropdown —
    // they are attendance-mode choices now, so ignore them here.
    const validStored =
      storedPreference && storedPreference.startsWith("hall_")
        ? storedPreference
        : null;
    const defaultVal =
      validStored || (halls.length > 0 ? `hall_${halls[0].id}` : "add_new");

    selectEl.innerHTML = "";

    // Pure location choices only — verification modes live in the
    // Attendance Mode section below.
    if (halls.length > 0) {
      const hallGroup = document.createElement("optgroup");
      hallGroup.label = "🏛️ Saved Lecture Halls";
      halls.forEach((hall) => {
        const opt = document.createElement("option");
        opt.value = `hall_${hall.id}`;
        const displayRadius =
          hall.name === "Current Location" ? 200 : hall.radius || 80;
        opt.textContent = `🏛️ ${hall.name} (${displayRadius}m radius)`;
        if (opt.value === defaultVal || String(hall.id) === defaultVal) {
          opt.selected = true;
        }
        hallGroup.appendChild(opt);
      });
      selectEl.appendChild(hallGroup);
    }

    const addOpt = document.createElement("option");
    addOpt.value = "add_new";
    addOpt.textContent = "➕ Add / Set New Lecture Hall...";
    if (halls.length === 0) addOpt.selected = true;
    selectEl.appendChild(addOpt);

    const updateBadge = () => {
      let val = selectEl.value;
      if (val === "add_new") {
        openManageHallsModal();
        val = halls.length > 0 ? validStored || `hall_${halls[0].id}` : "add_new";
        selectEl.value = val;
      }
      if (val.startsWith("hall_")) {
        localStorage.setItem(`veripresenx_last_hall_${activeCourse.id}`, val);
      }
      if (!badgeEl) return;
      const hId = String(val).replace("hall_", "");
      const h = halls.find((item) => String(item.id) === String(hId));
      if (h) {
        const displayRadius =
          h.name === "Current Location" ? 200 : h.radius || 80;
        badgeEl.className = "hall-info-chip badge-hall";
        badgeEl.innerHTML = `<span>🏛️ <strong>Hall Active:</strong> ${h.name} (${displayRadius}m indoor boundary).</span>`;
      } else {
        badgeEl.className = "hall-info-chip";
        badgeEl.innerHTML = `<span>ℹ️ No hall selected — GPS modes will ask for one at generate time.</span>`;
      }
    };

    selectEl.onchange = updateBadge;
    updateBadge();
    renderModeCards();
    syncModeUI();
  }

  // ============================================================
  // ATTENDANCE MODE SELECTOR — setup-time choice of HOW students verify
  // ============================================================
  // 🛑 GPS PROTOTYPE TOGGLE — browser geolocation is unreliable/permissive on
  // desktop web; geofencing reaches its full potential in the native app.
  // Until then, GPS modes are hidden. Flip to true to re-enable.
  const GPS_PROTOTYPE_ENABLED = false;

  const ATTENDANCE_MODES = {
    qr_mode: {
      icon: "📺",
      title: "QR + Device Lock",
      desc: "Students scan the rotating QR on a screen (or type the PIN). No GPS.",
    },
    pin_only: {
      icon: "⚡",
      title: "PIN + Device Lock",
      desc: "Emergency: rotating PIN only, no GPS at all.",
    },
    live_gps: {
      icon: "📍",
      title: "Live GPS (Rep Anchor)",
      desc: "Your live position becomes the fence when you generate.",
      prototype: true,
    },
    full_combo: {
      icon: "🎯",
      title: "PIN + Device + Hall GPS",
      desc: "Maximum security: PIN + saved-hall geofence + device lock.",
      prototype: true,
    },
  };

  // Shown on every disabled GPS card so the reason is never a mystery.
  const GPS_DISABLED_REASON =
    "🔒 Disabled for the web app — GPS in a browser is too imprecise indoors " +
    "to tell one hall from the next, so it would reject students who are present. " +
    "This works properly in the mobile app.";

  // 📺 QR DISPLAY CHOICE — projector vs hotspot students. Visible only when
  // the QR + Device Lock mode is selected; choice persists per course.
  function getQrDisplayChoice() {
    if (!activeCourse) return "projector";
    return (
      localStorage.getItem(`veripresenx_qrdisplay_${activeCourse.id}`) ||
      "projector"
    );
  }

  function syncQrDisplayChoiceUI() {
    const row = document.getElementById("qrDisplayChoiceRow");
    if (!row || !activeCourse) return;
    const mode = getSelectedAttendanceMode();
    const isLive =
      activeCourse.activeSession &&
      !activeCourse.activeSession.expired &&
      getAccurateNow() < activeCourse.activeSession.expiresAt;
    row.classList.toggle("hidden", mode !== "qr_mode" || isLive);
    const choice = getQrDisplayChoice();
    row.querySelectorAll("button[data-qr-display]").forEach((btn) => {
      const active = btn.dataset.qrDisplay === choice;
      btn.style.borderColor = active ? "var(--teal)" : "var(--border)";
      btn.style.background = active ? "rgba(45, 224, 201, 0.12)" : "var(--bg)";
      btn.innerHTML = btn.innerHTML.replace(/ ✓$/, "");
      if (active) btn.innerHTML += " ✓";
    });
  }

  function initQrDisplayChoice() {
    const row = document.getElementById("qrDisplayChoiceRow");
    if (!row) return;
    row.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-qr-display]");
      if (!btn || !activeCourse) return;
      localStorage.setItem(
        `veripresenx_qrdisplay_${activeCourse.id}`,
        btn.dataset.qrDisplay,
      );
      syncQrDisplayChoiceUI();
    });
  }
  initQrDisplayChoice();
  initSemesterReport();

  function getSelectedAttendanceMode() {
    if (!activeCourse) return "pin_only";
    const halls = activeCourse.savedHalls || [];
    let mode =
      localStorage.getItem(`veripresenx_mode_${activeCourse.id}`) ||
      (halls.length > 0 ? "full_combo" : "pin_only");
    // Prototype gating: GPS modes are unavailable while the toggle is off —
    // silently fall back to the strongest non-GPS mode so a stale saved
    // selection can never route a session into the disabled path.
    if (
      !GPS_PROTOTYPE_ENABLED &&
      mode !== "qr_mode" &&
      mode !== "pin_only"
    ) {
      mode = "qr_mode";
    }
    return mode;
  }

  function renderModeCards() {
    const grid = document.getElementById("modeCardsGrid");
    if (!grid || !activeCourse) return;
    const current = getSelectedAttendanceMode();
    grid.innerHTML = "";
    Object.entries(ATTENDANCE_MODES).forEach(([mode, cfg]) => {
      // 🔒 GPS modes are SHOWN, not hidden. A rep should be able to see
      // they exist and why they are unavailable, rather than meeting a
      // feature that simply is not there.
      const locked = cfg.prototype && !GPS_PROTOTYPE_ENABLED;
      const btn = document.createElement("button");
      btn.type = "button";
      const active = mode === current;
      btn.setAttribute("data-mode", mode);
      btn.style.cssText = `text-align: left; padding: 10px; border-radius: 10px; cursor: ${locked ? "not-allowed" : "pointer"}; font-size: 0.72rem; border: 1.5px solid ${active ? "var(--teal)" : "var(--border)"}; background: ${active ? "rgba(45, 224, 201, 0.12)" : "var(--bg)"}; color: var(--text); opacity: ${locked ? "0.5" : "1"}; transition: border-color 0.15s ease, opacity 0.15s ease;`;
      btn.innerHTML =
        `<div style="font-weight: 700; margin-bottom: 3px;">${locked ? "🔒 " : ""}${cfg.icon} ${cfg.title}${active ? " ✓" : ""}</div>` +
        `<div style="color: var(--muted);">${cfg.desc}</div>` +
        (locked ? `<div style="color: var(--muted); margin-top: 5px; font-size: 0.68rem; font-style: italic;">Needs the mobile app</div>` : "");
      if (locked) btn.setAttribute("aria-disabled", "true");
      btn.addEventListener("click", () => {
        if (locked) {
          // Explain rather than silently ignore: a button that does nothing
          // looks broken, whereas one that says why is honest.
          toast.info(GPS_DISABLED_REASON, "Not available on web");
          return;
        }
        localStorage.setItem(`veripresenx_mode_${activeCourse.id}`, mode);
        renderModeCards();
        syncModeUI();
      });
      grid.appendChild(btn);
    });
  }

  function syncModeUI() {
    const mode = getSelectedAttendanceMode();
    const selectEl = document.getElementById("repHallSelect");
    const hint = document.getElementById("modeHint");
    const usesLocation = mode === "full_combo" || mode === "live_gps";
    syncQrDisplayChoiceUI();

    if (selectEl) {
      selectEl.disabled = !usesLocation;
      selectEl.style.opacity = usesLocation ? "1" : "0.5";
    }
    if (hint) {
      if (!usesLocation) {
        hint.innerHTML = `📍 <em>Location is not used in this mode — the hall dropdown is disabled. Switch to a GPS mode to use a saved hall.</em>`;
      } else if (mode === "live_gps") {
        hint.innerHTML = `📍 Your current position will be captured the moment you generate the PIN.`;
      } else {
        const halls = activeCourse ? activeCourse.savedHalls || [] : [];
        hint.innerHTML = halls.length
          ? `🏛️ Uses the selected hall's geofence — change it in the dropdown above.`
          : `⚠️ No hall saved yet — add one in the dropdown above (or via Manage Halls), or pick another mode.`;
      }
    }
  }

  function openManageHallsModal() {
    const modal = document.getElementById("manageHallsModal");
    if (!modal || !activeCourse) return;
    renderSavedHallsList();
    modal.classList.add("show");
  }

  function renderSavedHallsList() {
    const listEl = document.getElementById("savedHallsList");
    if (!listEl || !activeCourse) return;
    const halls = activeCourse.savedHalls || [];
    if (halls.length === 0) {
      listEl.innerHTML = `<li style="color: var(--muted); font-size: 0.85rem; padding: 6px;">No saved halls yet. Add one below! 🏛️</li>`;
      return;
    }
    listEl.innerHTML = "";
    halls.forEach((hall) => {
      const li = document.createElement("li");
      li.style.cssText =
        "display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; background: var(--bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem; border: 1px solid var(--border);";
      li.innerHTML = `
      <div>
        <strong style="color: var(--navy);">🏛️ ${hall.name}</strong>
        <div style="font-size: 0.75rem; color: var(--muted);">Coord: ${Number(hall.lat).toFixed(4)}, ${Number(hall.lon).toFixed(4)} • Radius: ${hall.radius || 80}m</div>
      </div>
      <button data-hall-id="${hall.id}" class="delete-hall-btn" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem; padding: 4px 6px;">Delete ❌</button>
    `;
      listEl.appendChild(li);
    });

    listEl.querySelectorAll(".delete-hall-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const hId = btn.getAttribute("data-hall-id");
        if (
          await showConfirm({
            title: "Delete Lecture Hall",
            message:
              "Are you sure you want to remove this saved lecture hall location?",
            okText: "Delete",
            danger: true,
          })
        ) {
          activeCourse.savedHalls = (activeCourse.savedHalls || []).filter(
            (h) => String(h.id) !== String(hId),
          );
          await updateCourseInFirestore();
          renderSavedHallsList();
          renderLectureHallOptions();
          toast.success("Hall location removed.", "Deleted 🗑️");
        }
      });
    });
  }

  const manageHallsBtn = document.getElementById("manageHallsBtn");
  if (manageHallsBtn) {
    manageHallsBtn.addEventListener("click", () => {
      openManageHallsModal();
    });
  }

  const setLocationBtn = document.getElementById("setLocationBtn");
  const setLocationStatus = document.getElementById("setLocationStatus");
  if (setLocationBtn) {
    setLocationBtn.addEventListener("click", async () => {
      if (!activeCourse) return;

      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by your browser.");
        return;
      }

      setLocationBtn.disabled = true;
      setLocationBtn.textContent = "Getting Location...";
      if (setLocationStatus) {
        setLocationStatus.style.display = "block";
        setLocationStatus.style.color = "var(--muted)";
        setLocationStatus.textContent = "Acquiring GPS position...";
      }

      try {
        const pos = await getBestGpsPosition(15000, (acc) => {
          if (setLocationStatus) {
            setLocationStatus.style.display = "block";
            setLocationStatus.style.color = "var(--muted)";
            setLocationStatus.textContent = `📡 Locking GPS… best fix ±${Math.round(acc)}m — hold still`;
          }
        }); // 15 seconds for accurate lock
        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const accuracy = pos.coords.accuracy;

        // Create a temporary hall entry for this session
        const tempHall = {
          id: "temp_" + Date.now(),
          name: "Current Location",
          lat: lat,
          lon: lon,
          radius: 200, // 200m radius for realistic indoor GPS
        };

        // Add to saved halls temporarily
        activeCourse.savedHalls = activeCourse.savedHalls || [];
        activeCourse.savedHalls.push(tempHall);

        // Select this hall automatically
        const hallSelect = document.getElementById("repHallSelect");
        if (hallSelect) {
          hallSelect.value = `hall_${tempHall.id}`;
          hallSelect.dispatchEvent(new Event("change"));
        }

        if (setLocationStatus) {
          setLocationStatus.style.display = "block";
          setLocationStatus.style.color = "#28a745";
          setLocationStatus.textContent = `✅ Location locked (±${Math.round(accuracy)}m accuracy). Ready to start session.`;
        }

        toast.success(
          `Location captured with ±${Math.round(accuracy)}m accuracy. 200m geofence active.`,
          "Location Set 🎯",
        );

        // Save the updated halls to Firestore
        await updateCourseInFirestore();
      } catch (err) {
        console.error("Could not capture location:", err);
        if (setLocationStatus) {
          setLocationStatus.style.display = "block";
          setLocationStatus.style.color = "var(--danger)";
          setLocationStatus.textContent =
            "❌ Could not get GPS. Move near window or try again.";
        }
        toast.error(
          "Could not capture location. Move near a window or use a saved hall.",
          "GPS Error",
        );
      } finally {
        setLocationBtn.disabled = false;
        setLocationBtn.textContent = "Set Current Location";
      }
    });
  }

  const captureHallGpsBtn = document.getElementById("captureHallGpsBtn");
  const captureStatus = document.getElementById("captureStatus");
  if (captureHallGpsBtn) {
    captureHallGpsBtn.addEventListener("click", () => {
      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by your browser.");
        return;
      }
      captureHallGpsBtn.disabled = true;
      captureHallGpsBtn.textContent = "Acquiring GPS... ⏳";
      if (captureStatus) {
        captureStatus.style.display = "block";
        captureStatus.style.color = "var(--muted)";
        captureStatus.textContent =
          "Acquiring satellite lock... Stand near entrance or window.";
      }

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          captureHallGpsBtn.disabled = false;
          captureHallGpsBtn.textContent = "📍 Re-Capture GPS";
          const latInput = document.getElementById("newHallLat");
          const lonInput = document.getElementById("newHallLon");
          if (latInput) latInput.value = pos.coords.latitude.toFixed(6);
          if (lonInput) lonInput.value = pos.coords.longitude.toFixed(6);
          if (captureStatus) {
            captureStatus.style.display = "block";
            captureStatus.style.color = "#28a745";
            captureStatus.textContent = `✅ GPS locked with ±${Math.round(pos.coords.accuracy)}m accuracy!`;
          }
          toast.success(
            `Coordinates captured (±${Math.round(pos.coords.accuracy)}m).`,
            "Location Locked 🎯",
          );
        },
        (err) => {
          captureHallGpsBtn.disabled = false;
          captureHallGpsBtn.textContent = "📍 Capture Current GPS";
          if (captureStatus) {
            captureStatus.style.display = "block";
            captureStatus.style.color = "var(--danger)";
            captureStatus.textContent =
              "❌ Could not get GPS. You can enter coordinates manually.";
          }
          toast.error(
            "Could not capture GPS. Ensure Location is allowed in browser settings.",
            "GPS Error",
          );
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
      );
    });
  }

  const addHallForm = document.getElementById("addHallForm");
  if (addHallForm) {
    addHallForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!activeCourse) return;

      const name = document.getElementById("newHallName").value.trim();
      const lat = parseFloat(document.getElementById("newHallLat").value);
      const lon = parseFloat(document.getElementById("newHallLon").value);
      const radius =
        parseInt(document.getElementById("newHallRadius").value, 10) || 80;

      if (!name || isNaN(lat) || isNaN(lon)) {
        toast.error("Please provide valid hall name and coordinates.");
        return;
      }

      const newHall = {
        id: "hall_" + Date.now(),
        name,
        lat,
        lon,
        radius,
      };

      activeCourse.savedHalls = activeCourse.savedHalls || [];
      activeCourse.savedHalls.push(newHall);

      try {
        await updateCourseInFirestore();
        addHallForm.reset();
        if (captureStatus) captureStatus.style.display = "none";
        renderSavedHallsList();
        renderLectureHallOptions();
        const manageModal = document.getElementById("manageHallsModal");
        if (manageModal) manageModal.classList.remove("show");
        toast.success(`"${name}" saved for this course.`, "Hall Added 🏛️");
      } catch (err) {
        console.error("Error saving hall:", err);
        toast.error("Could not save lecture hall. Please try again.");
      }
    });
  }

  // --- 60-SECOND ATTENDANCE ENGINE & TIMER LOGIC ---
  const generatePinBtn = document.getElementById("generatePinBtn");
  const activePinDisplay = document.getElementById("activePinDisplay");
  const pinCodeText = document.getElementById("pinCodeText");
  const sessionBanner = document.getElementById("sessionBanner");
  const checkInForm = document.getElementById("checkInForm");
  const rosterList = document.getElementById("rosterList");
  const rosterCount = document.getElementById("rosterCount");

  // 🎯 EVENT DELEGATION for dynamically-rendered roster buttons.
  // XSS-safe: matric comes from the data attribute (already escapeHTML'd at
  // render time), never from innerHTML parsing.
  if (rosterList) {
    rosterList.addEventListener("click", (e) => {
      const flagBtn = e.target.closest(".flag-absent-btn");
      if (flagBtn) {
        e.preventDefault();
        flagStudentAbsent(flagBtn.dataset.matric);
      }
    });
  }

  if (generatePinBtn) {
    generatePinBtn.addEventListener("click", async () => {
      if (!activeCourse) return;

      // 🔒 No PIN is generated here.
      //
      // This handler used to mint the first PIN with
      // `Math.floor(1000 + Math.random() * 9000)` and pass it down to
      // createSession(). Not a CSPRNG, no leading zeros, and — worse — it was
      // a value the SERVER then trusted, which is precisely the hole Phase 5
      // closed for rotation. An earlier revision asked rotatePin for the first
      // PIN, but that endpoint needs a live session and so 403s on the opening
      // click. `createSession` now calls `?action=startSession`, where the
      // server picks the PIN and stamps the clock for the whole opening move.
      const managerMatric = normalizeMatric(
        currentUser ? currentUser.matric : "REP-001",
      );
      const mode = getSelectedAttendanceMode();

      // 🔄 REGENERATE PIN safety: if there is already a live session, archive
      // it before creating a new one. Otherwise the current attendees are
      // silently dropped from the record.
      const existingSession = activeCourse.activeSession;
      if (existingSession && !existingSession.expired) {
        const proceed = await showConfirm({
          title: "Start a New Session?",
          message: `A live session is already running (PIN ${existingSession.pin}). Starting a new session will archive the current attendees and generate a fresh PIN. Continue?`,
          okText: "Start New Session",
          cancelText: "Cancel",
          icon: "🔄",
          danger: false,
        });
        if (!proceed) return;

        // Archive the current session into the attendance/ subcollection —
        // the SAME source of truth handleClose writes to. The previous write
        // went to the course doc's `attendanceHistory` field, which nothing
        // reads anymore (loadAttendanceHistory overwrites state from the
        // subcollection), so archived attendees were silently lost.
        try {
          const prevExpiresAt = existingSession.expiresAt || null;
          const attendeeGroups = {};
          (activeCourse.groups || []).forEach((g) => {
            (g.members || []).map(normalizeMatric).forEach((m) => {
              attendeeGroups[m] = g.name;
            });
          });
          const flaggedAbsent = (activeCourse.absentFlags || [])
            .filter(
              (f) =>
                f.status === "flagged" &&
                (!prevExpiresAt || f.sessionExpiresAt === prevExpiresAt),
            )
            .map((f) => normalizeMatric(f.matric));
          const historyEntry = {
            date:
              new Date().toLocaleDateString("en-GB") +
              " " +
              new Date().toLocaleTimeString("en-GB", {
                hour: "2-digit",
                minute: "2-digit",
              }),
            closedAt: serverTimestamp(),
            closedBy: currentUser.uid,
            attendees: [...(existingSession.attendees || [])],
            attendeeGroups,
            systemCount: existingSession.attendees.length,
            physicalHeadcount: null,
            flaggedAbsent,
            autoMarked: [],
            hotspots: [],
          };
          await setDoc(
            doc(collection(db, "courses", activeCourse.id, "attendance")),
            historyEntry,
          );
          // Re-read from the subcollection so local state matches what the
          // listener/renderer will show (it overwrites attendanceHistory).
          await loadAttendanceHistory();
        } catch (archiveErr) {
          console.warn("Could not archive session before regenerate:", archiveErr);
          toast.warning("Could not archive the old session — proceeding anyway.");
        }
      }

      // 📺 QR + Device Lock: students scan the rotating QR (or type the PIN).
      // No GPS fence. Where the code lives — projector or hotspot students —
      // is the rep's pre-set choice in the setup card.
      if (mode === "qr_mode") {
        await createSession(managerMatric, {
          mode: "no_gps",
          qrMode: true,
        });
        // 🎯 Proof-of-presence: nobody has checked in at creation time, so
        // the hotspot picker would be empty. Guide the rep to appoint after
        // the first check-ins land instead.
        if (getQrDisplayChoice() === "hotspots") {
          toast.info(
            "Once a few students check in, tap 👥 Hotspots to appoint who broadcasts the QR — only checked-in students are eligible.",
            "Proof-of-Presence Mode",
          );
        }
        return;
      }

      // ⚡ Emergency: PIN + Device Lock, no GPS at all.
      if (mode === "pin_only") {
        await createSession(managerMatric, { mode: "no_gps" });
        return;
      }

      // 📍 Live GPS: capture the rep's current position as the fence.
      if (mode === "live_gps") {
        toast.info("Acquiring GPS for live session...", "GPS Check");
        generatePinBtn.disabled = true;
        try {
          const pos = await getBestGpsPosition(12000, (acc) => {
            generatePinBtn.textContent = `📡 Locking GPS… ±${Math.round(acc)}m`;
          });
          const gpsAccuracy = Math.round(pos.coords.accuracy);

          // 🛡️ ANCHOR QUALITY GATE: indoor WiFi-positioning can report a
          // confident-but-wrong fix (±20m that is actually 300m off). A bad
          // anchor rejects every honest student — so gate it hard.
          if (gpsAccuracy > 120) {
            toast.error(
              `GPS too weak (±${gpsAccuracy}m) — the fence could be off by a building's width. Move near a window or outdoors and retry, or use PIN + Device Lock mode.`,
              "Weak GPS — Session Blocked",
            );
            return;
          }
          if (gpsAccuracy > 60) {
            const proceed = await showConfirm({
              title: "Weak GPS signal",
              message: `Accuracy is ±${gpsAccuracy}m — the fence may not match the hall exactly, and students inside could be rejected. Start Live GPS anyway? (PIN + Device Lock is the safer mode indoors.)`,
              okText: "Start Anyway",
              cancelText: "Cancel",
              danger: true,
            });
            if (!proceed) return;
          }

          await createSession(managerMatric, {
            mode: "live_gps",
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            radius: 150,
            accuracy: gpsAccuracy,
          });
        } catch (err) {
          console.warn("Could not capture Rep GPS:", err);
          toast.warning(
            "Could not lock your live GPS — falling back to PIN-only. Confirm on the next dialog.",
            "GPS Unavailable",
          );
          await createSession(managerMatric, { mode: "no_gps" });
        } finally {
          generatePinBtn.disabled = false;
          renderPortalState();
        }
        return;
      }

      // 🎯 Full combo: PIN + Device Lock + saved-hall geofence.
      const hallSelect = document.getElementById("repHallSelect");
      const selectedVal = hallSelect ? hallSelect.value : "";
      if (selectedVal && selectedVal.startsWith("hall_")) {
        const hallId = selectedVal.replace("hall_", "");
        const hall = (activeCourse.savedHalls || []).find(
          (h) => String(h.id) === String(hallId),
        );
        if (
          hall &&
          typeof hall.lat === "number" &&
          typeof hall.lon === "number"
        ) {
          await createSession(managerMatric, {
            mode: "preset_hall",
            name: hall.name,
            lat: hall.lat,
            lon: hall.lon,
            radius: hall.radius || 80,
          });
          return;
        }
        toast.error(
          "That saved hall has no usable coordinates. Add the hall again, or choose another mode.",
        );
        return;
      }

      toast.warning(
        "No lecture hall is selected. Add one in the dropdown above, or switch to a mode that doesn't need GPS.",
        "Hall Required",
      );
    });
  }

  // The PIN is no longer a parameter: the server chooses it in startSession.
  // Everything passed here is context the server cannot infer for itself.
  async function createSession(managerMatric, locData = {}) {
    if (!activeCourse || !activeCourse.id) return;

    const sessionMode = locData.mode || "no_gps";
    // The server normalises and re-validates this; it is a hint, not a control.
    const locationMode = sessionMode;

    if (sessionMode === "no_gps") {
      const proceed = await showConfirm({
        title: locData.qrMode
          ? "Start QR + Device Lock Session?"
          : "Start Session Without Location Check?",
        message: locData.qrMode
          ? "Students will scan the rotating QR on your screen (or type the PIN). No GPS fence — anyone with the PIN can check in from anywhere, so keep the code visible only inside the hall. Device lock stays active. Continue?"
          : "This session will NOT verify where students are physically located — anyone with the PIN can check in from anywhere, including off-campus. Only proceed if that's genuinely what you want for this class.",
        okText: locData.qrMode ? "Start QR Session" : "Start Anyway",
        cancelText: "Cancel",
        danger: true,
        icon: locData.qrMode ? "qr-code" : "map-pin-off",
      });
      if (!proceed) return;
    }

    // 🔒 SESSION CREATION IS SERVER-AUTHORITATIVE (Phase 5).
    //
    // This used to write `session/live` and `session/secret` from the rep's
    // browser, including a client-generated PIN and a client-stamped
    // `pinRotationTime`. That is the same forgeable clock the rotation fix
    // removed everywhere else, and the FIRST PIN is precisely the one a relay
    // attacker wants to capture — it is on screen for the first 10 seconds of
    // every class.
    //
    // The server now chooses the PIN with crypto.randomInt and stamps
    // serverTimestamp(). The client sends only what the server cannot know: the
    // hall, the mode, and the rep's own matric.
    //
    // If the call fails there is deliberately NO local fallback. A session whose
    // PIN the server never generated is exactly the hole this closes, so failing
    // loudly is correct: the rep sees an error instead of unknowingly running an
    // unrotatable class.
    let started;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch("/api/session?action=startSession", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          courseId: activeCourse.id,
          managerMatric,
          lat: typeof locData.lat === "number" ? locData.lat : null,
          lon: typeof locData.lon === "number" ? locData.lon : null,
          radius: typeof locData.radius === "number" ? locData.radius : 80,
          hallName: locData.name || null,
          durationSeconds: 300,
          locationMode: locationMode,
          qrMode: locData.qrMode === true,
        }),
      });
      started = await res.json();
      if (!res.ok) {
        throw new Error(started.error || "Could not start the session.");
      }
    } catch (error) {
      console.error("Failed to start session:", error);
      toast.error(error.message, "Session Not Started");
      toast.info(
        "The PIN is generated by the server, so the session cannot start offline. Check your connection and try again.",
      );
      renderPortalState();
      return;
    }

    // Mirror the server's response into local state for the countdown. Every
    // value here came from the server — nothing is computed on the client.
    activeCourse.activeSession = {
      pin: started.pin,
      previousPin: null,
      pinRotationTime: started.pinRotationTime,
      expiresAt: started.expiresAt,
      expired: false,
      attendees: [started.managerMatric],
      locationMode: started.locationMode,
      qrMode: locData.qrMode === true,
      lat: typeof locData.lat === "number" ? locData.lat : null,
      lon: typeof locData.lon === "number" ? locData.lon : null,
      radius: typeof locData.radius === "number" ? locData.radius : 80,
      hallName: locData.name || null,
      sessionDuration: started.sessionDuration,
      pinRotationInterval: started.pinRotationInterval,
    };

    // Keep this device's clock anchored to the server so the countdown is right
    // even on a phone with a wrong clock.
    if (typeof started.serverNow === "number") {
      serverClockSkewMs = started.serverNow - Date.now();
    }

    startSessionTimer();
    renderPortalState();
  }

  // 🔄 True between startSessionTimer() and the countdown ending. Lets
  // the session listener know a reloaded page needs the timer restarted.
  let isSessionTimerRunning = false;

  function startSessionTimer() {
    if (countdownInterval) clearInterval(countdownInterval);
    isSessionTimerRunning = true;

    if (!activeCourse || !activeCourse.activeSession) return;

    const tick = async () => {
      const session = activeCourse ? activeCourse.activeSession : null;
      if (!session) {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = null;
        return;
      }

      const deadline = session.expiresAt - serverClockSkewMs;
      const msRemaining = deadline - Date.now();
      const timeLeft = Math.max(0, Math.ceil(msRemaining / 1000));
      const liveTimerElement = document.getElementById("countdownTimer");

      // PIN Rotation Logic — ONLY the rep's device rotates the PIN.
      // Assistants receive the new code through the secret listener, so two
      // devices can never disagree about the active PIN.
      const canRotate =
        currentUser && activeCourse.repUid === currentUser.uid;
      const pinRotationInterval = (session.pinRotationInterval || 10) * 1000; // 10s rotation (anti-relay)
      const timeSinceRotation =
        Date.now() - (session.pinRotationTime || Date.now());
      const timeUntilRotation = Math.max(
        0,
        pinRotationInterval - timeSinceRotation,
      );
      const pinRotationElement = document.getElementById("pinRotationTimer");

      if (timeUntilRotation <= 0 && !session.expired && canRotate) {
        // 🔒 ROTATION IS SERVER-AUTHORITATIVE (Phase 5).
        //
        // This used to generate the PIN with Math.random() and write
        // `pinRotationTime: Date.now()` from the rep's browser. Two problems: a
        // rep with devtools could backdate the timestamp and freeze a PIN alive
        // indefinitely, and Math.random() is not a CSPRNG, so an attacker who
        // watched one rotation could predict the next ones.
        //
        // The server now generates the PIN with crypto.randomInt and stamps
        // serverTimestamp(), neither of which the client can influence. The
        // response hands back the resolved epoch ms — the client never has to
        // touch the Timestamp sentinel itself.
        try {
          const idToken = await auth.currentUser.getIdToken();
          const res = await fetch("/api/session?action=rotatePin", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ courseId: activeCourse.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || "Rotation failed");

          const oldPin = session.pin;
          session.previousPin = data.previousPin || oldPin;
          session.pin = data.pin;
          // A number, already resolved server-side.
          session.pinRotationTime = data.pinRotationTime || Date.now();
          // Re-sync against the server clock rather than this device's, so a
          // rep whose phone clock is wrong still rotates on time.
          if (typeof data.serverNow === "number") {
            session.clockOffsetMs = data.serverNow - Date.now();
          }
          console.log("PIN rotated (server):", oldPin, "→", data.pin);
          renderPortalState();
        } catch (error) {
          // The PIN is unchanged on the server, so keep showing the current one
          // rather than desyncing the screen from what students must type.
          console.error("Failed to rotate PIN on server:", error);
          // Back off so a failing endpoint is not hammered every second; the
          // next tick will retry.
          session.pinRotationTime = Date.now();
        }
      } else {
        // Update rotation countdown display
        if (pinRotationElement) {
          pinRotationElement.textContent = formatCountdown(
            timeUntilRotation / 1000,
          );
        }
      }

      if (timeLeft <= 0) {
        if (countdownInterval) clearInterval(countdownInterval);
        countdownInterval = null;
        session.expired = true;
        const isRep = currentUser && activeCourse.repUid === currentUser.uid;
        if (isRep) {
          await updateCourseInFirestore();
        }
        renderPortalState();
      } else {
        if (liveTimerElement) {
          liveTimerElement.textContent = formatCountdown(timeLeft);
        }
      }
    };

    tick();
    countdownInterval = setInterval(tick, 1000);
  }

  if (checkInForm) {
    checkInForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const enteredPin = document
        .getElementById("studentPinInput")
        .value.trim();
      if (!enteredPin) return;

      const deviceId = getOrCreateDeviceId();
      const isNoGps =
        activeCourse.activeSession &&
        activeCourse.activeSession.locationMode === "no_gps";

      // 🔒 Phase 5 moved three checks to the server, so a rejected check-in now
      // arrives with a machine-readable reason instead of a generic failure.
      // Each one gets its own message and its own toast weight — "you are 400m
      // away" and "too many wrong PINs" are very different problems for a
      // student, and collapsing them into "Check-in failed" is what made the
      // old behaviour untrustworthy.
      const explainCheckInError = (result, status) => {
        if (result && result.rateLimited) {
          const wait = result.retryAfterSeconds;
          toast.error(
            wait
              ? `Too many incorrect PINs. Wait ${wait}s and use the code currently on screen.`
              : "Too many incorrect PINs. Wait a moment and use the code currently on screen.",
            "Slow down",
          );
          return;
        }
        if (result && result.outOfRange) {
          toast.error(result.error, "Not in the hall");
          return;
        }
        if (result && (result.needsLocation || result.needsBetterFix)) {
          toast.warning(result.error, "Location needed");
          return;
        }
        if (result && typeof result.attemptsLeft === "number" && result.attemptsLeft > 0) {
          toast.error(result.error, "Incorrect PIN");
          return;
        }
        if (result && result.pinExpired) {
          toast.warning(result.error, "PIN expired");
          return;
        }
        toast.error((result && result.error) || "Check-in failed.");
      };

      // Fast path: If session has No GPS requirement, submit immediately!
      if (isNoGps) {
        toast.info("Submitting attendance...", "Checking In");
        try {
          const idToken = await auth.currentUser.getIdToken();
          const response = await fetch("/api/attendance?action=submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              courseId: activeCourse.id,
              pin: enteredPin,
              deviceId: deviceId,
            }),
          });

          const result = await response.json();
          if (!response.ok) {
            explainCheckInError(result, response.status);
            // Only count a strike for a genuine wrong PIN. A rate-limit or
            // geofence rejection is the server's verdict, not a student typo,
            // and double-counting it would escalate a legitimate retry.
            if (!result.rateLimited && !result.outOfRange && !result.needsLocation) {
              recordCheckInFailure(activeCourse.id);
            }
            return;
          }

          // Success instantly clears the hidden strike counter.
          resetCheckInFailures(activeCourse.id);
          showCheckInSuccess();
          toast.success("Your attendance has been recorded!", "Checked In! 🎉");
          checkInForm.reset();
        } catch (error) {
          toast.error(error.message);
          console.error(error);
          // Silent strike — never surfaced until the 3rd one unlocks the override.
          recordCheckInFailure(activeCourse.id);
        }
        return;
      }

      // GPS Geofence path:
      if (!navigator.geolocation) {
        toast.error("Geolocation is not supported by your browser.");
        return;
      }

      toast.info("Getting the best GPS lock available...", "📍 Location Check");

      const tryCheckIn = async (position) => {
        const studentLat = position.coords.latitude;
        const studentLon = position.coords.longitude;
        const accuracy = position.coords.accuracy || 999;

        if (accuracy > 250) {
          toast.warning(
            `GPS is imprecise (±${Math.round(accuracy)}m). Submitting anyway — indoor signal is often like this.`,
            "Weak Signal",
          );
        }

        try {
          const idToken = await auth.currentUser.getIdToken();
          const response = await fetch("/api/attendance?action=submit", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              courseId: activeCourse.id,
              pin: enteredPin,
              lat: studentLat,
              lon: studentLon,
              accuracy: accuracy,
              deviceId: deviceId,
            }),
          });

          const result = await response.json();
          if (!response.ok) {
            explainCheckInError(result, response.status);
            // See the no-GPS path: a server verdict (rate limit, geofence) is
            // not a student typo, so it must not also burn a local strike.
            if (!result.rateLimited && !result.outOfRange && !result.needsLocation) {
              recordCheckInFailure(activeCourse.id);
            }
            return;
          }

          // Success instantly clears the hidden strike counter.
          resetCheckInFailures(activeCourse.id);
          showCheckInSuccess();
          toast.success("Your attendance has been recorded!", "Checked In! 🎉");
          checkInForm.reset();
        } catch (error) {
          toast.error(error.message);
          console.error(error);
          // Silent strike — never surfaced until the 3rd one unlocks the override.
          recordCheckInFailure(activeCourse.id);
        }
      };

      try {
        const position = await getBestGpsPosition(12000);
        await tryCheckIn(position);
      } catch (error) {
        // A dead GPS chip or denied permission is exactly the situation the
        // fail-safe exists for — this silent strike also counts.
        recordCheckInFailure(activeCourse.id);
        console.error("GPS error code:", error.code, error.message);
        if (error.code === 1) {
          toast.error(
            "Location access was denied. In Chrome: tap the lock icon in the address bar → Site settings → Location → Allow.",
            "GPS Permission Denied",
          );
        } else {
          toast.error(
            "Could not get your location. Enable Location in phone settings, or ask the Rep to use PIN + Device Lock.",
            "GPS Error",
          );
        }
      }
    });
  }

  // --- HIDDEN FAIL-SAFE OVERRIDE: student-side UI wiring ---
  const requestManualBtn = document.getElementById("requestManualBtn");
  const sendManualRequestBtn = document.getElementById("sendManualRequestBtn");
  if (requestManualBtn) {
    requestManualBtn.addEventListener("click", () => {
      const panel = document.getElementById("manualOverridePanel");
      if (panel) {
        panel.classList.toggle("hidden");
        refreshIcons();
      }
    });
  }
  if (sendManualRequestBtn) {
    sendManualRequestBtn.addEventListener("click", submitManualRequest);
  }

  // --- PHYSICAL PRESENCE CHECK (headcount) wiring ---
  const conductHeadcountBtn = document.getElementById("conductHeadcountBtn");
  if (conductHeadcountBtn) {
    conductHeadcountBtn.addEventListener("click", () => {
      const panel = document.getElementById("headcountPanel");
      if (panel) {
        panel.classList.toggle("hidden");
        refreshIcons();
      }
    });
  }

  const saveHeadcountBtn = document.getElementById("saveHeadcountBtn");
  if (saveHeadcountBtn) {
    saveHeadcountBtn.addEventListener("click", () => {
      const input = document.getElementById("physicalCountInput");
      if (!input || !activeCourse || !activeCourse.activeSession) return;
      const value = parseInt(input.value, 10);
      if (isNaN(value) || value < 0) {
        toast.warning("Enter a valid body count first.", "Invalid Count");
        return;
      }
      activeCourse.activeSession.physicalHeadcount = value;
      syncHeadcountUI();
      toast.success(
        `Physical count saved: ${value}. Comparison updated.`,
        "Headcount 🧍",
      );
    });
  }

  // Live comparison of bodies-in-hall vs system check-ins for this session.
  function syncHeadcountUI() {
    const presenceCheckPanel = document.getElementById("presenceCheckPanel");
    if (!presenceCheckPanel) return;
    const session = activeCourse ? activeCourse.activeSession : null;
    const hasSession =
      session &&
      (session.pin || (session.attendees && session.attendees.length > 0));
    presenceCheckPanel.classList.toggle("hidden", !hasSession);

    const comparisonEl = document.getElementById("headcountComparison");
    if (!comparisonEl) return;
    const physical =
      session && typeof session.physicalHeadcount === "number"
        ? session.physicalHeadcount
        : null;
    if (physical === null) {
      comparisonEl.classList.add("hidden");
      return;
    }
    const systemCount =
      session && session.attendees ? session.attendees.length : 0;
    const diff = systemCount - physical;
    comparisonEl.classList.remove("hidden");
    if (diff === 0) {
      comparisonEl.style.background = "rgba(40, 167, 69, 0.1)";
      comparisonEl.style.color = "#28a745";
      comparisonEl.textContent = `🧍 Physical: ${physical} | 💻 System: ${systemCount} — perfect match. Close class to archive.`;
    } else if (diff > 0) {
      comparisonEl.style.background = "rgba(220, 53, 69, 0.08)";
      comparisonEl.style.color = "#dc3545";
      comparisonEl.textContent = `🧍 Physical: ${physical} | 💻 System: ${systemCount} — ${diff} ghost check-in(s). Spot the empty seat on the roster and 🚩 Flag Absent.`;
    } else {
      comparisonEl.style.background = "rgba(253, 126, 20, 0.1)";
      comparisonEl.style.color = "#fd7e14";
      comparisonEl.textContent = `🧍 Physical: ${physical} | 💻 System: ${systemCount} — ${Math.abs(diff)} body(ies) may not have checked in. Point them to the manual override (3 failed attempts) or approve them from the manual requests queue.`;
    }
  }

  // --- ANTI-BEEF: flag a suspicious check-in absent. Attendance is NEVER
  // deleted — the student gets an emergency alert and the act is logged. ---
  window.flagStudentAbsent = async function (matric) {
    if (!activeCourse || !auth.currentUser) return;
    const member = (activeCourse.members || []).find(
      (m) => normalizeMatric(m.matric) === normalizeMatric(matric),
    );
    if (!member) {
      toast.error("Member record not found for this student.", "Cannot Flag");
      return;
    }
    const ok = await showConfirm({
      title: "🚩 Flag Absent",
      message: `Flag [${matric}] as physically absent? Their phone gets an emergency alert to see you immediately. Attendance is NOT deleted — this decision is final and permanently logged.`,
      okText: "Flag Absent",
      cancelText: "Cancel",
      icon: "flag",
      danger: true,
    });
    if (!ok) return;
    try {
      const idToken = await auth.currentUser.getIdToken();
      const response = await fetch("/api/attendance?action=flagAbsent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          courseId: activeCourse.id,
          targetUid: member.uid,
        }),
      });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Unable to flag student.");
      toast.success(
        result.message || "Student flagged — emergency alert sent.",
        "Flagged 🚩",
      );
    } catch (error) {
      console.error("Flag absent error:", error);
      toast.error(error.message);
    }
  };

  const closeClassBtn = document.getElementById("closeClassBtn");

  if (closeClassBtn) {
    closeClassBtn.addEventListener("click", async () => {
      if (!activeCourse) return;

      if (
        await showConfirm({
          title: "Close Class",
          message:
            "This will save the attendance records and end the active session.",
          okText: "Close & Save",
          cancelText: "Cancel",
          icon: "📁",
          danger: false,
        })
      ) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          const response = await fetch("/api/session?action=close", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({
              courseId: activeCourse.id,
              physicalHeadcount:
                activeCourse.activeSession &&
                typeof activeCourse.activeSession.physicalHeadcount === "number"
                  ? activeCourse.activeSession.physicalHeadcount
                  : null,
            }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || "Unable to close session.");

          // Clear local session state
          activeCourse.activeSession = null;
          if (countdownInterval) clearInterval(countdownInterval);

          // Reload attendance history from the subcollection
          await loadAttendanceHistory();

          renderPortalState();
          toast.success(
            "Attendance records have been saved to the archive.",
            "Class Closed 📁",
          );
        } catch (error) {
          console.error("Close session error:", error);
          toast.error("Unable to close session. Please try again.");
        }
      }
    });
  }

  const endSemesterBtn = document.getElementById("endSemesterBtn");

  if (endSemesterBtn) {
    endSemesterBtn.addEventListener("click", async () => {
      if (!activeCourse) return;

      if (
        await showConfirm({
          title: "End Semester",
          message: `This will permanently delete all attendance history for "${activeCourse.name}" and reset the class count to zero.`,
          okText: "End Semester",
          cancelText: "Cancel",
          icon: "🎓",
          danger: true,
        })
      ) {
        try {
          const idToken = await auth.currentUser.getIdToken();
          const response = await fetch("/api/semester?action=endSemester", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${idToken}`,
            },
            body: JSON.stringify({ courseId: activeCourse.id }),
          });
          const result = await response.json();
          if (!response.ok)
            throw new Error(result.error || "Unable to end semester.");

          activeCourse.attendanceHistory = [];
          activeCourse.activeSession = null;
          if (countdownInterval) clearInterval(countdownInterval);

          renderPortalState();
          toast.success(
            "All records have been cleared. New semester ready.",
            "Semester Ended 🎓",
          );
        } catch (error) {
          console.error("End semester error:", error);
          toast.error("Unable to end semester. Please try again.");
        }
      }
    });
  }

  // Load attendance history from the attendance/ subcollection (source of truth)
  async function loadAttendanceHistory() {
    if (!activeCourse || !activeCourse.id) return;
    try {
      const snap = await getDocs(
        query(
          collection(db, "courses", activeCourse.id, "attendance"),
          orderBy("closedAt", "asc"),
        ),
      );
      activeCourse.attendanceHistory = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((record) => Array.isArray(record.attendees));
      renderPortalState();
    } catch (error) {
      console.error("Failed to load attendance history:", error);
      activeCourse.attendanceHistory = activeCourse.attendanceHistory || [];
    }
  }

  function sessionPayloadForCourseDoc(session) {
    if (!session) return null;
    return {
      expiresAt: session.expiresAt || null,
      expired: !!session.expired,
      locationMode: session.locationMode || "no_gps",
      // Keep the QR mode on the public course doc too — losing it on every
      // course snapshot is what made the "Show QR" / "Hotspots" buttons
      // flicker until the secret listener re-set it.
      qrMode: !!session.qrMode,
      hallName: session.hallName || null,
      attendees: session.attendees || [],
      radius: session.radius || 80,
      lat: typeof session.lat === "number" ? session.lat : null,
      lon: typeof session.lon === "number" ? session.lon : null,
    };
  }

  async function updateCourseInFirestore() {
    if (!activeCourse || !activeCourse.id) return;
    const courseRef = doc(db, "courses", activeCourse.id);
    await updateDoc(courseRef, {
      activeSession: sessionPayloadForCourseDoc(activeCourse.activeSession),
      assistants: activeCourse.assistants || [],
      savedHalls: activeCourse.savedHalls || [],
    });
  }

  window.downloadAttendance = function (index) {
    if (
      !activeCourse ||
      !activeCourse.attendanceHistory ||
      !activeCourse.attendanceHistory[index]
    )
      return;

    const sessionRecord = activeCourse.attendanceHistory[index];
    let csvContent = "data:text/csv;charset=utf-8,Name,Matric Number,Status\n";

    sessionRecord.attendees.forEach((matric) => {
      const norm = normalizeMatric(matric);
      const rec = (activeCourse.members || []).find(
        (m) => normalizeMatric(m.matric) === norm,
      );
      const nm = rec && rec.name ? String(rec.name).replace(/"/g, "'") : "";
      csvContent += `"${nm}","${norm}","Present"\r\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `${activeCourse.code}_Attendance_${sessionRecord.date.replace(/[/:\s]/g, "_")}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  function renderPortalState() {
    if (!activeCourse) return;

    const userMatric = normalizeMatric(currentUser ? currentUser.matric : "");
    const isRep = currentUser && activeCourse.repUid === currentUser.uid;
    const isAssistant =
      currentUser &&
      (activeCourse.assistants || []).map(normalizeMatric).includes(userMatric);
    const session = activeCourse.activeSession;
    const isSessionActive =
      session && !session.expired && getAccurateNow() < session.expiresAt;

    // 🆙 HOTSPOT PROMOTION (mid-session): a student granted hotspot power
    // while their portal is already open reloads the same activeCourse through
    // the course listener, but entered as a plain student — so swap them to
    // staff chrome and start the staff listeners they're now entitled to
    // (the secret listener is what feeds the live PIN into their QR card).
    const repControlsEl = document.getElementById("repControls");
    const studentControlsEl = document.getElementById("studentControls");
    const wasStudentView =
      repControlsEl && repControlsEl.classList.contains("hidden");
    if ((isRep || isAssistant) && wasStudentView) {
      if (repControlsEl) repControlsEl.classList.remove("hidden");
      if (studentControlsEl) studentControlsEl.classList.add("hidden");
      const managementToolbarPromo = document.getElementById(
        "managementToolbar",
      );
      if (managementToolbarPromo) {
        managementToolbarPromo.classList.remove("hidden");
      }
      if (typeof syncDrawerTabVisibility === "function") {
        syncDrawerTabVisibility();
        showDrawerView("checkin");
      }
      startSessionSecretListener(activeCourse.id);
      startDeviceFlagsListener(activeCourse.id);
      startManualRequestsListener(activeCourse.id);
      startAbsentFlagsListener(activeCourse.id);
      startSessionLiveListener(activeCourse.id);
    } else if (!isRep && !isAssistant && !wasStudentView) {
      // Revoked mid-session (session close flips session_assistant back to
      // student while we're watching): restore the student chrome.
      if (repControlsEl) repControlsEl.classList.add("hidden");
      if (studentControlsEl) studentControlsEl.classList.remove("hidden");
      if (typeof syncDrawerTabVisibility === "function") {
        syncDrawerTabVisibility();
      }
      if (activeCourse.id) startMyManualRequestListener(activeCourse.id);
    }

    // Keep hotspot chrome in sync on every course/members snapshot — a
    // mid-session promotion or the auto-revoke at close both land here.
    syncHotspotChrome();

    // 📡 Public hotspot strip: live for EVERYONE in the portal (students
    // included) — transparency is not a staff privilege.
    ensureHotspotLogListener();
    renderHotspotStrip();
    // Keep the open hotspot picker in sync as more students check in.
    renderHotspotPickerIfOpen();

    // ⚠️ ANCHOR HEALTH: clustered GPS rejections mean the rep's captured
    // anchor is probably off (indoor WiFi-positioning lies). Surface it so
    // the rep can re-anchor or switch modes instead of students failing
    // silently one by one.
    const anchorEl = document.getElementById("anchorHealthWarning");
    if (anchorEl) {
      const fixes = (session && session.rejectedFixes) || [];
      const cutoff = Date.now() - 15 * 60 * 1000;
      const recent = fixes.filter((f) => (f.at || 0) >= cutoff);
      if (recent.length >= 3 && (isRep || isAssistant)) {
        anchorEl.classList.remove("hidden");
        const anchorAcc = session.anchorAccuracy;
        anchorEl.innerHTML = `⚠️ <strong>${recent.length} students rejected by the GPS fence</strong> in the last 15 minutes. Your captured anchor (±${anchorAcc ? Math.round(anchorAcc) : "?"}m) is probably off — students can use their manual request button, or close &amp; re-generate with a fresh <strong>Set Current Location</strong> or PIN + Device Lock mode.`;
      } else {
        anchorEl.classList.add("hidden");
      }
    }

    // Phase cards: setup shows pre-class, live card shows during/after.
    syncRepPhaseUI();

    const bannerTitle = document.getElementById("bannerTitle");
    const bannerText = document.getElementById("bannerText");
    const closeClassWrapper = document.getElementById("closeClassWrapper");

    if (isSessionActive) {
      if (sessionBanner) {
        sessionBanner.classList.remove("hidden");
        sessionBanner.style.borderColor = "#28a745";
        sessionBanner.style.background = "rgba(40, 167, 69, 0.1)";
        if (bannerTitle) {
          bannerTitle.textContent = "🔴 ATTENDANCE SESSION LIVE";
          bannerTitle.style.color = "#28a745";
        }
        if (bannerText) {
          const deadline =
            session.localDeadline || session.expiresAt - serverClockSkewMs;
          const msRemaining = deadline - Date.now();
          const initialSeconds = Math.max(
            0,
            Math.ceil(msRemaining / 1000),
          );
          bannerText.innerHTML = `Check-in closes in <strong id="countdownTimer" style="font-size: 1.2rem;">${formatCountdown(initialSeconds)}</strong>`;
        }
      }

      // Activate security monitoring for students during live sessions
      if (!isRep && !isAssistant && securityControls) {
        console.log("Security monitoring activated for student");
      }

      if (isRep || isAssistant) {
        if (activePinDisplay) {
          activePinDisplay.classList.remove("hidden");
          // Force immediate PIN display
          if (pinCodeText) {
            pinCodeText.textContent = session.pin || "----";
            console.log("PIN displayed:", session.pin);
          }
        }
        if (generatePinBtn) generatePinBtn.textContent = "🔄 Regenerate PIN";
        if (closeClassWrapper) closeClassWrapper.classList.remove("hidden");

        const showQrBtnEl = document.getElementById("showQrBtn");
        // Authoritative source is the LIVE session's qrMode flag (set at
        // creation), not the viewer's localStorage mode — hotspots never
        // picked a mode on their own device.
        const isQrLive =
          session &&
          session.qrMode === true &&
          !session.expired &&
          getAccurateNow() < session.expiresAt;
        const hotspotsBtnEl = document.getElementById("hotspotsBtn");
        // Only touch the DOM when the visible state actually changed — many
        // listeners (secret, course doc, checks-in) call renderPortalState
        // every few seconds during a live session, and blind classList
        // toggling is what made these buttons appear/disappear in bursts.
        const qrLiveSig = isQrLive ? "1" : "0";
        if (
          showQrBtnEl &&
          showQrBtnEl.dataset.qrLive !== qrLiveSig
        ) {
          showQrBtnEl.dataset.qrLive = qrLiveSig;
          showQrBtnEl.classList.toggle("hidden", !isQrLive);
        }
        if (
          hotspotsBtnEl &&
          hotspotsBtnEl.dataset.qrLive !== qrLiveSig
        ) {
          hotspotsBtnEl.dataset.qrLive = qrLiveSig;
          hotspotsBtnEl.classList.toggle("hidden", !isQrLive);
        }
        // Session live — mode/hall selection is locked in; hide the pickers.
        const modeSectionLive = document.getElementById("attendanceModeSection");
        if (modeSectionLive) modeSectionLive.classList.add("hidden");
        const locSectionLive = document.getElementById("repHallSelect");
        if (locSectionLive) locSectionLive.disabled = true;
        // Projector view open? Re-render the QR for the fresh PIN.
        const qrOverlayEl = document.getElementById("qrModeOverlay");
        if (qrOverlayEl && !qrOverlayEl.classList.contains("hidden")) {
          renderQrOverlay();
        }
      }
      startSessionTimer();
    } else {
      if (sessionBanner) {
        if (session && session.expired) {
          sessionBanner.classList.remove("hidden");
          sessionBanner.style.borderColor = "#dc3545";
          sessionBanner.style.background = "rgba(220, 53, 69, 0.1)";
          if (bannerTitle) {
            bannerTitle.textContent = "⏹️ ATTENDANCE SESSION CLOSED";
            bannerTitle.style.color = "#dc3545";
          }
          if (bannerText) {
            if (isRep || isAssistant) {
              bannerText.textContent =
                "The check-in window has expired. PIN is no longer valid, but you can review and close class.";
            } else {
              bannerText.textContent =
                "The attendance window for this session has closed. PIN is no longer valid.";
            }
          }
        } else {
          sessionBanner.classList.add("hidden");
        }
      }
      if (isRep || isAssistant) {
        if (activePinDisplay) activePinDisplay.classList.add("hidden");
        if (generatePinBtn)
          generatePinBtn.textContent = "Generate Attendance PIN ⏱️";

        if (session && session.attendees && session.attendees.length > 0) {
          if (closeClassWrapper) closeClassWrapper.classList.remove("hidden");
        } else {
          if (closeClassWrapper) closeClassWrapper.classList.add("hidden");
        }

        const showQrBtnEl = document.getElementById("showQrBtn");
        // Reset the change-guard signature so the next live session can show
        // the buttons again (otherwise the "unchanged" shortcut would keep
        // them permanently hidden after a session closed).
        if (showQrBtnEl) {
          showQrBtnEl.dataset.qrLive = "0";
          showQrBtnEl.classList.add("hidden");
        }
        const hotspotsBtnEl = document.getElementById("hotspotsBtn");
        if (hotspotsBtnEl) {
          hotspotsBtnEl.dataset.qrLive = "0";
          hotspotsBtnEl.classList.add("hidden");
        }
        // No live session → bring the setup pickers back.
        const modeSectionIdle = document.getElementById("attendanceModeSection");
        if (modeSectionIdle) modeSectionIdle.classList.remove("hidden");
        if (window.closeQrMode) window.closeQrMode();
        syncModeUI();
        // No live session → nothing to project.
        if (window.closeQrMode) window.closeQrMode();
      }
    }

    if (!isRep && !isAssistant) {
      const studentPinHint = document.querySelector("#studentControls p");
      if (studentPinHint) {
        if (isSessionActive && session.qrMode) {
          studentPinHint.textContent =
            "📺 Scan the rotating QR on the screen — it checks you in automatically. You can also type the PIN below. Device lock still applies.";
        } else if (isSessionActive && session.locationMode === "no_gps") {
          studentPinHint.textContent =
            "GPS is off for this session. Enter the 4-digit PIN announced by your Course Rep.";
        } else if (isSessionActive) {
          studentPinHint.textContent =
            "Enter the 4-digit PIN. Stay in the lecture hall — indoor GPS is often imprecise, keep trying near a window.";
        } else {
          studentPinHint.textContent =
            "Enter the 4-digit PIN announced by your Course Rep.";
        }
      }
    }

    if (!rosterList) return;

    const attendees = session && session.attendees ? session.attendees : [];

    // 👑 THE REP IS ALWAYS PRESENT — the course rep runs the session from the
    // hall, so they are definitionally inside it. The check-in feed (course doc
    // `activeSession.attendees`) can lose the rep's own seeded entry through
    // publish/merge races (students can only read the course doc, never the
    // PIN-bearing session/secret doc), so the DISPLAY list re-seeds them first
    // and dedupes. Everyone — rep, assistant, student — sees the rep exactly
    // once, ahead of the arrival order, and counts agree everywhere.
    const repMatric = (() => {
      if (!session || !activeCourse) return null;
      if (activeCourse.repUid) {
        const repMember = (activeCourse.members || []).find(
          (m) => String(m.uid) === String(activeCourse.repUid) && m.matric,
        );
        if (repMember) return normalizeMatric(repMember.matric);
      }
      // Fallback: in single-device test runs the rep's own account is the
      // creator — use their matric directly.
      return currentUser && activeCourse.repUid === currentUser.uid
        ? normalizeMatric(currentUser.matric)
        : null;
    })();
    const displayAttendees = (() => {
      const out = [];
      const seenUnique = new Set();
      [repMatric, ...attendees.map(normalizeMatric)].forEach((m) => {
        if (m && !seenUnique.has(m)) {
          seenUnique.add(m);
          out.push(m);
        }
      });
      return out;
    })();

    if (rosterCount) rosterCount.textContent = displayAttendees.length;
    syncHeadcountUI();

    // Anti-beef flags change the roster rows too — rebuild whenever the set
    // of flagged students changes, not just when attendees change.
    const flagsSignature = JSON.stringify(
      (activeCourse.absentFlags || [])
        .filter((f) => f.status === "flagged")
        .map((f) => normalizeMatric(f.matric))
        .sort(),
    );
    const flagsChanged = rosterList.dataset.flagsSignature !== flagsSignature;

    // ⚡ Change-detection: rebuild the roster ONLY when the attendee list or
    // the flag set actually changed. Every child of the list is one attendee
    // row (no header), so compare matric signatures directly — the old
    // count-based math (+1 / slice(1)) assumed a header row that doesn't
    // exist and silently never fired, rebuilding on every snapshot.
    const attendeesSig = JSON.stringify({
      cid: activeCourse ? activeCourse.id : null,
      m: displayAttendees,
    });
    const attendeesChanged =
      rosterList.dataset.attendeesSig !== attendeesSig;
    if (!flagsChanged && !attendeesChanged) return;

    rosterList.dataset.attendeesSig = attendeesSig;
    rosterList.innerHTML = "";

    if (displayAttendees.length === 0) {
      rosterList.innerHTML = `<li style="color: var(--muted); font-size: 0.9rem; text-align: center; padding: 10px;">No check-ins recorded yet. ⏳</li>`;
    } else {
      displayAttendees.forEach((matric) => {
        const normalizedM = normalizeMatric(matric);
        // Find this attendee's member record to get their actual role
        const memberRecord = (activeCourse.members || []).find(
          (m) => normalizeMatric(m.matric) === normalizedM,
        );
        const attendeeRole = memberRecord ? memberRecord.role : "student";
        const isRepAttendee =
          activeCourse.repUid === (memberRecord ? memberRecord.uid : null);

        let badgeHTML = "";
        if (isRepAttendee || attendeeRole === "rep") {
          badgeHTML = `<span style="background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">👑 REP</span>`;
        } else if (
          attendeeRole === "assistant" ||
          attendeeRole === "session_assistant"
        ) {
          badgeHTML = `<span style="background: #6f42c1; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 6px;">⭐ ASST</span>`;
        }

        // 🛡️ SESSION-SCOPED: only show flags for the CURRENT session. A
        // week-3 flag must not show 🚩 in week 8 — and because the Flag
        // button is gated on !flagRecord, an unscoped find also permanently
        // hid the re-flag button for anyone flagged once before.
        const currentExpiresAt = activeCourse.activeSession
          ? activeCourse.activeSession.expiresAt
          : null;
        const flagRecord = (activeCourse.absentFlags || []).find(
          (f) =>
            normalizeMatric(f.matric) === normalizedM &&
            f.status === "flagged" &&
            (!currentExpiresAt || f.sessionExpiresAt === currentExpiresAt),
        );
        const statusHTML = flagRecord
          ? `<span style="color: #dc3545; font-weight: bold;">🚩 Flagged Absent</span>`
          : `<span style="color: #28a745; font-weight: bold;">Present ✅</span>`;
        const groupInfo = (activeCourse.groups || []).find((g) =>
          (g.members || []).map(normalizeMatric).includes(normalizedM),
        );
        const groupBadgeHTML = groupInfo
          ? `<span style="background: var(--bg); border: 1px solid var(--border); color: var(--text-muted); padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; margin-left: 4px;">🏷️ ${escapeHTML(groupInfo.name)}</span>`
          : "";
        const flagBtnHTML =
          (isRep || isAssistant) &&
          !flagRecord &&
          !(isRepAttendee || attendeeRole === "rep") &&
          !(memberRecord && memberRecord.pendingRegistration)
            ? `<button data-matric="${escapeHTML(matric)}" class="flag-absent-btn" title="Empty seat linked to this check-in? Flag it — the student gets an emergency alert and cannot be quietly deleted" style="background: transparent; border: 1px solid #dc3545; color: #dc3545; border-radius: 6px; cursor: pointer; font-size: 0.72rem; font-weight: bold; padding: 3px 8px; margin-left: 8px;">🚩 Flag Absent</button>`
            : "";

        const li = document.createElement("li");
        li.dataset.matric = normalizedM;
        li.style.cssText =
          "display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 6px; padding: 10px 12px; border-bottom: 1px solid var(--border); font-size: 0.9rem;";
        li.innerHTML = `<span>🎓 <strong>${attendeeRole === "rep" || isRepAttendee ? "Rep" : "Student"}</strong> · ${escapeHTML(nameForMatric(matric))} ${badgeHTML}${groupBadgeHTML}</span> <span style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">${statusHTML}${flagBtnHTML}</span>`;
        rosterList.appendChild(li);
      });
    }

    rosterList.dataset.flagsSignature = flagsSignature;

    if (isRep) {
      renderAuditSection();
      renderSecurityEventsPanel();
    }

    if (isRep) {
      let enrolledListDiv = document.getElementById(
        "repEnrolledStudentsSection",
      );

      if (!enrolledListDiv && portalSection) {
        enrolledListDiv = document.createElement("div");
        enrolledListDiv.id = "repEnrolledStudentsSection";
        enrolledListDiv.className = "hidden";
        enrolledListDiv.style.cssText =
          "margin-top: 20px; background: var(--bg); padding: 20px; border-radius: 12px; border: 1.5px solid var(--border); margin-bottom: 20px;";

        const targetParent = portalSection;
        targetParent.appendChild(enrolledListDiv);
      }

      if (enrolledListDiv) {
        const enrolledMatrics = activeCourse.enrolled || [];
        let studentRowsHTML = "";

        if (enrolledMatrics.length === 0) {
          studentRowsHTML = `<p style="color: var(--muted); font-size: 0.85rem;">No students enrolled yet.</p>`;
        } else {
          enrolledMatrics.forEach((matric) => {
            const isRepMatric = userMatric === normalizeMatric(matric);
            const safeMatric = escapeHTML(matric);
            studentRowsHTML += `
            <li style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; background: var(--bg); border-radius: 6px; margin-bottom: 6px; font-size: 0.85rem;">
              <span>🎓 <strong>${safeMatric}</strong> ${isRepMatric ? "(You - Rep)" : ""}</span>
              ${!isRepMatric ? `<button data-matric="${safeMatric}" class="remove-student-btn" style="background: transparent; border: none; color: var(--danger); cursor: pointer; font-size: 0.8rem; font-weight: bold;">Remove 🚪❌</button>` : ""}
            </li>
          `;
          });
        }

        enrolledListDiv.innerHTML = `
        <h4 style="color: var(--navy); margin-bottom: 10px; font-size: 1rem;">👥 Manage Enrolled Students (${enrolledMatrics.length})</h4>
        <p style="font-size: 0.8rem; color: var(--muted); margin-bottom: 10px;">Remove unauthorized students who joined your course code. While a session is LIVE, removals are blocked — use 🚩 Flag Absent on the roster instead.</p>
        <ul style="list-style: none; padding: 0; max-height: 180px; overflow-y: auto;">
          ${studentRowsHTML}
        </ul>
      `;

      // Event delegation for remove buttons (XSS-safe: matric from data attribute)
      enrolledListDiv.addEventListener("click", (e) => {
        const removeBtn = e.target.closest(".remove-student-btn");
        if (removeBtn) {
          e.preventDefault();
          removeStudentFromCourse(removeBtn.dataset.matric);
        }
      });
      }
    }

    const repArchiveSection = document.getElementById("repArchiveSection");
    if (isRep && repArchiveSection) {
      const totalClassesCount = document.getElementById("totalClassesCount");
      const archiveListContainer = document.getElementById(
        "archiveListContainer",
      );

      const history = activeCourse.attendanceHistory || [];
      if (totalClassesCount) totalClassesCount.textContent = history.length;

      if (history.length === 0) {
        archiveListContainer.innerHTML = `<p style="font-size: 0.9rem; color: var(--muted); text-align: center; padding: 10px;">No archived classes yet. Close a live class to save records here! 🗂️</p>`;
      } else {
        archiveListContainer.innerHTML = "";
        history.forEach((sessionRecord, archiveIndex) => {
          const archiveCard = document.createElement("div");
          archiveCard.style.cssText =
            "background: var(--card-bg); padding: 12px; border-radius: 8px; margin-bottom: 10px; border: 1px solid var(--border);";

          const attendeesListHTML = sessionRecord.attendees
            .map((m) => {
              return `<li style="font-size: 0.85rem; padding: 2px 0;">🎓 ${escapeHTML(nameForMatric(m))}</li>`;
            })
            .join("");

          const headcountBadgeHTML =
            sessionRecord.physicalHeadcount !== null &&
            sessionRecord.physicalHeadcount !== undefined
              ? `<span style="font-size: 0.8rem; background: #6f42c1; color: white; padding: 2px 6px; border-radius: 4px;">🧍 ${sessionRecord.physicalHeadcount}/${sessionRecord.systemCount !== undefined ? sessionRecord.systemCount : sessionRecord.attendees.length}</span>`
              : "";
          const flagsBadgeHTML =
            sessionRecord.flaggedAbsent && sessionRecord.flaggedAbsent.length
              ? `<span style="font-size: 0.8rem; background: #dc3545; color: white; padding: 2px 6px; border-radius: 4px;">🚩 ${sessionRecord.flaggedAbsent.length} Flagged</span>`
              : "";

          archiveCard.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
            <strong>📅 Session on ${escapeHTML(sessionRecord.date)}</strong>
            <div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end;">
              <span style="font-size: 0.8rem; background: var(--teal); color: white; padding: 2px 6px; border-radius: 4px;">${sessionRecord.attendees.length} Present</span>
              ${headcountBadgeHTML}
              ${flagsBadgeHTML}
              <button onclick="downloadAttendance(${archiveIndex})" class="btn" style="padding: 4px 10px; font-size: 0.75rem; width: auto;" title="Download CSV">📥 CSV</button>
            </div>
          </div>
          <details style="font-size: 0.85rem; color: var(--muted); cursor: pointer; margin-top: 5px;">
            <summary>View Attendees List 👀</summary>
            <ul style="list-style: none; padding-left: 10px; margin-top: 5px;">${attendeesListHTML}</ul>
          </details>
        `;
          archiveListContainer.appendChild(archiveCard);
        });
      }

      const deviceFlagsCount = document.getElementById("deviceFlagsCount");
      const deviceFlagsListContainer = document.getElementById(
        "deviceFlagsListContainer",
      );
      const flags = activeCourse.deviceFlags || [];
      if (deviceFlagsCount) deviceFlagsCount.textContent = flags.length;

      if (deviceFlagsListContainer) {
        if (flags.length === 0) {
          deviceFlagsListContainer.innerHTML = `<p style="font-size: 0.85rem; color: var(--muted); text-align: center; padding: 8px;">No flagged attempts. 👍</p>`;
        } else {
          // 🔁 MULTIPLE ACCOUNT DETECTION: group flags by physical device.
          // A phone showing up with 2+ DIFFERENT attempted matrics is being
          // used for proxy attendance at scale — surface that severity first.
          const byDevice = {};
          flags.forEach((flag) => {
            const key = flag.deviceId || "unknown";
            if (!byDevice[key]) byDevice[key] = [];
            byDevice[key].push(flag);
          });

          const deviceGroups = Object.entries(byDevice)
            .map(([deviceId, group]) => {
              const attemptedMatrics = [
                ...new Set(
                  group
                    .map((f) => normalizeMatric(f.attemptedMatric || ""))
                    .filter(Boolean),
                ),
              ];
              const latest = group.reduce((acc, f) => {
                const t =
                  f.createdAt && f.createdAt.toMillis
                    ? f.createdAt.toMillis()
                    : 0;
                return Math.max(acc, t);
              }, 0);
              return { deviceId, group, attemptedMatrics, latest };
            })
            .sort((a, b) => b.latest - a.latest);

          deviceFlagsListContainer.innerHTML = "";
          deviceGroups.forEach((dg) => {
            const flagCard = document.createElement("div");
            flagCard.style.cssText =
              "background: var(--card-bg); padding: 10px 12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid var(--danger);";
            const whenText = dg.latest
              ? new Date(dg.latest).toLocaleString()
              : "Just now";
            const hotspotBadge =
              dg.attemptedMatrics.length > 1
                ? `<span style="background: #dc3545; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold;">🔁 MULTI-ACCOUNT: ${dg.attemptedMatrics.length} matrics on ONE device</span>`
                : dg.group.length > 1
                  ? `<span style="background: #fd7e14; color: white; padding: 2px 6px; border-radius: 4px; font-size: 0.7rem; font-weight: bold;">🔁 ${dg.group.length} hotspot attempts</span>`
                  : "";
            const matricList = dg.attemptedMatrics
              .map((m) => `<strong>${escapeHTML(m)}</strong>`)
              .join(", ");
            flagCard.innerHTML = `
              <div style="display: flex; justify-content: space-between; align-items: center; gap: 6px; flex-wrap: wrap;">
                <div style="font-size: 0.85rem;">
                  📱 Device …${escapeHTML((dg.deviceId || "").slice(-6))} locked to <strong>${escapeHTML(dg.group[0].boundMatric || "?")}</strong>
                </div>
                ${hotspotBadge}
              </div>
              <div style="font-size: 0.78rem; color: var(--muted); margin-top: 4px;">
                Attempted: ${matricList} · ${dg.group.length} attempt(s) · last: ${whenText}
              </div>
            `;
            deviceFlagsListContainer.appendChild(flagCard);
          });
        }
      }

      // 👁️ Session security signals (screenshot attempts / left-app pings)
      renderSecurityEventsPanel();
    }

    const studentAnalyticsSection = document.getElementById(
      "studentAnalyticsSection",
    );
    const isEnrolled = (activeCourse.enrolled || [])
      .map(normalizeMatric)
      .includes(userMatric);

    if (isEnrolled && studentAnalyticsSection) {
      studentAnalyticsSection.classList.remove("hidden");

      const history = activeCourse.attendanceHistory || [];
      const totalClasses = history.length;

      // Use cached exemptions
      const exemptions = studentExemptions || [];

      let attendedCount = 0;
      let excusedCount = 0;
      let historyListHTML = "";

      history.forEach((sessionRecord) => {
        const normalizedAttendees = (sessionRecord.attendees || []).map(
          normalizeMatric,
        );
        const wasPresent = normalizedAttendees.includes(userMatric);
        if (wasPresent) attendedCount++;

        // Check if this session date has an exemption
        const sessionDate = sessionRecord.date || "";
        const hasExemption = exemptions.some(ex => ex.date === sessionDate);
        if (hasExemption) excusedCount++;

        let statusText = wasPresent ? "Present ✅" : "Absent ❌";
        let statusColor = wasPresent ? "#28a745" : "#dc3545";

        if (!wasPresent && hasExemption) {
          statusText = "Excused 🛡️";
          statusColor = "#fd7e14";
        }

        historyListHTML += `
        <li style="display: flex; justify-content: space-between; padding: 6px 10px; border-bottom: 1px solid var(--border); font-size: 0.85rem;">
          <span>📅 ${sessionRecord.date}</span>
          <span style="font-weight: bold; color: ${statusColor};">
            ${statusText}
          </span>
        </li>
      `;
      });

      // Calculate percentage considering exemptions
      const effectiveClasses = totalClasses - excusedCount;
      const percentage =
        effectiveClasses > 0
          ? Math.round((attendedCount / effectiveClasses) * 100)
          : 100;

      document.getElementById("statAttendedCount").textContent = attendedCount;
      document.getElementById("statTotalClasses").textContent = `${totalClasses} (${excusedCount} excused)`;
      document.getElementById("statPercentage").textContent = `${percentage}%`;

      // Grade Projection Logic
      const gradeProjectionContent = document.getElementById("gradeProjectionContent");
      if (gradeProjectionContent) {
        if (totalClasses === 0) {
          gradeProjectionContent.innerHTML = `<p style="color: var(--muted);">Attend more classes to see your projection.</p>`;
        } else {
          const remainingClasses = Math.max(0, 10 - totalClasses); // Assume ~10 classes per semester
          const neededToReach70 = Math.max(0, Math.ceil((0.70 * (effectiveClasses + remainingClasses)) - attendedCount));
          const neededToReach75 = Math.max(0, Math.ceil((0.75 * (effectiveClasses + remainingClasses)) - attendedCount));
          const neededToReach80 = Math.max(0, Math.ceil((0.80 * (effectiveClasses + remainingClasses)) - attendedCount));

          let projectionHTML = `<div style="display: flex; flex-direction: column; gap: 8px;">`;

          if (percentage >= 80) {
            projectionHTML += `<div style="color: #28a745; font-weight: 600;">🎉 Excellent! You're on track for 80%+ attendance.</div>`;
          } else if (percentage >= 70) {
            projectionHTML += `<div style="color: #28a745; font-weight: 600;">✅ You meet the 70% threshold. Aim higher!</div>`;
          } else {
            projectionHTML += `<div style="color: #dc3545; font-weight: 600;">⚠️ Below 70% threshold. You need to attend ${neededToReach70} more classes.</div>`;
          }

          projectionHTML += `<div style="font-size: 0.8rem; color: var(--muted); margin-top: 8px;">`;
          projectionHTML += `<div>To reach 75%: Attend ${neededToReach75} more classes</div>`;
          projectionHTML += `<div>To reach 80%: Attend ${neededToReach80} more classes</div>`;
          projectionHTML += `</div></div>`;

          gradeProjectionContent.innerHTML = projectionHTML;
        }
      }

      let personalLogContainer = document.getElementById(
        "personalLogContainer",
      );
      if (!personalLogContainer) {
        personalLogContainer = document.createElement("div");
        personalLogContainer.id = "personalLogContainer";
        personalLogContainer.style.cssText =
          "margin-top: 15px; background: var(--card-bg); padding: 10px; border-radius: 8px; border: 1px solid var(--border);";
        studentAnalyticsSection.appendChild(personalLogContainer);
      }

      personalLogContainer.innerHTML = `
      <p style="font-weight: bold; font-size: 0.9rem; margin-bottom: 8px;">📋 Your Class-by-Class Record:</p>
      <ul style="list-style: none; padding: 0; max-height: 150px; overflow-y: auto;">
        ${totalClasses === 0 ? '<li style="color: var(--muted); font-size: 0.85rem;">No classes held yet.</li>' : historyListHTML}
      </ul>
    `;

      const eligibilityBanner = document.getElementById("eligibilityBanner");
      if (totalClasses === 0) {
        eligibilityBanner.style.background = "rgba(108, 117, 125, 0.1)";
        eligibilityBanner.style.color = "var(--muted)";
        eligibilityBanner.textContent =
          "⏳ No archived classes yet. Analytics will update as classes are held.";
      } else if (percentage >= 70) {
        eligibilityBanner.style.background = "rgba(40, 167, 69, 0.1)";
        eligibilityBanner.style.color = "#28a745";
        const exemptionNote = excusedCount > 0 ? ` (${excusedCount} excused)` : "";
        eligibilityBanner.textContent = `✅ ELIGIBLE: You meet the 70% attendance threshold (${percentage}%${exemptionNote}).`;
      } else {
        eligibilityBanner.style.background = "rgba(220, 53, 69, 0.1)";
        eligibilityBanner.style.color = "#dc3545";
        const exemptionNote = excusedCount > 0 ? ` (${excusedCount} excused)` : "";
        eligibilityBanner.textContent = `⚠️ WARNING: Your attendance is at ${percentage}%${exemptionNote}. You are below the 70% exam eligibility requirement!`;
      }
    } else if (studentAnalyticsSection) {
      studentAnalyticsSection.classList.add("hidden");
    }

    // Side panels are drawer-driven now — a student sees only the panel their
    // STUDENT drawer selected; staff only via the rep drawer. Never force-stack.
    const rosterSectionEl = document.getElementById("rosterSection");
    if (rosterSectionEl) {
      const rosterVisible =
        isRep || isAssistant
          ? activeDrawerView === "roster"
          : activeStudentView === "roster";
      rosterSectionEl.classList.toggle("hidden", !rosterVisible);
    }
    const studentAnalyticsPanelEl = document.getElementById(
      "studentAnalyticsSection",
    );
    if (studentAnalyticsPanelEl) {
      const analyticsVisible =
        isRep || isAssistant
          ? activeDrawerView === "analytics"
          : activeStudentView === "analytics";
      studentAnalyticsPanelEl.classList.toggle("hidden", !analyticsVisible);
    }
    const classExemptionsPanelEl = document.getElementById(
      "classExemptionsSection",
    );
    if (classExemptionsPanelEl)
      classExemptionsPanelEl.classList.toggle(
        "hidden",
        activeStudentView !== "exemptions",
      );
    const classReportsPanelEl = document.getElementById(
      "classReportsSection",
    );
    if (classReportsPanelEl)
      classReportsPanelEl.classList.toggle(
        "hidden",
        activeStudentView !== "reports",
      );
  }


// ═══════════════════════════════════════════════════════════════════════
// ADVISER DASHBOARD (Phase 4)
// ═══════════════════════════════════════════════════════════════════════
// Two actions, one summary. An adviser is a gate, not a manager.
//
// 🔒 The gate below is the WHOLE point of this section. It requires BOTH
// role: "level_anchor" AND verificationStatus: "verified", mirroring
// isVerifiedAdviser() in utils/roles.js and api/roster.js. Testing
// role === "adviser" instead would reveal the roster to every UNVERIFIED
// applicant, so it must never be written that way.

function isVerifiedAdviser(profile) {
  return Boolean(
    profile &&
      profile.role === "level_anchor" &&
      profile.verificationStatus === "verified"
  );
}

let adviserRoster = null;      // last loaded roster, for the rep <select>
let adviserPendingCsv = null; // parsed, NOT yet committed to the server

function adviserEls() {
  return {
    section: document.getElementById("adviserDashboard"),
    scope: document.getElementById("adviserScope"),
    count: document.getElementById("rosterCount"),
    rep: document.getElementById("rosterRep"),
    imported: document.getElementById("rosterImported"),
    file: document.getElementById("rosterFile"),
    pick: document.getElementById("rosterPickBtn"),
    confirm: document.getElementById("rosterConfirmBtn"),
    cancel: document.getElementById("rosterCancelBtn"),
    msg: document.getElementById("rosterMsg"),
    preview: document.getElementById("rosterPreview"),
    repSelect: document.getElementById("repSelect"),
    repSave: document.getElementById("repSaveBtn"),
    repClear: document.getElementById("repClearBtn"),
    logWrap: document.getElementById("repLogWrap"),
    log: document.getElementById("repLog"),
  };
}

function adviserMessage(kind, html) {
  const el = adviserEls().msg;
  if (!el) return;
  el.className = "adviser-msg " + kind;
  // Callers pass server-supplied strings, so everything is escaped here and
  // never injected raw.
  el.innerHTML = html;
  el.classList.remove("hidden");
}

function adviserClearMessage() {
  const el = adviserEls().msg;
  if (el) { el.classList.add("hidden"); el.innerHTML = ""; }
}

async function adviserApi(action, body) {
  if (!auth.currentUser) throw new Error("Not signed in.");
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(`/api/roster?action=${encodeURIComponent(action)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body || {}),
  });
  let data = {};
  try { data = await res.json(); } catch (_) { data = {}; }
  if (!res.ok) {
    const err = new Error(data.error || "Something went wrong.");
    err.code = data.code;
    err.status = res.status;
    err.payload = data;
    throw err;
  }
  return data;
}

function renderAdviserLog(changes) {
  const { log, logWrap } = adviserEls();
  if (!log || !logWrap) return;
  if (!Array.isArray(changes) || !changes.length) { logWrap.classList.add("hidden"); return; }
  // Newest first reads better in a history list.
  log.innerHTML = changes
    .slice()
    .reverse()
    .map((c) => {
      const when = c.at ? formatAdviserDate(c.at) : "";
      const who = c.name || c.matric || "someone";
      let verb = "Chose";
      if (c.action === "replaced") verb = "Replaced with";
      else if (c.action === "cleared") verb = "Removed";
      else if (c.action === "reimport") verb = "Re-imported roster (rep kept)";
      if (c.action === "reimport") {
        return `<li>${when} &mdash; re-imported ${escapeHTML(String(c.count || 0))} students. Rep: <b>${escapeHTML(c.matric || "none")}</b></li>`;
      }
      const dropped = c.previousMatric
        ? ` (was ${escapeHTML(c.previousMatric)})`
        : "";
      return `<li>${when} &mdash; ${verb} <b>${escapeHTML(who)}</b>${dropped}</li>`;
    })
    .join("");
  logWrap.classList.remove("hidden");
}

function formatAdviserDate(value) {
  try {
    const d = value && typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  } catch (_) {
    return "";
  }
}

function renderAdviserPreview(preview, meta) {
  const { preview: box } = adviserEls();
  if (!box) return;
  if (!preview || !preview.length) {
    box.classList.add("hidden"); box.innerHTML = ""; return;
  }
  // The rows came from a file the adviser uploaded and were echoed back by the
  // server, so every value is escaped before it reaches the DOM.
  const rows = preview
    .slice(0, 50)
    .map(
      (st) =>
        `<tr><td>${escapeHTML(st.matric)}</td><td>${escapeHTML(st.name || "-")}</td>` +
        `<td>${escapeHTML(st.email || "-")}</td></tr>`
    )
    .join("");
  const more = preview.length > 50 ? `<p class="adviser-foot">+ ${preview.length - 50} more</p>` : "";
  box.innerHTML =
    `<div class="adviser-preview-head">Preview &mdash; ${escapeHTML(String(meta.total))} students ready</div>` +
    `<div class="adviser-preview-scroll"><table><thead><tr><th>Matric</th><th>Name</th><th>Email</th></tr></thead>` +
    `<tbody>${rows}</tbody></table></div>${more}`;
  box.classList.remove("hidden");
}

function renderAdviserRoster(data) {
  const { count, rep, imported, repSelect, repSave, repClear } = adviserEls();
  adviserRoster = data;

  if (count) count.textContent = String(data.count || 0);
  if (rep) {
    rep.textContent = data.chosenRepName
      ? data.chosenRepName + " (" + data.chosenRepMatric + ")"
      : data.chosenRepMatric || "Not chosen";
  }
  if (imported) {
    const when = data.lastImportAt ? formatAdviserDate(data.lastImportAt) : "";
    imported.textContent = when || (data.exists ? "Unknown" : "Never");
  }

  if (repSelect) {
    repSelect.innerHTML = "";
    const students = Array.isArray(data.students) ? data.students : [];
    if (!students.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = data.exists ? "No students on this roster" : "Import a roster first";
      repSelect.appendChild(opt);
      repSelect.disabled = true;
    } else {
      const blank = document.createElement("option");
      blank.value = "";
      blank.textContent = "Select a student...";
      repSelect.appendChild(blank);
      for (const st of students) {
        const opt = document.createElement("option");
        opt.value = st.matric;
        opt.textContent = (st.name || st.matric) + " - " + st.matric;
        if (st.matric === data.chosenRepMatric) opt.selected = true;
        repSelect.appendChild(opt);
      }
      repSelect.disabled = false;
    }
  }
  if (repSave) repSave.disabled = true;
  if (repClear) repClear.classList.toggle("hidden", !data.chosenRepMatric);
  renderAdviserLog(data.repChanges);
}

async function loadAdviserRoster() {
  const el = adviserEls();
  if (!el.section || el.section.classList.contains("hidden")) return;
  try {
    const data = await adviserApi("getRoster", {});
    renderAdviserRoster(data);
  } catch (err) {
    if (err.code === "NOT_VERIFIED_ADVISER") {
      // The server disagreed with our gate. Hide the panel rather than leave a
      // dead shell on screen.
      el.section.classList.add("hidden");
      return;
    }
    adviserMessage("err", escapeHTML(err.message));
  }
}

async function handleRosterFileChosen(file) {
  const el = adviserEls();
  if (!file) return;
  adviserClearMessage();
  if (file.size > 2 * 1024 * 1024) {
    adviserMessage("err", "That file is larger than 2&nbsp;MB. Please upload a plain CSV.");
    return;
  }
  let csv;
  try { csv = await file.text(); } catch (_) {
    adviserMessage("err", "Could not read that file. Please export it as CSV and try again.");
    return;
  }

  try {
    // Dry run: the server parses and counts WITHOUT writing. The adviser sees
    // the real numbers and confirms. Picking a file saves nothing.
    const data = await adviserApi("importRoster", { csv });
    adviserPendingCsv = csv;
    renderAdviserPreview(data.preview, data);
    const bits = [data.total + " students found."];
    if (data.duplicates) bits.push(data.duplicates + " already on the roster");
    if (data.added) bits.push(data.added + " new");
    if (data.replaced) bits.push("replacing " + data.replaced);
    let html = escapeHTML(bits.join(" | ")) + " Nothing is saved yet.";
    if (Array.isArray(data.warnings) && data.warnings.length) {
      html += "<ul>" + data.warnings.slice(0, 6).map((w) => "<li>" + escapeHTML(w) + "</li>").join("") + "</ul>";
    }
    adviserMessage("ok", html);
    if (el.confirm) el.confirm.classList.remove("hidden");
    if (el.cancel) el.cancel.classList.remove("hidden");
  } catch (err) {
    adviserPendingCsv = null;
    if (err.code === "INVALID_CSV" && err.payload) {
      const items = (err.payload.errors || [])
        .map((e) => "<li>Line " + e.line + ": " + escapeHTML(e.message) + "</li>")
        .join("");
      adviserMessage("err", escapeHTML(err.message) + "<ul>" + items + "</ul>");
    } else {
      adviserMessage("err", escapeHTML(err.message));
    }
  }
}

async function confirmRosterImport() {
  const el = adviserEls();
  if (!adviserPendingCsv) return;
  if (el.confirm) {
    el.confirm.disabled = true;
    el.confirm.textContent = "Saving...";
  }
  try {
    const data = await adviserApi("importRoster", { csv: adviserPendingCsv, commit: true });
    adviserPendingCsv = null;
    if (el.preview) { el.preview.classList.add("hidden"); el.preview.innerHTML = ""; }
    if (el.confirm) el.confirm.classList.add("hidden");
    if (el.cancel) el.cancel.classList.add("hidden");
    if (el.file) el.file.value = "";
    let msg = data.total + " students imported.";
    if (data.repDropped) {
      msg += " Your previous rep is no longer on this roster, so the rep role was cleared. Choose a new rep below.";
    }
    adviserMessage("ok", escapeHTML(msg));
    await loadAdviserRoster();
  } catch (err) {
    adviserMessage("err", escapeHTML(err.message));
  } finally {
    if (el.confirm) { el.confirm.disabled = false; el.confirm.textContent = "Confirm import"; }
  }
}

async function saveChosenRep(matric) {
  const el = adviserEls();
  const students = (adviserRoster && adviserRoster.students) || [];
  const picked = students.find((st) => st.matric === matric);
  const current = (adviserRoster && adviserRoster.chosenRepMatric) || "";
  const isReplacement = Boolean(current) && current !== matric;
  // A rep change is a real act of authority, so it is confirmed explicitly, and
  // a replacement states plainly who loses the role.
  const ok = await showConfirm({
    title: isReplacement ? "Replace the course rep?" : "Name this course rep?",
    // NOTE: no trailing comma on the first ternary arm. `a ? x + "y", : z` is a
    // syntax error — the comma closes the object property early and leaves the
    // second arm's `:` orphaned.
    message: isReplacement
      ? (adviserRoster.chosenRepName || current) +
        " currently holds the rep role and will go back to being a regular student."
      : "Only the student you name can run attendance for this level. Nobody else can claim it by signing up first.",
    okText: isReplacement ? "Yes, replace the rep" : "Yes, name this rep",
    cancelText: "Cancel",
    danger: isReplacement,
    icon: isReplacement ? "🔄" : "🎓",
    details: [
      { label: "Student", value: (picked && (picked.name || picked.matric)) || matric },
      { label: "Matric", value: matric },
    ],
  });
  if (!ok) {
    if (el.repSelect) el.repSelect.value = current;
    if (el.repSave) el.repSave.disabled = true;
    return;
  }
  try {
    await adviserApi("chooseRep", { matric });
    adviserMessage("ok", escapeHTML((picked && picked.name) || matric) + " is now the course rep for this level.");
    await loadAdviserRoster();
  } catch (err) {
    adviserMessage("err", escapeHTML(err.message));
    await loadAdviserRoster();
  }
}

async function clearChosenRep() {
  if (!adviserRoster || !adviserRoster.chosenRepMatric) return;
  const ok = await showConfirm({
    title: "Remove the course rep?",
    message: (adviserRoster.chosenRepName || adviserRoster.chosenRepMatric) +
      " will no longer be the rep and will go back to being a regular student. No one can run attendance for this level until you name a new rep.",
    okText: "Yes, remove the rep",
    cancelText: "Cancel",
    danger: true,
    icon: "⚠️",
  });
  if (!ok) return;
  try {
    await adviserApi("chooseRep", { clear: true });
    adviserMessage("ok", "The rep role has been removed. Choose a new rep when you are ready.");
    await loadAdviserRoster();
  } catch (err) {
    adviserMessage("err", escapeHTML(err.message));
  }
}

function initAdviserDashboard() {
  const el = adviserEls();
  if (!el.section || el.section.dataset.wired === "1") return;
  el.section.dataset.wired = "1";
  if (el.pick) el.pick.addEventListener("click", () => { if (el.file) el.file.click(); });
  if (el.file) {
    el.file.addEventListener("change", (e) => {
      handleRosterFileChosen(e.target.files && e.target.files[0]);
    });
  }
  if (el.confirm) el.confirm.addEventListener("click", confirmRosterImport);
  if (el.cancel) {
    el.cancel.addEventListener("click", () => {
      adviserPendingCsv = null;
      if (el.confirm) el.confirm.classList.add("hidden");
      el.cancel.classList.add("hidden");
      if (el.preview) el.preview.classList.add("hidden");
      if (el.msg) el.msg.classList.add("hidden");
      if (el.file) el.file.value = "";
    });
  }
  if (el.repSelect) {
    el.repSelect.addEventListener("change", () => {
      if (el.repSave) el.repSave.disabled = !el.repSelect.value;
    });
  }
  if (el.repSave) {
    el.repSave.addEventListener("click", () => {
      if (el.repSelect && el.repSelect.value) saveChosenRep(el.repSelect.value);
    });
  }
  if (el.repClear) el.repClear.addEventListener("click", clearChosenRep);
}

/** Show the dashboard only to a VERIFIED adviser, and only when signed in. */
function syncAdviserDashboard() {
  const el = adviserEls();
  if (!el.section) return;
  const show = Boolean(currentUser) && isVerifiedAdviser(currentUser);
  el.section.classList.toggle("hidden", !show);
  if (!show) return;
  if (el.scope) {
    el.scope.textContent = [currentUser.institution, currentUser.department, currentUser.level]
      .filter(Boolean)
      .join(" | ");
  }
  loadAdviserRoster();
}
  // 📋 SEMESTER ATTENDANCE REPORT (Phase 5).
  //
  // The maths lives in utils/report.js rather than inline here, because it is
  // the part that can be silently wrong: a percentage that quietly counts one
  // session twice still looks perfectly plausible in a table. It is unit-tested
  // there instead of eyeballed here.
  // Loaded by index.html as a classic script before app.js runs, because the
  // app imports Firebase from CDN URLs and so cannot use a bare-specifier
  // import for a local module. See utils/report.js for the dual export.
  const { buildSemesterReport, semesterCsv, semesterPrintHtml } = globalThis.VeriReport || {};
  let lastSemesterReport = null;

  function renderSemesterReport() {
    const section = document.getElementById("semesterReport");
    if (!section || !activeCourse) return;
    const rep = buildSemesterReport(
      activeCourse.attendanceHistory || [],
      activeCourse.members || [],
    );
    lastSemesterReport = rep;

    const sessionsEl = document.getElementById("reportSessions");
    const studentsEl = document.getElementById("reportStudents");
    const avgEl = document.getElementById("reportAverage");
    const body = document.getElementById("reportBody");
    const note = document.getElementById("reportNote");

    if (sessionsEl) sessionsEl.textContent = String(rep.sessions);
    if (studentsEl) studentsEl.textContent = String(rep.rows.length);
    if (avgEl) {
      const withClasses = rep.rows.filter((r) => r.total > 0);
      const avg = withClasses.length
        ? Math.round(withClasses.reduce((s2, r) => s2 + r.percent, 0) / withClasses.length)
        : 0;
      avgEl.textContent = avg + "%";
    }

    if (body) {
      if (!rep.rows.length) {
        body.innerHTML =
          '<tr><td colspan="4" style="color:var(--text-muted);">No students enrolled yet.</td></tr>';
      } else {
        body.innerHTML = rep.rows
          .map(
            (r) =>
              "<tr><td>" + escapeHTML(r.name) + "</td>" +
              '<td class="num">' + escapeHTML(r.matric) + "</td>" +
              '<td class="num">' + r.attended + "/" + r.total + "</td>" +
              '<td class="num"><strong>' + r.percent + "%</strong></td></tr>",
          )
          .join("");
      }
    }
    if (note) {
      note.textContent = rep.sessions
        ? "A class counts as attended when the student's matric was recorded present for it."
        : "No classes have been held yet. The report fills in as you run them.";
    }
  }

  function downloadTextFile(filename, text, mime) {
    const blob = new Blob([text], { type: mime || "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Release the blob so a long session does not leak memory.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function reportFileBase() {
    const code = (activeCourse && activeCourse.code ? activeCourse.code : "course").replace(
      /[^A-Za-z0-9]+/g,
      "_",
    );
    return code + "_Attendance_Report";
  }

  function initSemesterReport() {
    const csvBtn = document.getElementById("reportCsvBtn");
    const pdfBtn = document.getElementById("reportPdfBtn");
    if (csvBtn) {
      csvBtn.addEventListener("click", () => {
        if (!lastSemesterReport || !lastSemesterReport.sessions) {
          toast.warning("Run at least one class before downloading a report.");
          return;
        }
        downloadTextFile(
          reportFileBase() + ".csv",
          semesterCsv(lastSemesterReport),
          "text/csv;charset=utf-8",
        );
        toast.success("Report downloaded as CSV. Open it in Excel or Google Sheets.");
      });
    }
    if (pdfBtn) {
      pdfBtn.addEventListener("click", () => {
        if (!lastSemesterReport || !lastSemesterReport.sessions) {
          toast.warning("Run at least one class before downloading a report.");
          return;
        }
        // "PDF" via the browser's own print dialog: no dependency, selectable
        // text, and it renders correctly on a phone as well as a laptop.
        const win = window.open("", "_blank");
        if (!win) {
          toast.warning("Allow pop-ups for this site to save a PDF, or use Download CSV instead.");
          return;
        }
        win.document.write(semesterPrintHtml(lastSemesterReport, activeCourse || {}));
        win.document.close();
        setTimeout(() => {
          try {
            win.focus();
            win.print();
          } catch (_) {}
        }, 350);
      });
    }
  }

  // 📋 The report is a staff-only view: it lists every student's percentage,
  // which is exactly the sort of thing a student must not be able to read from
  // the client. The data is already gated by the rules, but hiding the panel
  // too means a student never sees a control they cannot use.
  function syncSemesterReportPanel() {
    const panel = document.getElementById("semesterReport");
    if (!panel) return;
    const isStaff = Boolean(
      activeCourse &&
        currentUser &&
        (activeCourse.repUid === currentUser.uid ||
          (activeCourse.members || []).some(
            (m) =>
              m.uid === currentUser.uid &&
              (m.role === "assistant" || m.role === "session_assistant"),
          )),
    );
    panel.classList.toggle("hidden", !isStaff);
    if (isStaff) renderSemesterReport();
  }
