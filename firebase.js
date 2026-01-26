// firebase.js
// ------------------------------------------------------------
// Firebase bootstrap (Static: GitHub Pages / Live Server)
// ✅ Sin Vite, sin npm, sin Node.
// - Inicializa app (idempotente)
// - Exporta app + auth + provider + db
// - Persistencia robusta (local → session → inMemory)
// - Firestore robusto (opcional long polling + auto fallback)
// - Helpers mínimos para debug y diagnóstico
// ------------------------------------------------------------

'use strict';

/* =========================
   FLAGS
========================= */
const DEBUG = false;

// Si Firestore se queda colgado en algunas redes/PCs, pon esto en true.
// (Útil en redes corporativas, proxies raros, etc.)
const FORCE_LONG_POLLING = false;

// Si quieres forzar fallback automático a long polling cuando falle,
// déjalo en true. (No rompe nada; solo reintenta con otra config.)
const AUTO_FALLBACK_LONG_POLLING = true;

/* =========================
   IMPORTS (CDN)
========================= */
import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   CONFIG
========================= */
export const firebaseConfig = {
  apiKey: "AIzaSyAqz1wOHtVR1knXK1p5I86hLOkQmeN1UTk",
  authDomain: "horarios-grupales.firebaseapp.com",
  projectId: "horarios-grupales",

  // Bucket “clásico” estable (si algún día usas Storage)
  storageBucket: "horarios-grupales.appspot.com",

  messagingSenderId: "437683812150",
  appId: "1:437683812150:web:74dca5aeae7272947da597",
};

/* =========================
   LOG + ASSERT
========================= */
function log(...args){
  if (DEBUG) console.log("[Firebase]", ...args);
}

function assertConfig(cfg){
  const required = ["apiKey", "authDomain", "projectId", "appId"];
  const missing = required.filter(k => !cfg?.[k]);
  if (missing.length){
    console.error("[Firebase] Config incompleta, faltan:", missing);
    throw new Error("Firebase config incompleta.");
  }
}
assertConfig(firebaseConfig);

/* =========================
   INIT APP (IDEMPOTENTE)
========================= */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
log("App:", app?.name);

/* =========================
   AUTH + PROVIDER
========================= */
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// UX: siempre deja escoger cuenta (evita “se metió con otra”)
provider.setCustomParameters({ prompt: "select_account" });

async function initAuthPersistence(){
  // Orden sensato: local → session → inMemory (último recurso)
  try{
    await setPersistence(auth, browserLocalPersistence);
    log("Auth persistence: local");
    return "local";
  }catch(_){
    // Algunos navegadores / contextos bloquean localStorage
  }

  try{
    await setPersistence(auth, browserSessionPersistence);
    log("Auth persistence: session");
    return "session";
  }catch(_){
    // Incógnito extremo / políticas raras
  }

  try{
    await setPersistence(auth, inMemoryPersistence);
    log("Auth persistence: memory");
    return "memory";
  }catch(err){
    console.warn("[Firebase] No se pudo fijar persistence:", err?.code || err);
    return "none";
  }
}

// Inicia sin bloquear el resto del app
initAuthPersistence();

/* =========================
   FIRESTORE (ROBUSTO)
========================= */
function createFirestore({ longPolling = false } = {}){
  // Nota: experimentalForceLongPolling ayuda en redes problemáticas.
  // (El SDK lo soporta; el nombre es feo pero funciona.)
  return longPolling
    ? getFirestore(app, { experimentalForceLongPolling: true })
    : getFirestore(app);
}

export let db = createFirestore({ longPolling: FORCE_LONG_POLLING });
log("Firestore listo (longPolling:", FORCE_LONG_POLLING, ")");

/**
 * Si tu app detecta que Firestore “se queda pegado”,
 * puedes llamar esto para re-instanciar con long polling.
 * (Úsalo en un catch de lecturas/escrituras si quieres.)
 */
export function enableLongPolling(){
  db = createFirestore({ longPolling: true });
  log("Firestore re-init con long polling ✅");
  return db;
}

/**
 * Helper opcional: intenta una operación y si falla por red rara,
 * reintenta con long polling (una sola vez).
 *
 * Uso:
 *   await withFirestoreFallback(() => getDocs(q));
 *   await withFirestoreFallback(() => addDoc(colRef, data));
 */
export async function withFirestoreFallback(fn){
  try{
    return await fn();
  }catch(err){
    if (!AUTO_FALLBACK_LONG_POLLING) throw err;

    // Heurística: errores típicos de transporte / red / WebChannel
    const code = (err?.code || "").toString();
    const msg  = (err?.message || "").toString().toLowerCase();

    const looksNetworky =
      code.includes("unavailable") ||
      code.includes("deadline") ||
      msg.includes("transport") ||
      msg.includes("webchannel") ||
      msg.includes("network") ||
      msg.includes("offline");

    if (!looksNetworky) throw err;

    console.warn("[Firebase] Reintentando con long polling…", err?.code || err);
    enableLongPolling();

    // Reintenta una vez
    return await fn();
  }
}

/* =========================
   DIAGNÓSTICO (SUAVE)
========================= */
export function firebaseDiag(){
  // No pongas secretos acá. Esto es solo para debug.
  const info = {
    sdk: "firebasejs/10.12.5",
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    appName: app?.name || "(unknown)",
    longPolling: !!FORCE_LONG_POLLING,
  };
  log("Diag:", info);
  return info;
}
