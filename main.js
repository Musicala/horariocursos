// main.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala (Static / GitHub Pages friendly)
// - Vista Día → Hora → Salón + Vista Lista
// - Admin UI: localStorage musicala_admin=1 o ?admin=1
// - Writes: allowlist UX (la seguridad REAL: Firestore Rules)
// - Canon de días/salones (tildes/alias) + crear con click en celda vacía
// - Tablero en UN SOLO grid (evita desalineaciones)
// - Colores por Área / por Edad (toggle) + helpers + estadísticas/alertas
// - ✅ Vistas extra: Dashboard / Ocupación / Conflictos / Propuestas (UI + render básico)
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
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
   STATE
========================= */
let currentUser = null;
let isAllowlistedAdmin = false;
let adminUIEnabled = false;

let allGroups = [];
let filteredGroups = [];

let activeDay = getTodayName();
let unsubscribeGroups = null;

let editingId = null;
let editingDraft = null;

let activeView = "grid";     // "grid"|"list"|"dashboard"|"occupancy"|"conflicts"|"proposals"

// UI mode
let colorMode = "area";      // "area" | "age"
let helpersOn = true;

// Analytics tab
let activeAnaTab = "dashboard"; // "dashboard"|"edad"|"salon"|"area"|"franja"

// Modal focus management
let _lastFocus = null;

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
    if (DAYS.includes(dCanon)) activeDay = dCanon;
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
  return !!currentUser && adminUIEnabled && isAllowlistedAdmin;
}

function refreshAdminUI(){
  adminUIEnabled = isAdminFlagOn();
  const can = canEdit();

  els.btnLogin?.classList.toggle("hidden", !!currentUser);
  els.btnLogout?.classList.toggle("hidden", !currentUser);
  els.btnNew?.classList.toggle("hidden", !can);
  els.btnDelete?.classList.toggle("hidden", !can);

  // Conflictos/Propuestas solo para editores (en tu HTML ya vienen hidden)
  els.btnViewConflicts?.classList.toggle("hidden", !can);
  els.btnViewProposals?.classList.toggle("hidden", !can);

  if (els.info){
    const email = currentUser?.email ? normalizeEmail(currentUser.email) : "";
    const a = adminUIEnabled ? "adminON" : "adminOFF";
    const e = email ? `· ${email}` : "· sin sesión";
    const p = isAllowlistedAdmin ? "· editor ✅" : (email ? "· solo lectura 👀" : "");
    els.info.title = `Estado: ${a} ${e} ${p}`;
  }

  if (adminUIEnabled && currentUser && !isAllowlistedAdmin){
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
  const email = currentUser?.email ? normalizeEmail(currentUser.email) : "";

  if (!currentUser){
    toast(`No se puede ${action}: no has iniciado sesión.`);
    return;
  }
  if (!adminUIEnabled){
    toast(`No se puede ${action}: falta activar admin (?admin=1 o localStorage musicala_admin=1).`);
    return;
  }
  if (!isAllowlistedAdmin){
    toast(`No se puede ${action}: ${email || "tu correo"} no está en allowlist.`);
    return;
  }
  toast(`No se puede ${action}: algo raro con Auth/Rules (mira consola).`);
}

/* =========================
   DATA HYDRATION (perf + consistencia)
========================= */
function toneClassForGroup(g){
  const c = (g?.clase ?? "").toLowerCase();
  if (c.includes("mú") || c.includes("mus")) return "music";
  if (c.includes("dan")) return "dance";
  if (c.includes("tea")) return "theater";
  if (c.includes("arte")) return "arts";
  return "music";
}

function ageKey(g){
  return (g?.edad ?? "").toString().trim();
}

function normalizeSessions(sessions){
  const arr = Array.isArray(sessions) ? sessions : [];
  return arr
    .map(s => ({
      day: canonDay((s?.day ?? "").trim()),
      time: normalizeHHMM(s?.time ?? ""),
      room: canonRoom((s?.room ?? "").trim()),
    }))
    .filter(s => s.day && s.time && s.room)
    .sort(compareSessions);
}

function hydrateGroup(raw){
  const g = { ...raw };

  g.clase = (g.clase ?? "").toString().trim();
  g.edad = (g.edad ?? "").toString().trim();
  g.enfoque = (g.enfoque ?? "").toString().trim();
  g.nivel = (g.nivel ?? "").toString().trim();

  g.__sessions = normalizeSessions(g.sessions);

  const ds = new Set();
  for (const s of g.__sessions) ds.add(s.day);
  g.__days = ds;

  g.__search = normalize([
    g.clase, g.edad, g.enfoque, g.nivel,
    (g.docente ?? ""), (g.salon ?? "")
  ].filter(Boolean).join(" "));

  g.__tone = toneClassForGroup(g);
  g.__ageKey = ageKey(g);

  // Cupos normalizados (acepta variantes de campos)
  g.__cupoMax = clampInt(g?.cupoMax ?? g?.cupo_max ?? 0, 0);
  g.__cupoOcu = clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);

  return g;
}

/* =========================
   FIRESTORE SUBSCRIPTION
========================= */
function subscribeGroupsOnce(){
  if (unsubscribeGroups){
    unsubscribeGroups();
    unsubscribeGroups = null;
  }

  setInfo("Cargando horarios…");

  try{
    const qy = query(collection(db, GROUPS_COLLECTION));

    unsubscribeGroups = onSnapshot(qy, (snap) => {
      const arr = [];
      snap.forEach(d => arr.push(hydrateGroup({ id: d.id, ...d.data() })));
      allGroups = arr;

      DBG.log("Firestore OK. Docs:", arr.length);

      fillFilterOptionsFromData(allGroups);
      applyFiltersAndRender();

      if (arr.length === 0){
        setInfo("No hay grupos en Firestore todavía (colección 'groups' vacía).");
      }
    }, (err) => {
      console.error(err);
      setInfo("No se pudieron cargar los horarios.");
      toast("Firestore bloqueó la lectura (Rules) o no hay conexión.");
    });
  }catch(err){
    console.error(err);
    setInfo("Error conectando a Firestore.");
    toast("Error conectando a Firestore. Revisa firebase.js / rutas.");
  }
}

/* =========================
   FILTER OPTIONS (auto)
========================= */
function ensureOption(selectEl, value){
  if (!selectEl || !value) return;
  const v = value.toString();
  const exists = Array.from(selectEl.options).some(o => o.value === v);
  if (exists) return;
  const opt = document.createElement("option");
  opt.value = v;
  opt.textContent = v;
  selectEl.appendChild(opt);
}

