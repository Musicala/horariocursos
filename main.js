// main.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala (Static / GitHub Pages friendly)
// Split PRO (balanced): main.js + horarios.core.js
// - main.js: CONFIG + DOM + UTILS + AUTH/ADMIN + URL + EVENTS + INIT
// - core: Firestore + hydration + filters + views + renders + analytics + modal + CRUD + (Export/Import JSON)
// ------------------------------------------------------------

'use strict';

// ✅ Estructura en RAÍZ (no /src)
import { auth, provider, db } from "./firebase.js";

// Firebase Auth (CDN)
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

// Firestore (CDN)
import {
  collection,
  onSnapshot,
  query,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc // ✅ necesario para importar JSON con IDs fijos (upsert)
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { initCore } from "./horarios.core.js";

/* =========================
   CONFIG
========================= */
const DEBUG = false; // true = logs de diagnóstico

const ADMIN_EMAILS = new Set([
  "musicalaasesor@gmail.com",
  "imusicala@gmail.com",
  "alekcaballeromusic@gmail.com",
  "catalina.medina.leal@gmail.com",
]);

const GROUPS_COLLECTION = "groups";
const ADMIN_KEY = "musicala_admin";

const DAYS = ["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"];

const ROOMS = [
  { key:"Salón 1",  short:"S1",  label:"Salón 1",  note:"Danzas/Teatro" },
  { key:"Salón 2",  short:"S2",  label:"Salón 2",  note:"Artes" },
  { key:"Salón 3",  short:"S3",  label:"Salón 3",  note:"Auditorio" },
  { key:"Salón 4",  short:"S4",  label:"Salón 4",  note:"Música (cuerdas)" },
  { key:"Salón 5",  short:"S5",  label:"Salón 5",  note:"Música (guitarra)" },
  { key:"Salón 6",  short:"S6",  label:"Salón 6",  note:"Artes" },
  { key:"Salón 7",  short:"S7",  label:"Salón 7",  note:"Chiquis/estimulación" },
  { key:"Salón 8",  short:"S8",  label:"Salón 8",  note:"Piano prioridad" },
  { key:"Salón 9",  short:"S9",  label:"Salón 9",  note:"Danzas/Teatro" },
  { key:"Salón 10", short:"S10", label:"Salón 10", note:"Batería/ensamble" },
];

// Hora pico
const PEAK_HOURS = new Set(["16:00","17:00","18:00","19:00"]);

// Base slots (si no hay sesiones aún, igual se ve el tablero)
const BASE_SLOTS = ["08:00","09:00","10:00","11:00","12:00","13:00","14:00","15:00","16:00","17:00","18:00","19:00"];

// Persistencias UI
const LS_VIEW = "musicala_view";             // "grid"|"list"|"dashboard"|"occupancy"|"conflicts"|"proposals"
const LS_COLOR_MODE = "musicala_color_mode"; // "area" | "age"
const LS_HELPERS = "musicala_helpers";       // "1" (on) | "0" (off)
const LS_ANA_TAB = "musicala_ana_tab";       // "dashboard"|"edad"|"salon"|"area"|"franja"

// Debug helpers
const DBG = {
  once: new Set(),
  log(...a){ if (DEBUG) console.log("[Horarios]", ...a); },
  onceLog(key, ...a){
    if (!DEBUG) return;
    if (this.once.has(key)) return;
    this.once.add(key);
    console.log("[Horarios]", ...a);
  }
};

/* =========================
   DOM
========================= */
const $ = (sel) => document.querySelector(sel);

const els = {
  btnLogin: $("#btn-login"),
  btnLogout: $("#btn-logout"),

  search: $("#search"),
  fClase: $("#filter-clase"),
  fEdad: $("#filter-edad"),
  fDia: $("#filter-dia"),

  info: $("#results-info"),
  btnNew: $("#btn-new-group"),

  dayTabs: $("#day-tabs"),
  grid: $("#schedule-grid"),

  // Views buttons (toolbar)
  btnViewGrid: $("#btn-view-grid"),
  btnViewList: $("#btn-view-list"),
  btnViewDashboard: $("#btn-view-dashboard"),
  btnViewOccupancy: $("#btn-view-occupancy"),
  btnViewConflicts: $("#btn-view-conflicts"),
  btnViewProposals: $("#btn-view-proposals"),

  // ✅ Export/Import JSON
  btnExportJson: $("#btn-export-json"),
  btnImportJson: $("#btn-import-json"),
  fileImportJson: $("#file-import-json"),

  // Wraps
  gridWrap: $("#grid-wrap"),
  listWrap: $("#schedule-list-wrap"),
  list: $("#schedule-list"),
  quickStatsWrap: $("#quick-stats-wrap"),
  daybarWrap: $("#daybar-wrap"),
  ageLegendWrap: $("#age-legend-wrap"),
  analyticsWrap: $("#analytics-wrap"),

  // Stats
  statTotalGroups: $("#stat-total-groups"),
  statTotalSessions: $("#stat-total-sessions"),
  statTotalRooms: $("#stat-total-rooms"),
  statsByArea: $("#stats-by-area"),
  statsByAge: $("#stats-by-age"),
  statsAlerts: $("#stats-alerts"),
  statsSubtitle: $("#stats-subtitle"),

  // Color/Helpers
  colorByArea: $("#color-by-area"),
  colorByAge: $("#color-by-age"),
  btnToggleHelpers: $("#btn-toggle-helpers"),

  // Analytics UI
  analyticsTitle: $("#analytics-title"),
  analyticsSubtitle: $("#analytics-subtitle"),

  tabAnaDashboard: $("#tab-ana-dashboard"),
  tabAnaEdad: $("#tab-ana-edad"),
  tabAnaSalon: $("#tab-ana-salon"),
  tabAnaArea: $("#tab-ana-area"),
  tabAnaFranja: $("#tab-ana-franja"),

  kpiGroups: $("#kpi-groups"),
  kpiGroupsSub: $("#kpi-groups-sub"),
  kpiSessions: $("#kpi-sessions"),
  kpiSessionsSub: $("#kpi-sessions-sub"),
  kpiOccupancy: $("#kpi-occupancy"),
  kpiOccupancySub: $("#kpi-occupancy-sub"),
  kpiCollisions: $("#kpi-collisions"),
  kpiCollisionsSub: $("#kpi-collisions-sub"),

  anaTopTitle: $("#ana-render-top-title"),
  anaTopContent: $("#ana-top-content"),
  anaBottomTitle: $("#ana-render-bottom-title"),
  anaBottomContent: $("#ana-bottom-content"),
  anaAlertsContent: $("#ana-alerts-content"),

  // Modal
  modal: $("#modal"),
  modalTitle: $("#modal-title"),
  modalClose: $("#modal-close"),

  mClase: $("#m-clase"),
  mEdad: $("#m-edad"),
  mEnfoque: $("#m-enfoque"),
  mNivel: $("#m-nivel"),
  mCupoMax: $("#m-cupo-max"),
  mCupoOcu: $("#m-cupo-ocupado"),
  mActivo: $("#m-activo"),

  sessionsList: $("#sessions-list"),
  btnAddSession: $("#btn-add-session"),

  btnDelete: $("#btn-delete"),
  btnSave: $("#btn-save"),

  toast: $("#toast"),
};

function assertDOM(){
  const must = ["results-info","day-tabs","schedule-grid","search","filter-clase","filter-edad","filter-dia"];
  const missing = must.filter(id => !document.getElementById(id));
  if (missing.length){
    console.warn("[DOM] Faltan elementos:", missing);
  }
}
assertDOM();

/* =========================
   STATE (shared via ctx)
========================= */
const state = {
  currentUser: null,
  isAllowlistedAdmin: false,
  adminUIEnabled: false,

  allGroups: [],
  filteredGroups: [],

  activeDay: getTodayName(),
  unsubscribeGroups: null,

  editingId: null,
  editingDraft: null,

  activeView: "grid",          // "grid"|"list"|"dashboard"|"occupancy"|"conflicts"|"proposals"
  colorMode: "area",           // "area" | "age"
  helpersOn: true,

  activeAnaTab: "dashboard",   // "dashboard"|"edad"|"salon"|"area"|"franja"

  _lastFocus: null,
};

/* =========================
   TOAST
========================= */
function toast(msg){
  if (!els.toast) { alert(msg); return; }
  els.toast.textContent = msg;
  els.toast.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

if (location.protocol === "file:") {
  toast("Esto no funciona bien en file://. Usa Live Server o GitHub Pages.");
}

/* =========================
   UTILS
========================= */
function keyify(v){
  return (v ?? "")
    .toString()
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quita tildes
    .replace(/\s+/g, " ");
}
function normalize(s){ return keyify(s); }

function htmlEscape(str){
  return (str ?? "").toString()
    .replaceAll("&","&amp;")
    .replaceAll("<","&lt;")
    .replaceAll(">","&gt;")
    .replaceAll('"',"&quot;")
    .replaceAll("'","&#039;");
}

function isAdminFlagOn(){
  const qsAdmin = new URLSearchParams(location.search).get("admin");
  if (qsAdmin === "1") return true;
  return localStorage.getItem(ADMIN_KEY) === "1";
}

function setInfo(msg){
  if (!els.info) return;
  els.info.textContent = msg;
}

function clampInt(v, min=0){
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.trunc(n));
}

function debounce(fn, ms=140){
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function normalizeHHMM(hhmm){
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm ?? "").trim());
  if (!m) return "";
  const h = String(clampInt(m[1], 0)).padStart(2, "0");
  const mm = String(clampInt(m[2], 0)).padStart(2, "0");
  return `${h}:${mm}`;
}

