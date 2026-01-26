// firebase.js
// ------------------------------------------------------------
// Firebase bootstrap (Static: GitHub Pages / Live Server)
// ✅ Sin Vite, sin npm, sin Node.
// - Inicializa app (idempotente)
// - Exporta auth + provider + db
// - Set persistence (si se puede)
// - Firestore robusto (opcional long polling)
// ------------------------------------------------------------

'use strict';

const DEBUG = false;

// Si Firestore se queda colgado en algunas redes/PCs, pon esto en true.
const FORCE_LONG_POLLING = false;

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   CONFIG
========================= */
export const firebaseConfig = {
  apiKey: "AIzaSyAqz1wOHtVR1knXK1p5I86hLOkQmeN1UTk",
  authDomain: "horarios-grupales.firebaseapp.com",
  projectId: "horarios-grupales",

  // ✅ bucket “clásico” estable (si algún día usas Storage)
  storageBucket: "horarios-grupales.appspot.com",

  messagingSenderId: "437683812150",
  appId: "1:437683812150:web:74dca5aeae7272947da597",
};

/* =========================
   GUARDS
========================= */
function log(...args){
  if (DEBUG) console.log("[Firebase]", ...args);
}

function assertConfig(cfg){
  const required = ["apiKey","authDomain","projectId","appId"];
  const missing = required.filter(k => !cfg?.[k]);
  if (missing.length){
    console.error("[Firebase] Config incompleta, faltan:", missing);
    throw new Error("Firebase config incompleta.");
  }
}
assertConfig(firebaseConfig);

/* =========================
   INIT (IDEMPOTENTE)
========================= */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
log("App:", app?.name);

/* =========================
   AUTH
========================= */
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// UX: siempre deja escoger cuenta (evita “se metió con otra”)
provider.setCustomParameters({ prompt: "select_account" });

// Persistencia: intenta localStorage; si falla, usa session
(async () => {
  try{
    await setPersistence(auth, browserLocalPersistence);
    log("Auth persistence: local");
  }catch(err){
    try{
      await setPersistence(auth, browserSessionPersistence);
      log("Auth persistence: session");
    }catch(e2){
      console.warn("[Firebase] No se pudo fijar persistence:", e2?.code || e2);
    }
  }
})();

/* =========================
   FIRESTORE
========================= */
export const db = FORCE_LONG_POLLING
  ? getFirestore(app, { experimentalForceLongPolling: true })
  : getFirestore(app);

log("Firestore listo");