function fillFilterOptionsFromData(groups){
  const clases = new Set();
  const edades = new Set();
  const dias = new Set();

  for (const g of groups){
    if (g?.clase) clases.add(g.clase);
    if (g?.edad) edades.add(g.edad);
    for (const d of (g.__days || [])) dias.add(d);
  }

  const vClase = els.fClase?.value ?? "";
  const vEdad  = els.fEdad?.value ?? "";
  const vDia   = els.fDia?.value ?? "";

  Array.from(clases).sort((a,b)=>a.localeCompare(b,"es")).forEach(v => ensureOption(els.fClase, v));
  Array.from(edades).sort((a,b)=>a.localeCompare(b,"es")).forEach(v => ensureOption(els.fEdad, v));
  Array.from(dias).sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b)).forEach(v => ensureOption(els.fDia, v));

  if (els.fClase) els.fClase.value = vClase;
  if (els.fEdad) els.fEdad.value = vEdad;
  if (els.fDia) els.fDia.value = vDia;
}

/* =========================
   FILTERING
========================= */
function getFilterState(){
  return {
    search: normalize(els.search?.value ?? ""),
    clase: (els.fClase?.value ?? "").trim(),
    edad: (els.fEdad?.value ?? "").trim(),
    dia: (els.fDia?.value ?? "").trim(),
  };
}

function groupMatches(g, f){
  if (f.clase && (g?.clase ?? "") !== f.clase) return false;
  if (f.edad && (g?.edad ?? "") !== f.edad) return false;

  if (f.dia){
    const want = canonDay(f.dia);
    if (!g?.__days?.has?.(want)) return false;
  }

  if (f.search){
    const hay = g?.__search ?? "";
    if (!hay.includes(f.search)) return false;
  }

  return true;
}

function applyFilters(){
  const f = getFilterState();
  filteredGroups = allGroups.filter(g => groupMatches(g, f));
}

/* =========================
   VIEW MODE + UI TOGGLES
========================= */
function setPressed(btn, on){
  if (!btn) return;
  btn.classList.toggle("ghost", !on);
  btn.setAttribute("aria-pressed", on ? "true" : "false");
}

function showOnly(mode){
  // Wraps principales
  const showGrid = (mode === "grid");
  const showList = (mode === "list");
  const showAna  = (mode === "dashboard" || mode === "occupancy" || mode === "conflicts" || mode === "proposals");

  els.gridWrap?.classList.toggle("hidden", !showGrid);
  els.listWrap?.classList.toggle("hidden", !showList);
  els.analyticsWrap?.classList.toggle("hidden", !showAna);

  // Barras y leyendas (dashboard suele ser más “panel”)
  const showDaybar = (mode === "grid" || mode === "list");
  els.daybarWrap?.classList.toggle("hidden", !showDaybar);
  els.ageLegendWrap?.classList.toggle("hidden", !showDaybar);

  // Stats rápidos: útiles en grid/list; en analítica ya hay KPIs
  els.quickStatsWrap?.classList.toggle("hidden", showAna);
}

function setView(mode){
  const allowed = new Set(["grid","list","dashboard","occupancy","conflicts","proposals"]);
  const m = allowed.has(mode) ? mode : "grid";
  activeView = m;

  // Toolbar buttons
  setPressed(els.btnViewGrid, m === "grid");
  setPressed(els.btnViewList, m === "list");
  setPressed(els.btnViewDashboard, m === "dashboard");
  setPressed(els.btnViewOccupancy, m === "occupancy");
  setPressed(els.btnViewConflicts, m === "conflicts");
  setPressed(els.btnViewProposals, m === "proposals");

  showOnly(m);

  // Render
  if (m === "grid") renderGrid();
  else if (m === "list") renderList();
  else renderAnalytics(m);

  try{ localStorage.setItem(LS_VIEW, m); }catch(_){}
}

function initViewFromStorage(){
  try{
    const m = localStorage.getItem(LS_VIEW);
    if (m) activeView = m;
  }catch(_){}
}

/* =========================
   COLOR + HELPERS
========================= */
function initUIModes(){
  try{
    const cm = localStorage.getItem(LS_COLOR_MODE);
    if (cm === "area" || cm === "age") colorMode = cm;
  }catch(_){}
  if (els.colorByArea) els.colorByArea.checked = (colorMode === "area");
  if (els.colorByAge) els.colorByAge.checked = (colorMode === "age");

  try{
    const h = localStorage.getItem(LS_HELPERS);
    if (h === "0") helpersOn = false;
  }catch(_){}

  try{
    const t = localStorage.getItem(LS_ANA_TAB);
    if (t) activeAnaTab = t;
  }catch(_){}

  applyHelpersUI();
  applyColorModeUI();
  applyAnalyticsTabUI(activeAnaTab);
}

function applyColorModeUI(){
  document.body.classList.toggle("color-mode-area", colorMode === "area");
  document.body.classList.toggle("color-mode-age", colorMode === "age");
  els.grid?.classList.toggle("color-mode-area", colorMode === "area");
  els.grid?.classList.toggle("color-mode-age", colorMode === "age");

  try{ localStorage.setItem(LS_COLOR_MODE, colorMode); }catch(_){}
}

function applyHelpersUI(){
  document.body.classList.toggle("helpers-off", !helpersOn);
  if (els.btnToggleHelpers){
    els.btnToggleHelpers.setAttribute("aria-pressed", helpersOn ? "true" : "false");
    els.btnToggleHelpers.textContent = helpersOn ? "Ayudas" : "Ayudas (off)";
  }
  try{ localStorage.setItem(LS_HELPERS, helpersOn ? "1" : "0"); }catch(_){}
}

/* =========================
   STATS / ALERTS
========================= */
function computeStats(groups, day){
  const out = {
    groupsCount: groups.length,
    sessionsCount: 0,
    roomsUsedCount: 0,
    byArea: { music:0, dance:0, theater:0, arts:0 },
    byAge: new Map(),
    collisionsCells: 0,   // celdas con 2+ sesiones
    conflictsExtras: 0,   // extras (c-1)
    peakSessions: 0,
    // cupos (si existen)
    cupoMaxSum: 0,
    cupoOcuSum: 0,
    notes: []
  };

  const roomsUsed = new Set();
  const occ = new Map(); // time__room -> count
  const dayCanon = canonDay(day);

  for (const g of groups){
    const tone = g.__tone || toneClassForGroup(g);
    if (tone === "music") out.byArea.music++;
    else if (tone === "dance") out.byArea.dance++;
    else if (tone === "theater") out.byArea.theater++;
    else if (tone === "arts") out.byArea.arts++;

    const ak = g.__ageKey || ageKey(g);
    if (ak) out.byAge.set(ak, (out.byAge.get(ak) || 0) + 1);

    // cupos por grupo (si están)
    out.cupoMaxSum += clampInt(g.__cupoMax ?? 0, 0);
    out.cupoOcuSum += clampInt(g.__cupoOcu ?? 0, 0);

    for (const s of (g.__sessions || [])){
      if (s.day !== dayCanon) continue;
      const time = s.time;
      const room = s.room;
      if (!time || !room) continue;

      out.sessionsCount++;
      roomsUsed.add(room);

      if (PEAK_HOURS.has(time)) out.peakSessions++;

      const k = `${time}__${room}`;
      occ.set(k, (occ.get(k) || 0) + 1);
    }
  }

  out.roomsUsedCount = roomsUsed.size;

  for (const [, c] of occ){
    if (c > 1){
      out.collisionsCells += 1;
      out.conflictsExtras += (c - 1);
    }
  }

  const a = out.byArea;
  const total = Math.max(1, out.groupsCount);
  const share = (n) => n / total;
  const maxShare = Math.max(share(a.music), share(a.dance), share(a.theater), share(a.arts));
  const minShare = Math.min(share(a.music), share(a.dance), share(a.theater), share(a.arts));

  if (out.conflictsExtras > 0){
    out.notes.push(`Hay ${out.conflictsExtras} choque(s) extra en ${dayCanon} (mismo salón y hora).`);
  }
  if (maxShare >= 0.55 && total >= 8){
    out.notes.push("Una sola área domina mucho el horario (equilibrio por áreas).");
  }
  if (minShare <= 0.08 && total >= 10){
    out.notes.push("Hay un área casi ausente en la distribución (ojo si es accidental).");
  }
  if (out.peakSessions >= 10){
    out.notes.push("Hora pico está bastante cargada (bien para demanda, ojo choques).");
  }

  return out;
}