function safeTimeToMinutes(hhmm){
  const t = normalizeHHMM(hhmm);
  if (!t) return 9999;
  const [h, m] = t.split(":").map(Number);
  return h*60 + m;
}

function compareSessions(a, b){
  const da = DAYS.indexOf(a?.day ?? "");
  const db = DAYS.indexOf(b?.day ?? "");
  if (da !== db) return da - db;
  return safeTimeToMinutes(a?.time) - safeTimeToMinutes(b?.time);
}

function getTodayName(){
  const d = new Date().getDay(); // 0=Domingo ... 6=Sábado
  const map = ["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
  return map[d] || "Lunes";
}

function nextDay(day, dir=1){
  const i = DAYS.indexOf(day);
  if (i < 0) return "Lunes";
  return DAYS[(i + dir + DAYS.length) % DAYS.length];
}

function percent(n){
  if (!Number.isFinite(n)) return "0%";
  return `${Math.round(n*100)}%`;
}

/* =========================
   DAY/ROOM CANON
========================= */
const DAY_CANON = new Map(DAYS.map(d => [keyify(d), d]));
DAY_CANON.set("sabado", "Sábado");
DAY_CANON.set("miercoles", "Miércoles");

const ROOM_CANON = new Map(ROOMS.map(r => [keyify(r.key), r.key]));
for (const r of ROOMS){
  ROOM_CANON.set(keyify(r.short), r.key);
  ROOM_CANON.set(keyify(r.label), r.key);
  ROOM_CANON.set(keyify(r.key.replace("Salón","Salon")), r.key);
  ROOM_CANON.set(keyify(r.label.replace("Salón","Salon")), r.key);
}

function canonDay(v){
  const k = keyify(v);
  return DAY_CANON.get(k) || (v ?? "").toString().trim();
}
function canonRoom(v){
  const k = keyify(v);
  return ROOM_CANON.get(k) || (v ?? "").toString().trim();
}

/* =========================
   URL STATE (filters)
========================= */
function readFiltersFromURL(){
  const p = new URLSearchParams(location.search);

  const q = (p.get("q") ?? "").trim();
  const clase = (p.get("clase") ?? "").trim();
  const edad = (p.get("edad") ?? "").trim();
  const dia = (p.get("dia") ?? "").trim();

  if (dia){
    const dCanon = canonDay(dia);
    if (DAYS.includes(dCanon)) state.activeDay = dCanon;
  }

  if (els.search && q) els.search.value = q;
  if (els.fClase && clase) els.fClase.value = clase;
  if (els.fEdad && edad) els.fEdad.value = edad;
  if (els.fDia) els.fDia.value = canonDay(dia) || "";
}

function writeFiltersToURL(){
  const p = new URLSearchParams(location.search);

  const q = (els.search?.value ?? "").trim();
  const clase = (els.fClase?.value ?? "").trim();
  const edad = (els.fEdad?.value ?? "").trim();
  const dia = (els.fDia?.value ?? "").trim();

  if (q) p.set("q", q); else p.delete("q");
  if (clase) p.set("clase", clase); else p.delete("clase");
  if (edad) p.set("edad", edad); else p.delete("edad");
  if (dia) p.set("dia", dia); else p.delete("dia");

  const qs = p.toString();
  const newUrl = qs ? `${location.pathname}?${qs}` : `${location.pathname}`;
  history.replaceState(null, "", newUrl);
}

/* =========================
   AUTH / ADMIN
========================= */
async function login(){
  try{
    try { provider.setCustomParameters({ prompt: "select_account" }); } catch(_) {}

    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    if (isMobile){
      await signInWithRedirect(auth, provider);
      return;
    }
    await signInWithPopup(auth, provider);
  }catch(err){
    console.error(err);
    const code = err?.code || "";
    if (code.includes("popup-blocked")) toast("Popup bloqueado. Habilita popups para este sitio.");
    else if (code.includes("popup-closed-by-user")) toast("Cerraste el popup. Intenta otra vez.");
    else toast("No se pudo iniciar sesión. Revisa popups/permisos.");
  }
}

async function logout(){
  try{
    await signOut(auth);
  }catch(err){
    console.error(err);
    toast("No se pudo cerrar sesión.");
  }
}

function normalizeEmail(email){
  return (email ?? "")
    .toString()
    .normalize("NFKC")
    .trim()
    .toLowerCase();
}

function computeAllowlist(user){
  if (!user?.email) return false;
  const email = normalizeEmail(user.email);
  if (DEBUG){
    console.log("📌 ADMIN LIST:", Array.from(ADMIN_EMAILS));
    console.log("🔎 Checking email:", JSON.stringify(email));
  }
  return ADMIN_EMAILS.has(email);
}

function canEdit(){
  // Gate de UX. La seguridad real es Firestore Rules.
  return !!state.currentUser && state.adminUIEnabled && state.isAllowlistedAdmin;
}

function refreshAdminUI(){
  state.adminUIEnabled = isAdminFlagOn();
  const can = canEdit();

  els.btnLogin?.classList.toggle("hidden", !!state.currentUser);
  els.btnLogout?.classList.toggle("hidden", !state.currentUser);
  els.btnNew?.classList.toggle("hidden", !can);
  els.btnDelete?.classList.toggle("hidden", !can);

  // ✅ Export/Import JSON solo para editores (si en HTML ya vienen hidden, igual esto los controla)
  els.btnExportJson?.classList.toggle("hidden", !can);
  els.btnImportJson?.classList.toggle("hidden", !can);

  // Conflictos/Propuestas solo para editores (en tu HTML ya vienen hidden)
  els.btnViewConflicts?.classList.toggle("hidden", !can);
  els.btnViewProposals?.classList.toggle("hidden", !can);

  if (els.info){
    const email = state.currentUser?.email ? normalizeEmail(state.currentUser.email) : "";
    const a = state.adminUIEnabled ? "adminON" : "adminOFF";
    const e = email ? `· ${email}` : "· sin sesión";
    const p = state.isAllowlistedAdmin ? "· editor ✅" : (email ? "· solo lectura 👀" : "");
    els.info.title = `Estado: ${a} ${e} ${p}`;
  }

  if (state.adminUIEnabled && state.currentUser && !state.isAllowlistedAdmin){
    toast("Modo admin ON, pero este correo no está en allowlist 👀");
  }
}

async function initRedirectResult(){
  try{
    const res = await getRedirectResult(auth);
    if (res?.user) toast("Sesión iniciada ✅");
  }catch(err){
    if (err?.code) console.warn("redirectResult:", err.code);
  }
}

function explainNoPerm(action){
  const email = state.currentUser?.email ? normalizeEmail(state.currentUser.email) : "";

  if (!state.currentUser){
    toast(`No se puede ${action}: no has iniciado sesión.`);
    return;
  }
  if (!state.adminUIEnabled){
    toast(`No se puede ${action}: falta activar admin (?admin=1 o localStorage musicala_admin=1).`);
    return;
  }
  if (!state.isAllowlistedAdmin){
    toast(`No se puede ${action}: ${email || "tu correo"} no está en allowlist.`);
    return;
  }
  toast(`No se puede ${action}: algo raro con Auth/Rules (mira consola).`);
}

function explainFirestoreErr(err){
  const code = err?.code || "";
  if (code.includes("permission-denied")){
    toast("Firestore dijo NO: permission-denied. Rules no te dejan escribir.");
    return;
  }
  if (code.includes("unauthenticated")){
    toast("Firestore dice unauthenticated. No hay sesión real.");
    return;
  }
  toast("No se pudo guardar. Revisa consola (err).");
}

/* =========================
   CTX (shared with core)
========================= */
const ctx = {
  DEBUG,
  DBG,

  // firebase handles
  auth, provider, db,
  fs: { collection, onSnapshot, query, addDoc, updateDoc, deleteDoc, doc, serverTimestamp, setDoc }, // ✅ setDoc

  // config
  GROUPS_COLLECTION,
  ADMIN_KEY,
  DAYS, ROOMS,
  PEAK_HOURS, BASE_SLOTS,
  LS_VIEW, LS_COLOR_MODE, LS_HELPERS, LS_ANA_TAB,

  // DOM + state
  els,
  state,

  // utilities
  utils: {
    keyify, normalize, htmlEscape,
    clampInt, debounce,
    normalizeHHMM, safeTimeToMinutes, compareSessions,
    canonDay, canonRoom,
    nextDay, percent,
    setInfo, readFiltersFromURL, writeFiltersToURL,
  },

  // UX helpers
  toast,

  // permissions
  perms: { canEdit, refreshAdminUI, explainNoPerm, explainFirestoreErr, normalizeEmail },
};

/* =========================
   CORE INIT (returns API)
========================= */
const api = initCore(ctx);

/* =========================
   EVENTS
========================= */
function wireEvents(){
  els.btnLogin?.addEventListener("click", login);
  els.btnLogout?.addEventListener("click", logout);

  const onFilterChanged = () => {
    ctx.utils.writeFiltersToURL();
    api.applyFiltersAndRender();
  };

  const onSearch = ctx.utils.debounce(() => {
    ctx.utils.writeFiltersToURL();
    api.applyFiltersAndRender();
  }, 140);

  els.search?.addEventListener("input", onSearch);
  els.search?.addEventListener("change", () => ctx.utils.writeFiltersToURL());

  els.fClase?.addEventListener("change", onFilterChanged);
  els.fEdad?.addEventListener("change", onFilterChanged);

  els.fDia?.addEventListener("change", () => {
    const d = canonDay(els.fDia.value || "");
    if (d && DAYS.includes(d)) api.syncDayUI(d, { fromSelect:true });
    else onFilterChanged();
  });

  els.btnNew?.addEventListener("click", () => {
    if (!canEdit()) { explainNoPerm("crear"); return; }
    api.openModalNew();
  });

  // ✅ Export/Import JSON
  els.btnExportJson?.addEventListener("click", async () => {
    if (!canEdit()) { explainNoPerm("exportar"); return; }
    if (typeof api.exportJSON !== "function"){
      toast("exportJSON() no está en core. Revisa horarios.core.js.");
      return;
    }
    await api.exportJSON();
  });

  els.btnImportJson?.addEventListener("click", () => {
    if (!canEdit()) { explainNoPerm("importar"); return; }
    if (!els.fileImportJson){
      toast("No encuentro #file-import-json en el DOM.");
      return;
    }
    els.fileImportJson.click();
  });

  els.fileImportJson?.addEventListener("change", async (e) => {
    if (!canEdit()) { explainNoPerm("importar"); return; }
    const file = e.target?.files?.[0];
    if (!file) return;

    if (typeof api.importJSONFile !== "function"){
      toast("importJSONFile() no está en core. Revisa horarios.core.js.");
      e.target.value = "";
      return;
    }

    await api.importJSONFile(file);
    e.target.value = ""; // permite reimportar el mismo archivo si toca
  });

  els.modalClose?.addEventListener("click", api.closeModal);
  els.modal?.addEventListener("click", (e) => { if (e.target === els.modal) api.closeModal(); });

  window.addEventListener("keydown", (e) => {
    const modalOpen = !els.modal?.classList.contains("hidden");

    if (e.key === "Escape" && modalOpen) api.closeModal();

    if (modalOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){
      e.preventDefault();
      api.saveGroup();
    }

    if (document.activeElement?.closest?.("#day-tabs")){
      if (e.key === "ArrowRight"){
        e.preventDefault();
        api.syncDayUI(nextDay(state.activeDay, +1));
      } else if (e.key === "ArrowLeft"){
        e.preventDefault();
        api.syncDayUI(nextDay(state.activeDay, -1));
      }
    }
  });

  els.btnAddSession?.addEventListener("click", api.addSession);
  els.btnSave?.addEventListener("click", api.saveGroup);
  els.btnDelete?.addEventListener("click", api.deleteGroup);

  // Views
  els.btnViewGrid?.addEventListener("click", () => api.setView("grid"));
  els.btnViewList?.addEventListener("click", () => api.setView("list"));
  els.btnViewDashboard?.addEventListener("click", () => api.setView("dashboard"));
  els.btnViewOccupancy?.addEventListener("click", () => api.setView("occupancy"));
  els.btnViewConflicts?.addEventListener("click", () => api.setView("conflicts"));
  els.btnViewProposals?.addEventListener("click", () => api.setView("proposals"));

  // Analytics tabs
  const bindAna = (btn, tab) => {
    btn?.addEventListener("click", () => {
      api.applyAnalyticsTabUI(tab);
      if (state.activeView === "dashboard" || state.activeView === "occupancy") api.renderAnalytics(state.activeView);
    });
  };
  bindAna(els.tabAnaDashboard, "dashboard");
  bindAna(els.tabAnaEdad, "edad");
  bindAna(els.tabAnaSalon, "salon");
  bindAna(els.tabAnaArea, "area");
  bindAna(els.tabAnaFranja, "franja");

  // Color mode
  els.colorByArea?.addEventListener("change", () => {
    state.colorMode = "area";
    api.applyColorModeUI();
    if (state.activeView === "grid") api.renderGrid();
    else if (state.activeView === "list") api.renderList();
  });
  els.colorByAge?.addEventListener("change", () => {
    state.colorMode = "age";
    api.applyColorModeUI();
    if (state.activeView === "grid") api.renderGrid();
    else if (state.activeView === "list") api.renderList();
  });

  // Helpers toggle
  els.btnToggleHelpers?.addEventListener("click", () => {
    state.helpersOn = !state.helpersOn;
    api.applyHelpersUI();
    if (state.activeView === "grid") api.renderGrid();
    else if (state.activeView === "list") api.renderList();
  });
}

/* =========================
   INIT
========================= */
async function init(){
  api.initViewFromStorage();
  ctx.utils.readFiltersFromURL();
  api.initUIModes();

  if (els.fDia && DAYS.includes(state.activeDay)) els.fDia.value = state.activeDay;

  wireEvents();
  api.renderDayTabs();

  await initRedirectResult();

  onAuthStateChanged(auth, (user) => {
    state.currentUser = user || null;
    state.adminUIEnabled = isAdminFlagOn();
    state.isAllowlistedAdmin = computeAllowlist(user);

    if (DEBUG){
      console.log("[AUTH] user:", user);
      console.log("[AUTH] email:", user?.email);
      console.log("[AUTH] adminFlag:", state.adminUIEnabled);
      console.log("[AUTH] allowlist:", state.isAllowlistedAdmin);
    } else {
      DBG.onceLog("authState",
        "[AUTH]",
        "email:", user?.email,
        "adminFlag:", state.adminUIEnabled,
        "allowlist:", state.isAllowlistedAdmin
      );
    }

    refreshAdminUI();
    api.subscribeGroupsOnce();
  });

  // fallback
  setTimeout(() => {
    if (!state.unsubscribeGroups) api.subscribeGroupsOnce();
  }, 900);

  // view initial
  setTimeout(() => api.setView(state.activeView), 0);

  // URL coherente desde arranque
  ctx.utils.writeFiltersToURL();
}

init();
