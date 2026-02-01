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
   FLAGS (por URL)
   - ?debug=1  -> logs
   - ?lp=1     -> fuerza long polling
   - ?nofb=1   -> desactiva auto-fallback long polling
   - ?emu=1    -> conecta emuladores (si existen)
========================= */
const URLX = new URL(location.href);
const DEBUG = URLX.searchParams.get("debug") === "1";

// Firestore long polling: útil si webchannel se pone exquisito en algunas redes
const FORCE_LONG_POLLING =
  URLX.searchParams.get("lp") === "1" ? true : false;

// Auto fallback: si una operación parece "de red", reinicia Firestore con long polling y reintenta 1 vez
const AUTO_FALLBACK_LONG_POLLING =
  URLX.searchParams.get("nofb") === "1" ? false : true;

// Emuladores (solo si estás en local y tienes emu corriendo)
const USE_EMULATORS = URLX.searchParams.get("emu") === "1";

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
  connectAuthEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

/* =========================
   CONFIG
========================= */
export const firebaseConfig = {
  apiKey: "AIzaSyAqz1wOHtVR1knXK1p5I86hLOkQmeN1UTk",
  authDomain: "horarios-grupales.firebaseapp.com",
  projectId: "horarios-grupales",
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

/**
 * Persistencia robusta:
 * - localStorage si se puede
 * - si no, sessionStorage
 * - si no, memoria (último recurso)
 */
export async function initAuthPersistence(){
  try{
    await setPersistence(auth, browserLocalPersistence);
    log("Auth persistence: local");
    return "local";
  }catch(_){}

  try{
    await setPersistence(auth, browserSessionPersistence);
    log("Auth persistence: session");
    return "session";
  }catch(_){}

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
/**
 * Importante:
 * - getFirestore(app) obtiene una instancia con settings por defecto.
 * - initializeFirestore(app, settings) permite forzar long polling.
 *
 * Nota: solo debes inicializar UNA vez por app. Por eso usamos un try/catch y fallback.
 */
function createFirestore({ longPolling=false } = {}){
  if (!longPolling){
    return getFirestore(app);
  }

  // Si ya existe una instancia inicializada, initializeFirestore puede lanzar.
  // En ese caso caemos a getFirestore.
  try{
    return initializeFirestore(app, {
      experimentalForceLongPolling: true,
      // experimentalAutoDetectLongPolling: true, // opcional; a veces ayuda, a veces estorba
    });
  }catch(err){
    // Si ya estaba inicializado, no peleamos: usamos la existente.
    log("initializeFirestore ya existía, usando getFirestore()", err?.code || err);
    return getFirestore(app);
  }
}

export let db = createFirestore({ longPolling: FORCE_LONG_POLLING });
log("Firestore listo (longPolling:", FORCE_LONG_POLLING, ")");

/**
 * Re-instancia (en la práctica: intenta inicializar con long polling; si ya hay instancia, reutiliza)
 */
export function enableLongPolling(){
  db = createFirestore({ longPolling: true });
  log("Firestore en modo long polling ✅");
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

    const code = (err?.code || "").toString();
    const msg  = (err?.message || "").toString().toLowerCase();

    // Heurística de "se cayó la tubería"
    const looksNetworky =
      code.includes("unavailable") ||
      code.includes("deadline") ||
      msg.includes("webchannel") ||
      msg.includes("transport") ||
      msg.includes("network") ||
      msg.includes("offline") ||
      msg.includes("failed to fetch");

    if (!looksNetworky) throw err;

    console.warn("[Firebase] Operación falló por red. Reintentando con long polling…", code || err);
    enableLongPolling();

    // Reintenta una vez
    return await fn();
  }
}

/* =========================
   EMULATORS (OPCIONAL)
========================= */
function maybeConnectEmulators(){
  // Solo tiene sentido en local
  const isLocal =
    location.hostname === "localhost" ||
    location.hostname === "127.0.0.1";

  if (!USE_EMULATORS || !isLocal) return;

  try{
    // Auth emulator
    connectAuthEmulator(auth, "http://localhost:9099", { disableWarnings: true });
    log("Auth emulator conectado: 9099");

    // Firestore emulator
    connectFirestoreEmulator(db, "localhost", 8080);
    log("Firestore emulator conectado: 8080");

  }catch(err){
    console.warn("[Firebase] No pude conectar emuladores:", err?.code || err);
  }
}
maybeConnectEmulators();

/* =========================
   ERRORES LEGIBLES
========================= */
export function formatFirebaseErr(err){
  const code = (err?.code || "").toString();
  const msg  = (err?.message || "").toString();

  if (code.includes("permission-denied")){
    return "permission-denied: Firestore bloqueó la operación (Rules/Auth).";
  }
  if (code.includes("unauthenticated")){
    return "unauthenticated: Firestore exige login para esta operación.";
  }
  if (code.includes("auth/invalid-credential")){
    return "Credenciales inválidas. Revisa email/contraseña.";
  }
  if (code.includes("auth/user-not-found")){
    return "Ese usuario no existe (user-not-found).";
  }
  if (code.includes("auth/wrong-password")){
    return "Contraseña incorrecta (wrong-password).";
  }
  if (code.includes("auth/too-many-requests")){
    return "Demasiados intentos. Espera un momento (too-many-requests).";
  }

  return `${code || "firebase-error"}${msg ? " · " + msg : ""}`.trim();
}

/* =========================
   DIAGNÓSTICO (SUAVE)
========================= */
export function firebaseDiag(){
  // No metas secretos. Esto es para debug, no para doxxear tu proyecto.
  const info = {
    sdk: "firebasejs/10.12.5",
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    appName: app?.name || "(unknown)",
    longPolling: !!FORCE_LONG_POLLING,
    autoFallbackLongPolling: !!AUTO_FALLBACK_LONG_POLLING,
    emulators: !!USE_EMULATORS,
  };
  log("Diag:", info);
  return info;
}