function renderStats(){
  const st = computeStats(filteredGroups, activeDay);

  if (els.statTotalGroups) els.statTotalGroups.textContent = String(st.groupsCount);
  if (els.statTotalSessions) els.statTotalSessions.textContent = String(st.sessionsCount);
  if (els.statTotalRooms) els.statTotalRooms.textContent = String(st.roomsUsedCount);

  if (els.statsByArea){
    const setVal = (k, v) => {
      const el = els.statsByArea.querySelector(`[data-k="${k}"]`);
      if (el) el.textContent = String(v);
    };
    setVal("music", st.byArea.music);
    setVal("dance", st.byArea.dance);
    setVal("theater", st.byArea.theater);
    setVal("arts", st.byArea.arts);
  }

  if (els.statsByAge){
    els.statsByAge.querySelectorAll("[data-k]").forEach(el => {
      const k = el.getAttribute("data-k");
      el.textContent = String(st.byAge.get(k) || 0);
    });
  }

  if (els.statsSubtitle){
    els.statsSubtitle.textContent = `Día: ${activeDay} · Sesiones: ${st.sessionsCount} · Choques: ${st.conflictsExtras}`;
  }

  if (els.statsAlerts){
    els.statsAlerts.innerHTML = "";
    const notes = st.notes.slice(0, 4);
    for (const n of notes){
      const div = document.createElement("div");
      div.className = "alert-row";
      div.textContent = n;
      els.statsAlerts.appendChild(div);
    }
  }
}

/* =========================
   DAY UI SYNC
========================= */
function syncDayUI(newDay, { fromSelect=false } = {}){
  const d = canonDay(newDay);
  if (!DAYS.includes(d)) return;

  activeDay = d;

  if (els.fDia){
    const cur = canonDay(els.fDia.value || "");
    if (!fromSelect || cur !== d) els.fDia.value = d;
  }

  renderDayTabs();
  renderStats();

  if (activeView === "grid") renderGrid();
  else if (activeView === "list") renderList();
  else renderAnalytics(activeView);

  writeFiltersToURL();
}

/* =========================
   RENDER - DAY TABS
========================= */
function renderDayTabs(){
  if (!els.dayTabs) return;
  els.dayTabs.innerHTML = "";

  DAYS.forEach((day) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "day-tab" + (day === activeDay ? " active" : "");
    btn.textContent = day;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", day === activeDay ? "true" : "false");
    btn.addEventListener("click", () => syncDayUI(day));
    els.dayTabs.appendChild(btn);
  });
}

/* =========================
   SESSIONS HELPERS
========================= */
function sessionsForDay(groups, day){
  const out = [];
  const dayCanon = canonDay(day);

  for (const g of groups){
    const sessions = g.__sessions || normalizeSessions(g?.sessions);
    for (const s of sessions){
      if (s.day !== dayCanon) continue;
      out.push({ group: g, day: dayCanon, time: s.time, room: s.room });
    }
  }

  out.sort((a,b) => safeTimeToMinutes(a.time) - safeTimeToMinutes(b.time));
  return out;
}

function buildTimeSlots(daySessions){
  const set = new Set();
  for (const s of daySessions){
    if (s.time) set.add(s.time);
  }
  for (const t of BASE_SLOTS) set.add(t);

  const arr = Array.from(set);
  arr.sort((a,b) => safeTimeToMinutes(a) - safeTimeToMinutes(b));
  return arr;
}

function bandForTime(hhmm){
  const m = safeTimeToMinutes(hhmm);
  if (m < 12*60) return "Mañana";
  if (m < 16*60) return "Mediodía";
  if (m < 20*60) return "Tarde";
  return "Noche";
}

/* =========================
   COLORS (inline fallback)
========================= */
const AREA_COLORS = {
  music: "#0C41C4",   // Mozart
  dance: "#CE0071",   // Brahms
  theater:"#680DBF",  // Beethoven-ish
  arts:  "#220A63",   // Bach
};

const AGE_COLORS = {
  Musibabies:  "#0C41C4",
  Musicalitos: "#5729FF",
  Musikids:    "#680DBF",
  Musiteens:   "#CE0071",
  Musigrandes: "#220A63",
  Musiadultos: "#0C0A1E",
};

function hexToRGBA(hex, a){
  const h = (hex || "").replace("#","").trim();
  if (h.length !== 6) return `rgba(17,24,39,${a})`;
  const r = parseInt(h.slice(0,2),16);
  const g = parseInt(h.slice(2,4),16);
  const b = parseInt(h.slice(4,6),16);
  return `rgba(${r},${g},${b},${a})`;
}

function applyBlockColors(blockEl, g){
  const tone = g.__tone || toneClassForGroup(g);
  const age = g.__ageKey || ageKey(g);

  const areaHex = AREA_COLORS[tone] || "#0C41C4";
  const ageHex = AGE_COLORS[age] || "#0C41C4";

  blockEl.dataset.tone = tone;
  if (age) blockEl.dataset.age = age;

  if (colorMode === "area"){
    blockEl.style.borderColor = hexToRGBA(areaHex, 0.55);
    blockEl.style.background = `linear-gradient(180deg, ${hexToRGBA(areaHex, 0.12)}, rgba(255,255,255,0.92))`;
  } else {
    blockEl.style.borderColor = hexToRGBA(ageHex, 0.55);
    blockEl.style.background = `linear-gradient(180deg, ${hexToRGBA(ageHex, 0.12)}, rgba(255,255,255,0.92))`;
  }
}

