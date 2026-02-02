// firebase.js
// ------------------------------------------------------------
// Firebase bootstrap (Static: GitHub Pages / Live Server)
// ✅ Sin Vite, sin npm, sin Node.
// - Inicializa app (idempotente)
// - Exporta app + auth + provider + db
// - Persistencia Auth robusta (local → session → memory)
// - Firestore robusto (auto-detect long polling + force por URL + fallback helper)
// - Helpers mínimos para debug/diagnóstico (sin filtrar secretos raros)
// ------------------------------------------------------------

'use strict';

/* =========================
   FLAGS (por URL)
   - ?debug=1  -> logs
   - ?lp=1     -> fuerza long polling (evita WebChannel drama)
   - ?nofb=1   -> desactiva auto-fallback long polling
   - ?emu=1    -> conecta emuladores (solo localhost)
========================= */
const URLX = new URL(location.href);
const DEBUG = URLX.searchParams.get('debug') === '1';

const FORCE_LONG_POLLING = URLX.searchParams.get('lp') === '1';
const AUTO_FALLBACK_LONG_POLLING = URLX.searchParams.get('nofb') === '1' ? false : true;
const USE_EMULATORS = URLX.searchParams.get('emu') === '1';

/* =========================
   IMPORTS (CDN)
========================= */
import { initializeApp, getApps, getApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  inMemoryPersistence,
  connectAuthEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';

import {
  getFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

/* =========================
   CONFIG
========================= */
export const firebaseConfig = {
  apiKey: 'AIzaSyAqz1wOHtVR1knXK1p5I86hLOkQmeN1UTk',
  authDomain: 'horarios-grupales.firebaseapp.com',
  projectId: 'horarios-grupales',
  storageBucket: 'horarios-grupales.appspot.com',
  messagingSenderId: '437683812150',
  appId: '1:437683812150:web:74dca5aeae7272947da597',
};

/* =========================
   LOG + ASSERT
========================= */
function log(...args) {
  if (DEBUG) console.log('[Firebase]', ...args);
}
function warn(...args) {
  console.warn('[Firebase]', ...args);
}

function assertConfig(cfg) {
  const required = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = required.filter((k) => !cfg?.[k]);
  if (missing.length) {
    console.error('[Firebase] Config incompleta, faltan:', missing);
    throw new Error('Firebase config incompleta.');
  }
}
assertConfig(firebaseConfig);

/* =========================
   INIT APP (IDEMPOTENTE)
========================= */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
log('App:', app?.name);

/* =========================
   AUTH + PROVIDER
========================= */
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();

// UX: siempre deja escoger cuenta (evita “se metió con otra”)
provider.setCustomParameters({ prompt: 'select_account' });

/**
 * Persistencia robusta:
 * - localStorage si se puede
 * - si no, sessionStorage
 * - si no, memoria (último recurso)
 */
export async function initAuthPersistence() {
  try {
    await setPersistence(auth, browserLocalPersistence);
    log('Auth persistence: local');
    return 'local';
  } catch (_) {}

  try {
    await setPersistence(auth, browserSessionPersistence);
    log('Auth persistence: session');
    return 'session';
  } catch (_) {}

  try {
    await setPersistence(auth, inMemoryPersistence);
    log('Auth persistence: memory');
    return 'memory';
  } catch (err) {
    warn('No se pudo fijar persistence:', err?.code || err);
    return 'none';
  }
}

// Inicia sin bloquear el resto del app
initAuthPersistence();

/* =========================
   FIRESTORE (ROBUSTO)
========================= */
/**
 * PUNTO CLAVE:
 * Firestore settings (long polling / auto-detect) SOLO se aplican en initializeFirestore
 * y solo se puede inicializar una vez por app. Entonces:
 * - Preferimos initializeFirestore con autoDetectLongPolling SIEMPRE (más estable en redes raras)
 * - Si lp=1 forzamos experimentalForceLongPolling
 * - Si ya estaba inicializado, caemos a getFirestore sin pelear.
 */
function createFirestoreInstance({ forceLongPolling = false } = {}) {
  const settings = {
    // Auto-detect suele arreglar el “Firestore dijo que no” en redes corporativas/ISP raros
    experimentalAutoDetectLongPolling: true,
    // Force solo si lo piden (lp=1) o si luego lo activamos por fallback
    experimentalForceLongPolling: !!forceLongPolling,
    // Opción útil pero a veces empeora: preferimos auto-detect
    // useFetchStreams: true,
  };

  try {
    const inst = initializeFirestore(app, settings);
    log('Firestore initializeFirestore OK', settings);
    return inst;
  } catch (err) {
    // Si ya existía una instancia, initializeFirestore tira. Normal.
    log('Firestore ya estaba inicializado, usando getFirestore()', err?.code || err);
    return getFirestore(app);
  }
}

export let db = createFirestoreInstance({ forceLongPolling: FORCE_LONG_POLLING });
log('Firestore listo (forceLongPolling:', FORCE_LONG_POLLING, ')');

/**
 * “Habilitar” long polling:
 * OJO: si Firestore ya fue inicializado sin force, no siempre puedes “cambiarlo”,
 * pero sí puedes reusar autoDetectLongPolling (que ya dejamos ON).
 * Aun así, intentamos initializeFirestore con force=true; si no se puede, no pasa nada.
 */
export function enableLongPolling() {
  db = createFirestoreInstance({ forceLongPolling: true });
  log('Firestore long polling intentado ✅');
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
export async function withFirestoreFallback(fn) {
  try {
    return await fn();
  } catch (err) {
    if (!AUTO_FALLBACK_LONG_POLLING) throw err;

    const code = (err?.code || '').toString();
    const msg = (err?.message || '').toString().toLowerCase();

    const looksNetworky =
      code.includes('unavailable') ||
      code.includes('deadline') ||
      code.includes('resource-exhausted') ||
      msg.includes('webchannel') ||
      msg.includes('transport') ||
      msg.includes('network') ||
      msg.includes('offline') ||
      msg.includes('failed to fetch') ||
      msg.includes('fetch') ||
      msg.includes('timeout');

    if (!looksNetworky) throw err;

    warn('Operación falló por red. Reintentando con long polling…', code || err);
    enableLongPolling();
    return await fn(); // reintenta 1 vez
  }
}

/* =========================
   EMULATORS (OPCIONAL)
========================= */
function maybeConnectEmulators() {
  const isLocal =
    location.hostname === 'localhost' ||
    location.hostname === '127.0.0.1';

  if (!USE_EMULATORS || !isLocal) return;

  try {
    connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
    log('Auth emulator conectado: 9099');

    connectFirestoreEmulator(db, 'localhost', 8080);
    log('Firestore emulator conectado: 8080');
  } catch (err) {
    warn('No pude conectar emuladores:', err?.code || err);
  }
}
maybeConnectEmulators();

/* =========================
   ERRORES LEGIBLES
========================= */
export function formatFirebaseErr(err) {
  const code = (err?.code || '').toString();
  const msg = (err?.message || '').toString();

  // Firestore
  if (code.includes('permission-denied')) {
    return 'permission-denied: Firestore bloqueó la operación (Rules/Auth).';
  }
  if (code.includes('unauthenticated')) {
    return 'unauthenticated: Firestore exige login para esta operación.';
  }
  if (code.includes('unavailable')) {
    return 'unavailable: Firestore no respondió (red / WebChannel). Prueba ?lp=1.';
  }

  // Auth
  if (code.includes('auth/invalid-credential')) {
    return 'Credenciales inválidas. Revisa email/contraseña.';
  }
  if (code.includes('auth/user-not-found')) {
    return 'Ese usuario no existe (user-not-found).';
  }
  if (code.includes('auth/wrong-password')) {
    return 'Contraseña incorrecta (wrong-password).';
  }
  if (code.includes('auth/too-many-requests')) {
    return 'Demasiados intentos. Espera un momento (too-many-requests).';
  }
  if (code.includes('auth/network-request-failed')) {
    return 'Falló la red en Auth (network-request-failed).';
  }

  return `${code || 'firebase-error'}${msg ? ' · ' + msg : ''}`.trim();
}

/* =========================
   DIAGNÓSTICO (SUAVE)
========================= */
export function firebaseDiag() {
  const info = {
    sdk: 'firebasejs/10.12.5',
    projectId: firebaseConfig.projectId,
    authDomain: firebaseConfig.authDomain,
    appName: app?.name || '(unknown)',
    // Nota: FORCE_LONG_POLLING es “lo pedido”; autoDetect puede activarse solo.
    forceLongPollingRequested: !!FORCE_LONG_POLLING,
    autoDetectLongPolling: true,
    autoFallbackLongPolling: !!AUTO_FALLBACK_LONG_POLLING,
    emulators: !!USE_EMULATORS,
    host: location.host,
    path: location.pathname,
  };
  log('Diag:', info);
  return info;
}

/* =========================
   DEBUG HOOK (OPCIONAL)
   - Útil cuando estás en modo debug para inspeccionar desde consola.
========================= */
if (DEBUG) {
  // No metas esto en UI ni lo loguees sin debug.
  window.__FB__ = {
    app,
    auth,
    provider,
    get db() { return db; },
    enableLongPolling,
    diag: firebaseDiag,
  };
  log('Debug hook: window.__FB__ listo');
}