/* =========================
   RENDER GRID (ONE GRID)
========================= */
function renderGrid(){
  if (!els.grid) return;

  const daySessions = sessionsForDay(filteredGroups, activeDay);
  const slots = buildTimeSlots(daySessions);

  // occupancy map: time__room -> sessions[]
  const map = new Map();
  for (const s of daySessions){
    const key = `${s.time}__${s.room}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  }

  const board = document.createElement("div");
  board.className = "sg sg-board";
  board.style.gridTemplateColumns = `140px repeat(${ROOMS.length}, minmax(140px, 1fr))`;

  // Corner
  const corner = document.createElement("div");
  corner.className = "sg-cell sg-sticky-top sg-sticky-left sg-corner";
  corner.textContent = "Hora";
  board.appendChild(corner);

  // Room headers
  for (const r of ROOMS){
    const h = document.createElement("div");
    h.className = "sg-cell sg-sticky-top sg-room";
    h.dataset.room = r.key;
    h.innerHTML = `<div class="room-title">${htmlEscape(r.label)}</div><div class="room-note">${htmlEscape(r.note)}</div>`;
    board.appendChild(h);
  }

  // Rows
  for (let rowIdx=0; rowIdx<slots.length; rowIdx++){
    const time = slots[rowIdx];
    const zebra = (rowIdx % 2 === 0) ? "sg-row-even" : "sg-row-odd";
    const peak = helpersOn && PEAK_HOURS.has(time);

    const timeCell = document.createElement("div");
    timeCell.className = `sg-cell sg-sticky-left sg-time ${zebra}` + (peak ? " sg-peak" : "");
    timeCell.textContent = time;
    board.appendChild(timeCell);

    for (const r of ROOMS){
      const cell = document.createElement("div");
      cell.className = `sg-cell sg-cell-slot ${zebra}` + (peak ? " sg-peak" : "");
      cell.dataset.time = time;
      cell.dataset.room = r.key;

      const key = `${time}__${r.key}`;
      const items = map.get(key) || [];

      if (items.length > 1){
        cell.classList.add("sg-conflict");
        cell.title = "Choque: hay más de un grupo en este salón/hora";
      }

      if (!items.length){
        cell.innerHTML = `<div class="sg-empty" aria-hidden="true"></div>`;
        cell.addEventListener("click", () => {
          if (!canEdit()){
            explainNoPerm("crear");
            return;
          }
          openModalNewAt(activeDay, time, r.key);
        });
      } else {
        items.sort((a,b) => {
          const ga = a.group, gb = b.group;
          const ta = (ga?.enfoque || ga?.clase || "").toString();
          const tb = (gb?.enfoque || gb?.clase || "").toString();
          return ta.localeCompare(tb, "es");
        });

        for (const it of items){
          const g = it.group;

          const enfoque = (g?.enfoque ?? "").trim();
          const nivel = (g?.nivel ?? "").trim();
          const edad = (g?.edad ?? "").trim();

          const cupoMax = clampInt(g?.cupoMax ?? g?.cupo_max ?? g?.__cupoMax ?? 0, 0);
          const cupoOcu = clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? g?.__cupoOcu ?? 0, 0);
          const cupoTxt = (cupoMax > 0) ? `${cupoOcu}/${cupoMax}` : "";

          const title = [g?.clase, edad, enfoque, nivel].filter(Boolean).join(" · ");

          const block = document.createElement("button");
          block.type = "button";

          const tone = g.__tone || toneClassForGroup(g);
          const ageClass = edad ? `age-${normalize(edad).replace(/\s+/g,'-')}` : "";
          block.className = `sg-block ${tone} ${ageClass}`.trim();
          block.setAttribute("title", title);

          block.innerHTML = `
            <div class="sg-block-title">${htmlEscape(enfoque || g?.clase || "Grupo")}</div>
            <div class="sg-block-meta">
              <span>${htmlEscape(edad || "")}</span>
              ${cupoTxt ? `<span class="sg-chip">${htmlEscape(cupoTxt)}</span>` : ""}
            </div>
          `;

          applyBlockColors(block, g);

          block.addEventListener("click", (e) => {
            e.stopPropagation();
            if (canEdit()) openModalForGroup(g);
            else toast(title || "Grupo");
          });

          cell.appendChild(block);
        }
      }

      board.appendChild(cell);
    }
  }

  els.grid.innerHTML = "";
  els.grid.appendChild(board);

  setInfo(`${filteredGroups.length} grupo(s) · ${activeDay} · ${daySessions.length} sesión(es)`);
}

function renderList(){
  if (!els.list) return;

  const daySessions = sessionsForDay(filteredGroups, activeDay);

  const items = daySessions.slice().sort((a,b) => {
    const t = safeTimeToMinutes(a.time) - safeTimeToMinutes(b.time);
    if (t !== 0) return t;
    return (a.room || "").localeCompare(b.room || "");
  });

  if (!items.length){
    els.list.innerHTML = `
      <div class="list-empty">
        No hay sesiones para <strong>${htmlEscape(activeDay)}</strong> con los filtros actuales.
      </div>
    `;
    setInfo(`${filteredGroups.length} grupo(s) · ${activeDay} · 0 sesión(es)`);
    return;
  }

  const byTime = new Map();
  for (const it of items){
    if (!byTime.has(it.time)) byTime.set(it.time, []);
    byTime.get(it.time).push(it);
  }

  const times = Array.from(byTime.keys()).sort((a,b)=>safeTimeToMinutes(a)-safeTimeToMinutes(b));

  const frag = document.createDocumentFragment();

  for (const time of times){
    const wrap = document.createElement("div");
    wrap.className = "list-time-block";

    const head = document.createElement("div");
    head.className = "list-time-head";
    head.innerHTML = `<div class="list-time">${htmlEscape(time)}</div>`;
    wrap.appendChild(head);

    const rows = document.createElement("div");
    rows.className = "list-rows";

    const its = byTime.get(time) || [];
    its.sort((a,b) => (a.room || "").localeCompare(b.room || ""));

    for (const it of its){
      const g = it.group;
      const tone = g.__tone || toneClassForGroup(g);
      const enfoque = (g?.enfoque ?? "").trim();
      const nivel  = (g?.nivel ?? "").trim();
      const edad   = (g?.edad ?? "").trim();
      const clase  = (g?.clase ?? "").trim();

      const cupoMax = clampInt(g?.cupoMax ?? g?.cupo_max ?? g?.__cupoMax ?? 0, 0);
      const cupoOcu = clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? g?.__cupoOcu ?? 0, 0);
      const cupoTxt = (cupoMax > 0) ? `${cupoOcu}/${cupoMax}` : "";

      const row = document.createElement("button");
      row.type = "button";
      row.className = `list-row ${tone}`;
      row.title = [clase, edad, enfoque, nivel].filter(Boolean).join(" · ");

      row.innerHTML = `
        <div class="list-room">${htmlEscape(it.room || "")}</div>
        <div class="list-main">
          <div class="list-title">${htmlEscape(enfoque || clase || "Grupo")}</div>
          <div class="list-meta">
            <span>${htmlEscape(clase || "")}</span>
            ${edad ? `<span>· ${htmlEscape(edad)}</span>` : ""}
            ${nivel ? `<span>· ${htmlEscape(nivel)}</span>` : ""}
          </div>
        </div>
        <div class="list-side">
          ${cupoTxt ? `<span class="sg-chip">${htmlEscape(cupoTxt)}</span>` : ""}
        </div>
      `;

      row.addEventListener("click", () => {
        if (canEdit()) openModalForGroup(g);
        else toast(row.title || "Grupo");
      });

      rows.appendChild(row);
    }

    wrap.appendChild(rows);
    frag.appendChild(wrap);
  }

  els.list.innerHTML = "";
  els.list.appendChild(frag);

  setInfo(`${filteredGroups.length} grupo(s) · ${activeDay} · ${daySessions.length} sesión(es)`);
}

/* =========================
   ANALYTICS (Dashboard/Occupancy/Conflicts/Proposals)
========================= */
function applyAnalyticsTabUI(tab){
  activeAnaTab = tab || "dashboard";
  try{ localStorage.setItem(LS_ANA_TAB, activeAnaTab); }catch(_){}

  const setTab = (btn, isOn) => {
    if (!btn) return;
    btn.classList.toggle("ghost", !isOn);
    btn.setAttribute("aria-selected", isOn ? "true" : "false");
  };

  setTab(els.tabAnaDashboard, activeAnaTab === "dashboard");
  setTab(els.tabAnaEdad,      activeAnaTab === "edad");
  setTab(els.tabAnaSalon,     activeAnaTab === "salon");
  setTab(els.tabAnaArea,      activeAnaTab === "area");
  setTab(els.tabAnaFranja,    activeAnaTab === "franja");
}

function setKPI(idEl, v, subEl, sub){
  if (idEl) idEl.textContent = v;
  if (subEl && sub) subEl.textContent = sub;
}

function renderPillsFromMap(map, { max=12, labelPrefix="" } = {}){
  const entries = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0, max);
  if (!entries.length) return `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin datos para mostrar.</div>`;
  return `
    <div style="display:flex;flex-wrap:wrap;gap:8px;">
      ${entries.map(([k,v]) => `
        <span class="stat-pill" style="display:inline-flex;gap:8px;align-items:center;">
          <span class="dot-mini"></span>${htmlEscape(labelPrefix ? `${labelPrefix}${k}` : k)}: ${v}
        </span>
      `).join("")}
    </div>
  `;
}

function computeAnalytics(groups, day){
  const st = computeStats(groups, day);
  const daySessions = sessionsForDay(groups, day);

  // Distribuciones
  const byAgeSessions = new Map();
  const byRoomSessions = new Map();
  const byAreaSessions = new Map();
  const byBandSessions = new Map();
  const collisions = []; // {time, room, count, items[]}

  const occMap = new Map(); // time__room -> items[]
  for (const it of daySessions){
    const g = it.group;
    const age = g.__ageKey || ageKey(g) || "Sin edad";
    const room = it.room || "Sin salón";
    const area = g.__tone || toneClassForGroup(g);
    const band = bandForTime(it.time);

    byAgeSessions.set(age, (byAgeSessions.get(age) || 0) + 1);
    byRoomSessions.set(room, (byRoomSessions.get(room) || 0) + 1);
    byAreaSessions.set(area, (byAreaSessions.get(area) || 0) + 1);
    byBandSessions.set(band, (byBandSessions.get(band) || 0) + 1);

    const k = `${it.time}__${room}`;
    if (!occMap.has(k)) occMap.set(k, []);
    occMap.get(k).push(it);
  }

  for (const [k, arr] of occMap.entries()){
    if (arr.length > 1){
      const [time, room] = k.split("__");
      collisions.push({ time, room, count: arr.length, items: arr });
    }
  }
  collisions.sort((a,b)=> b.count - a.count || safeTimeToMinutes(a.time)-safeTimeToMinutes(b.time));

  // “Ocupación” estimada (si hay cupos)
  const ocu = st.cupoMaxSum > 0 ? (st.cupoOcuSum / Math.max(1, st.cupoMaxSum)) : null;

  return { st, daySessions, byAgeSessions, byRoomSessions, byAreaSessions, byBandSessions, collisions, ocu };
}

function renderAnalytics(mode){
  // mode: dashboard|occupancy|conflicts|proposals
  if (!els.analyticsWrap) return;

  const dayCanon = activeDay;
  const A = computeAnalytics(filteredGroups, dayCanon);

  // Títulos generales
  if (els.analyticsTitle){
    els.analyticsTitle.textContent =
      mode === "dashboard" ? "Dashboard" :
      mode === "occupancy" ? "Ocupación" :
      mode === "conflicts" ? "Conflictos" :
      "Propuestas";
  }
  if (els.analyticsSubtitle){
    els.analyticsSubtitle.textContent =
      mode === "dashboard" ? "KPIs para operar sin adivinar." :
      mode === "occupancy" ? "Distribución por edades, salones, áreas y franjas." :
      mode === "conflicts" ? "Celdas con 2+ sesiones (choques) y dónde ocurren." :
      "Huecos sugeridos (básico) para programar sin estrellarse.";
  }

  // KPIs
  setKPI(els.kpiGroups, String(A.st.groupsCount), els.kpiGroupsSub, "Activos según filtros");
  setKPI(els.kpiSessions, String(A.st.sessionsCount), els.kpiSessionsSub, `Sesiones en ${dayCanon}`);
  const occText = (A.ocu == null) ? "—" : `${percent(A.ocu)}`;
  const occSub  = (A.ocu == null) ? "Sin cupos en datos" : `${A.st.cupoOcuSum}/${A.st.cupoMaxSum} cupos`;
  setKPI(els.kpiOccupancy, occText, els.kpiOccupancySub, occSub);
  setKPI(els.kpiCollisions, String(A.st.collisionsCells), els.kpiCollisionsSub, "Celdas con 2+ sesiones");

  // Tabs (si estás en dashboard/occupancy, te sirven; en conflictos igual)
  applyAnalyticsTabUI(activeAnaTab);

  // Render principal según modo
  const top = els.anaTopContent;
  const bottom = els.anaBottomContent;
  const alerts = els.anaAlertsContent;

  if (top) top.innerHTML = "";
  if (bottom) bottom.innerHTML = "";
  if (alerts) alerts.innerHTML = "";

  // Insights (siempre)
  if (alerts){
    const notes = A.st.notes.slice(0, 6);
    alerts.innerHTML = notes.length
      ? `<div style="display:flex;flex-direction:column;gap:8px;">
           ${notes.map(n => `<div class="alert-row">${htmlEscape(n)}</div>`).join("")}
         </div>`
      : `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin alertas por ahora. Milagro.</div>`;
  }

  // Helpers para contenido por tab
  const renderTabContent = (tab) => {
    if (!top || !bottom) return;

    if (tab === "edad"){
      els.anaTopTitle && (els.anaTopTitle.textContent = "Sesiones por edad");
      top.innerHTML = renderPillsFromMap(A.byAgeSessions, { max: 24 });
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Grupos por edad");
      const byAgeGroups = new Map();
      for (const g of filteredGroups){
        const k = g.__ageKey || ageKey(g) || "Sin edad";
        byAgeGroups.set(k, (byAgeGroups.get(k) || 0) + 1);
      }
      bottom.innerHTML = renderPillsFromMap(byAgeGroups, { max: 24 });
      return;
    }

    if (tab === "salon"){
      els.anaTopTitle && (els.anaTopTitle.textContent = "Sesiones por salón");
      top.innerHTML = renderPillsFromMap(A.byRoomSessions, { max: 24 });
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Salones usados (top)");
      bottom.innerHTML = `
        <div style="font-weight:900;color:rgba(17,24,39,.88);">
          Salones usados: ${A.st.roomsUsedCount} / ${ROOMS.length}
        </div>
      `;
      return;
    }

    if (tab === "area"){
      els.anaTopTitle && (els.anaTopTitle.textContent = "Sesiones por área");
      const labels = new Map();
      for (const [k,v] of A.byAreaSessions.entries()){
        const name =
          k === "music" ? "Música" :
          k === "dance" ? "Danza" :
          k === "theater" ? "Teatro" :
          k === "arts" ? "Artes" : k;
        labels.set(name, v);
      }
      top.innerHTML = renderPillsFromMap(labels, { max: 12 });
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Grupos por área");
      const gMap = new Map([
        ["Música", A.st.byArea.music],
        ["Danza", A.st.byArea.dance],
        ["Teatro", A.st.byArea.theater],
        ["Artes", A.st.byArea.arts],
      ]);
      bottom.innerHTML = renderPillsFromMap(gMap, { max: 12 });
      return;
    }

    if (tab === "franja"){
      els.anaTopTitle && (els.anaTopTitle.textContent = "Sesiones por franja horaria");
      top.innerHTML = renderPillsFromMap(A.byBandSessions, { max: 12 });
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Hora pico");
      bottom.innerHTML = `
        <div class="stat-pill"><span class="dot-mini"></span>Sesiones hora pico: ${A.st.peakSessions}</div>
        <div style="height:8px;"></div>
        <div style="font-weight:800;color:rgba(107,114,128,.95);">
          Hora pico definida: ${Array.from(PEAK_HOURS).join(", ")}
        </div>
      `;
      return;
    }

    // default: dashboard
    els.anaTopTitle && (els.anaTopTitle.textContent = "Resumen visual");
    top.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:10px;">
        <span class="stat-pill"><span class="dot-mini"></span>Grupos: ${A.st.groupsCount}</span>
        <span class="stat-pill"><span class="dot-mini"></span>Sesiones (${dayCanon}): ${A.st.sessionsCount}</span>
        <span class="stat-pill"><span class="dot-mini"></span>Salones usados: ${A.st.roomsUsedCount}/${ROOMS.length}</span>
        <span class="stat-pill"><span class="dot-mini"></span>Choques (celdas): ${A.st.collisionsCells}</span>
        <span class="stat-pill"><span class="dot-mini"></span>Choques extra: ${A.st.conflictsExtras}</span>
        <span class="stat-pill"><span class="dot-mini"></span>Ocupación: ${occText}</span>
      </div>
    `;

    els.anaBottomTitle && (els.anaBottomTitle.textContent = "Top salones + top edades");
    const topRooms = Array.from(A.byRoomSessions.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 5);
    const topAges = Array.from(A.byAgeSessions.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 6);
    bottom.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div class="stats-box">
          <h4>Top salones</h4>
          ${renderPillsFromMap(new Map(topRooms), { max: 10 })}
        </div>
        <div class="stats-box">
          <h4>Top edades (sesiones)</h4>
          ${renderPillsFromMap(new Map(topAges), { max: 10 })}
        </div>
      </div>
    `;
  };

  // Modo especial: conflicts/proposals sobre-escriben tab para que tenga sentido
  if (mode === "conflicts"){
    applyAnalyticsTabUI("dashboard");
    els.anaTopTitle && (els.anaTopTitle.textContent = "Celdas con choques");
    if (top){
      top.innerHTML = A.collisions.length
        ? `<div style="display:flex;flex-direction:column;gap:8px;">
            ${A.collisions.slice(0, 30).map(c => `
              <div class="alert-row" style="border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08);color:rgba(127,29,29,.95);">
                <strong>${htmlEscape(c.time)} · ${htmlEscape(c.room)}</strong> · ${c.count} sesiones
              </div>
            `).join("")}
           </div>`
        : `<div style="font-weight:800;color:rgba(107,114,128,.95);">No hay choques para ${htmlEscape(dayCanon)} con estos filtros.</div>`;
    }
    if (bottom){
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Detalle (primeros choques)");
      const first = A.collisions[0];
      if (!first){
        bottom.innerHTML = `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin detalle.</div>`;
      } else {
        bottom.innerHTML = `
          <div class="stats-box">
            <h4>${htmlEscape(first.time)} · ${htmlEscape(first.room)}</h4>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${first.items.map(it => {
                const g = it.group;
                const title = [g.clase, g.edad, g.enfoque, g.nivel].filter(Boolean).join(" · ");
                return `<div class="stat-pill" style="justify-content:space-between;">
                          <span>${htmlEscape(g.enfoque || g.clase || "Grupo")}</span>
                          <span style="opacity:.85">${htmlEscape(g.edad || "")}</span>
                        </div>`;
              }).join("")}
            </div>
          </div>
        `;
      }
    }
    setInfo(`${filteredGroups.length} grupo(s) · ${dayCanon} · choques: ${A.st.conflictsExtras}`);
    return;
  }

  if (mode === "proposals"){
    // Propuestas simple: buscar celdas vacías en hora pico (o base slots) por salón
    applyAnalyticsTabUI("dashboard");
    els.anaTopTitle && (els.anaTopTitle.textContent = "Huecos sugeridos");
    const daySessions = A.daySessions;

    const occ = new Set(daySessions.map(s => `${s.time}__${s.room}`));
    const slots = Array.from(new Set([...BASE_SLOTS, ...daySessions.map(s=>s.time)])).sort((a,b)=>safeTimeToMinutes(a)-safeTimeToMinutes(b));
    const preferred = slots.filter(t => PEAK_HOURS.has(t)).length ? slots.filter(t => PEAK_HOURS.has(t)) : slots.slice(-4);

    const suggestions = [];
    for (const t of preferred){
      for (const r of ROOMS){
        const k = `${t}__${r.key}`;
        if (!occ.has(k)){
          suggestions.push({ time:t, room:r.key });
        }
      }
    }

    if (top){
      top.innerHTML = suggestions.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">
            ${suggestions.slice(0, 40).map(s => `
              <span class="stat-pill"><span class="dot-mini"></span>${htmlEscape(s.time)} · ${htmlEscape(s.room)}</span>
            `).join("")}
           </div>`
        : `<div style="font-weight:800;color:rgba(107,114,128,.95);">No hay huecos sugeridos (o todo está lleno). Bien por ustedes.</div>`;
    }

    if (bottom){
      els.anaBottomTitle && (els.anaBottomTitle.textContent = "Idea rápida");
      bottom.innerHTML = `
        <div class="stats-box">
          <h4>Cómo usar esto</h4>
          <div style="font-weight:800;color:rgba(107,114,128,.95);line-height:1.35;">
            Estos huecos son “básicos”: celdas vacías en hora pico (o últimas franjas).
            Úsalos para abrir grupos nuevos sin estrellarte con choques.
          </div>
        </div>
      `;
    }
    setInfo(`${filteredGroups.length} grupo(s) · ${dayCanon} · propuestas: ${Math.min(40, suggestions.length)}`);
    return;
  }

  // dashboard / occupancy usan tabs
  if (mode === "occupancy"){
    // Forzamos tab si está en algo raro
    if (!["dashboard","edad","salon","area","franja"].includes(activeAnaTab)) applyAnalyticsTabUI("dashboard");
    renderTabContent(activeAnaTab);
    setInfo(`${filteredGroups.length} grupo(s) · ${dayCanon} · sesiones: ${A.st.sessionsCount}`);
    return;
  }

  // dashboard normal
  if (!["dashboard","edad","salon","area","franja"].includes(activeAnaTab)) applyAnalyticsTabUI("dashboard");
  renderTabContent(activeAnaTab);
  setInfo(`${filteredGroups.length} grupo(s) · ${dayCanon} · sesiones: ${A.st.sessionsCount}`);
}

/* =========================
   APPLY FILTERS + RENDER
========================= */
function applyFiltersAndRender(){
  applyFilters();

  renderDayTabs();
  renderStats();

  if (activeView === "grid") renderGrid();
  else if (activeView === "list") renderList();
  else renderAnalytics(activeView);

  applyColorModeUI();
  applyHelpersUI();
}

/* =========================
   MODAL (ADMIN)
========================= */
function openModal(){
  _lastFocus = document.activeElement;

  els.modal?.classList.remove("hidden");
  els.modal?.setAttribute("aria-hidden","false");
  document.body.style.overflow = "hidden";

  setTimeout(() => {
    (els.mEnfoque || els.mClase || els.btnSave)?.focus?.();
  }, 0);
}

function closeModal(){
  els.modal?.classList.add("hidden");
  els.modal?.setAttribute("aria-hidden","true");
  document.body.style.overflow = "";
  editingId = null;
  editingDraft = null;
  if (els.sessionsList) els.sessionsList.innerHTML = "";

  setTimeout(() => _lastFocus?.focus?.(), 0);
}

function setModalTitle(t){
  if (els.modalTitle) els.modalTitle.textContent = t;
}

function writeDraftToModal(d){
  if (!d) return;
  if (els.mClase) els.mClase.value = d.clase ?? "Música";
  if (els.mEdad) els.mEdad.value = d.edad ?? "Musikids";
  if (els.mEnfoque) els.mEnfoque.value = d.enfoque ?? "";
  if (els.mNivel) els.mNivel.value = d.nivel ?? "";
  if (els.mCupoMax) els.mCupoMax.value = String(clampInt(d.cupoMax ?? 0, 0));
  if (els.mCupoOcu) els.mCupoOcu.value = String(clampInt(d.cupoOcupado ?? 0, 0));
  if (els.mActivo) els.mActivo.checked = (d.activo !== false);
}

function readDraftFromModal(){
  const d = editingDraft || {};
  d.clase = (els.mClase?.value ?? "").trim();
  d.edad = (els.mEdad?.value ?? "").trim();
  d.enfoque = (els.mEnfoque?.value ?? "").trim();
  d.nivel = (els.mNivel?.value ?? "").trim();
  d.cupoMax = clampInt(els.mCupoMax?.value ?? 0, 0);
  d.cupoOcupado = clampInt(els.mCupoOcu?.value ?? 0, 0);
  d.activo = !!els.mActivo?.checked;
  return d;
}

function renderSessionsList(){
  if (!els.sessionsList) return;

  const d = editingDraft || {};
  const sessions = normalizeSessions(d.sessions);
  els.sessionsList.innerHTML = "";

  sessions.forEach((s, idx) => {
    const row = document.createElement("div");
    row.className = "session-row";

    row.innerHTML = `
      <div class="field">
        <label>Día</label>
        <select data-k="day" data-i="${idx}">
          ${DAYS.map(x => `<option ${x===s.day?"selected":""}>${htmlEscape(x)}</option>`).join("")}
        </select>
      </div>

      <div class="field">
        <label>Hora</label>
        <input data-k="time" data-i="${idx}" value="${htmlEscape(s.time)}" placeholder="16:00" />
      </div>

      <div class="field">
        <label>Salón</label>
        <select data-k="room" data-i="${idx}">
          ${ROOMS.map(r => `<option ${r.key===s.room?"selected":""}>${htmlEscape(r.key)}</option>`).join("")}
        </select>
      </div>

      <button class="icon-btn danger" type="button" data-del="${idx}" aria-label="Quitar">✕</button>
    `;

    els.sessionsList.appendChild(row);
  });

  els.sessionsList.querySelectorAll("[data-k]").forEach(el => {
    el.addEventListener("change", (e) => {
      const i = clampInt(e.target.getAttribute("data-i"), 0);
      const k = e.target.getAttribute("data-k");
      const v = (e.target.value ?? "").trim();

      editingDraft.sessions = normalizeSessions(editingDraft.sessions);
      if (!editingDraft.sessions[i]) return;

      if (k === "time") editingDraft.sessions[i][k] = normalizeHHMM(v);
      else if (k === "day") editingDraft.sessions[i][k] = canonDay(v);
      else if (k === "room") editingDraft.sessions[i][k] = canonRoom(v);
      else editingDraft.sessions[i][k] = v;

      editingDraft.sessions = normalizeSessions(editingDraft.sessions);
      renderSessionsList();
    });
  });

  els.sessionsList.querySelectorAll("[data-del]").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const i = clampInt(e.target.getAttribute("data-del"), 0);
      editingDraft.sessions = normalizeSessions(editingDraft.sessions);
      editingDraft.sessions.splice(i, 1);
      renderSessionsList();
    });
  });
}

function openModalForGroup(g){
  editingId = g?.id ?? null;
  editingDraft = {
    clase: g?.clase ?? "Música",
    edad: g?.edad ?? "Musikids",
    enfoque: g?.enfoque ?? "",
    nivel: g?.nivel ?? "",
    cupoMax: g?.cupoMax ?? g?.cupo_max ?? 0,
    cupoOcupado: g?.cupoOcupado ?? g?.cupo_ocupado ?? 0,
    activo: (g?.activo !== false),
    sessions: normalizeSessions(g?.sessions),
  };

  setModalTitle(editingId ? "Editar grupo" : "Nuevo grupo");
  writeDraftToModal(editingDraft);
  renderSessionsList();
  openModal();
}

function openModalNew(){
  openModalForGroup({ id:null });
  editingId = null;
}

function openModalNewAt(day, time, roomKey){
  openModalNew();
  editingDraft.sessions = normalizeSessions(editingDraft.sessions);
  editingDraft.sessions.push({
    day: canonDay(day),
    time: normalizeHHMM(time),
    room: canonRoom(roomKey)
  });
  editingDraft.sessions = normalizeSessions(editingDraft.sessions);
  renderSessionsList();
}

function addSession(){
  if (!editingDraft) editingDraft = {};
  editingDraft.sessions = normalizeSessions(editingDraft.sessions);
  editingDraft.sessions.push({ day: canonDay(activeDay), time: "16:00", room: ROOMS[0].key });
  editingDraft.sessions = normalizeSessions(editingDraft.sessions);
  renderSessionsList();
}

/* =========================
   SAVE / DELETE
========================= */
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

function validateDraftBeforeSave(d){
  if (!d.clase) d.clase = "Música";
  if (!d.edad) d.edad = "Musikids";
  d.sessions = normalizeSessions(d.sessions);

  if (!d.sessions.length){
    toast("Agrega al menos una sesión (día/hora/salón).");
    return false;
  }
  return true;
}

async function saveGroup(){
  if (!canEdit()){
    explainNoPerm("guardar");
    return;
  }

  try{
    const d = readDraftFromModal();
    d.sessions = normalizeSessions(editingDraft?.sessions);
    d.updatedAt = serverTimestamp();

    if (!validateDraftBeforeSave(d)) return;

    if (!editingId){
      d.createdAt = serverTimestamp();
      await addDoc(collection(db, GROUPS_COLLECTION), d);
      toast("Grupo creado ✅");
    } else {
      await updateDoc(doc(db, GROUPS_COLLECTION, editingId), d);
      toast("Grupo guardado ✅");
    }

    closeModal();
  }catch(err){
    console.error(err);
    explainFirestoreErr(err);
  }
}

async function deleteGroup(){
  if (!canEdit()){
    explainNoPerm("eliminar");
    return;
  }
  if (!editingId){
    toast("Este grupo no existe aún.");
    return;
  }
  const ok = confirm("¿Eliminar este grupo? Esto no se puede deshacer.");
  if (!ok) return;

  try{
    await deleteDoc(doc(db, GROUPS_COLLECTION, editingId));
    toast("Grupo eliminado ✅");
    closeModal();
  }catch(err){
    console.error(err);
    explainFirestoreErr(err);
  }
}

/* =========================
   EVENTS
========================= */
function wireEvents(){
  els.btnLogin?.addEventListener("click", login);
  els.btnLogout?.addEventListener("click", logout);

  const onFilterChanged = () => {
    writeFiltersToURL();
    applyFiltersAndRender();
  };

  const onSearch = debounce(() => {
    writeFiltersToURL();
    applyFiltersAndRender();
  }, 140);

  els.search?.addEventListener("input", onSearch);
  els.search?.addEventListener("change", () => writeFiltersToURL());

  els.fClase?.addEventListener("change", onFilterChanged);
  els.fEdad?.addEventListener("change", onFilterChanged);

  els.fDia?.addEventListener("change", () => {
    const d = canonDay(els.fDia.value || "");
    if (d && DAYS.includes(d)) syncDayUI(d, { fromSelect:true });
    else onFilterChanged();
  });

  els.btnNew?.addEventListener("click", () => {
    if (!canEdit()) { explainNoPerm("crear"); return; }
    openModalNew();
  });

  els.modalClose?.addEventListener("click", closeModal);
  els.modal?.addEventListener("click", (e) => { if (e.target === els.modal) closeModal(); });

  window.addEventListener("keydown", (e) => {
    const modalOpen = !els.modal?.classList.contains("hidden");

    if (e.key === "Escape" && modalOpen) closeModal();

    if (modalOpen && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s"){
      e.preventDefault();
      saveGroup();
    }

    if (document.activeElement?.closest?.("#day-tabs")){
      if (e.key === "ArrowRight"){
        e.preventDefault();
        syncDayUI(nextDay(activeDay, +1));
      } else if (e.key === "ArrowLeft"){
        e.preventDefault();
        syncDayUI(nextDay(activeDay, -1));
      }
    }
  });

  els.btnAddSession?.addEventListener("click", addSession);
  els.btnSave?.addEventListener("click", saveGroup);
  els.btnDelete?.addEventListener("click", deleteGroup);

  // Views
  els.btnViewGrid?.addEventListener("click", () => setView("grid"));
  els.btnViewList?.addEventListener("click", () => setView("list"));
  els.btnViewDashboard?.addEventListener("click", () => setView("dashboard"));
  els.btnViewOccupancy?.addEventListener("click", () => setView("occupancy"));
  els.btnViewConflicts?.addEventListener("click", () => setView("conflicts"));
  els.btnViewProposals?.addEventListener("click", () => setView("proposals"));

  // Analytics tabs
  const bindAna = (btn, tab) => {
    btn?.addEventListener("click", () => {
      applyAnalyticsTabUI(tab);
      if (activeView === "dashboard" || activeView === "occupancy") renderAnalytics(activeView);
    });
  };
  bindAna(els.tabAnaDashboard, "dashboard");
  bindAna(els.tabAnaEdad, "edad");
  bindAna(els.tabAnaSalon, "salon");
  bindAna(els.tabAnaArea, "area");
  bindAna(els.tabAnaFranja, "franja");

  // Color mode
  els.colorByArea?.addEventListener("change", () => {
    colorMode = "area";
    applyColorModeUI();
    if (activeView === "grid") renderGrid();
    else if (activeView === "list") renderList();
  });
  els.colorByAge?.addEventListener("change", () => {
    colorMode = "age";
    applyColorModeUI();
    if (activeView === "grid") renderGrid();
    else if (activeView === "list") renderList();
  });

  // Helpers toggle
  els.btnToggleHelpers?.addEventListener("click", () => {
    helpersOn = !helpersOn;
    applyHelpersUI();
    if (activeView === "grid") renderGrid();
    else if (activeView === "list") renderList();
  });
}

/* =========================
   INIT
========================= */
async function init(){
  initViewFromStorage();
  readFiltersFromURL();
  initUIModes();

  if (els.fDia && DAYS.includes(activeDay)) els.fDia.value = activeDay;

  wireEvents();
  renderDayTabs();

  await initRedirectResult();

  onAuthStateChanged(auth, (user) => {
    currentUser = user || null;
    adminUIEnabled = isAdminFlagOn();
    isAllowlistedAdmin = computeAllowlist(user);

    if (DEBUG){
      console.log("[AUTH] user:", user);
      console.log("[AUTH] email:", user?.email);
      console.log("[AUTH] adminFlag:", adminUIEnabled);
      console.log("[AUTH] allowlist:", isAllowlistedAdmin);
    } else {
      DBG.onceLog("authState",
        "[AUTH]",
        "email:", user?.email,
        "adminFlag:", adminUIEnabled,
        "allowlist:", isAllowlistedAdmin
      );
    }

    refreshAdminUI();
    subscribeGroupsOnce();
  });

  // fallback
  setTimeout(() => {
    if (!unsubscribeGroups) subscribeGroupsOnce();
  }, 900);

  // view initial
  setTimeout(() => setView(activeView), 0);

  // URL coherente desde arranque
  writeFiltersToURL();
}

init();
