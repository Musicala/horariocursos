// main.js — Horarios Grupales · Musicala (LIGHT) — Grid Edition (PC-first)
// -----------------------------------------------------------------------------
// ✅ Sin login / sin admin / sin roles / sin menú móvil
// ✅ Mantiene Firestore (firebase.js) y Export/Import JSON (backup)
// ✅ UI: rail izquierda + tablero grid + stats debajo
// ✅ Pantalla completa (UI + intento nativo cross-browser)
// ✅ Helpers SIEMPRE activos (hora pico siempre visible se fuerza en core)
// ✅ Vista: Tablero / Lista (UI cableada, render depende del core)
// -----------------------------------------------------------------------------
// FIX CLAVE: Day tabs llaman api.syncDayUI(d) con el día correcto
// EXTRA: Scroll en vista normal: wheel/trackpad SIEMPRE scrollea el tablero
// EXTRA 2: Firestore error messages muestran code+message (no “dijo que no”)
// ✅ EXTRA 3: Bloqueo de choques (si está ocupado, NO deja crear encima y avisa)
// -----------------------------------------------------------------------------
//
// Nota: Este archivo asume que horarios.core.js expone un API compatible con:
// - reload({force})
// - applyFiltersAndRender({force})
// - syncDayUI(day)
// - showOnly("grid"|"list")
// - exportBackup()
// - importBackupFromFile(event)
//
// -----------------------------------------------------------------------------


'use strict';

import { db } from "./firebase.js";

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
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { initCore } from "./horarios.core.js";

/* =========================
   CONFIG
========================= */
const DEBUG = new URL(location.href).searchParams.get("debug") === "1";
const GROUPS_COLLECTION = "groups";

// Choques: si ya hay un bloque en la celda, ¿permitimos agregar otro?
// ❌ En tu caso: NO. Si está ocupado, avisar y bloquear.
const ALLOW_COLLISIONS_WITH_CONFIRM = false;

// Días / Salones (se conservan)
const DAYS = Object.freeze(["Lunes","Martes","Miércoles","Jueves","Viernes","Sábado","Domingo"]);

const ROOMS = Object.freeze([
  { key:"Salón 1",  short:"S1",  label:"Salón 1",  note:"Danzas/Teatro" },
  { key:"Salón 2",  short:"S2",  label:"Salón 2",  note:"Artes" },
  { key:"Salón 3",  short:"S3",  label:"Salón 3",  note:"Auditorio" },
  { key:"Salón 4",  short:"S4",  label:"Salón 4",  note:"Música (cuerdas)" },
  { key:"Salón 5",  short:"S5",  label:"Salón 5",  note:"Música (guitarra)" },
  { key:"Salón 6",  short:"S6",  label:"Salón 6",  note:"Artes" },
  { key:"Salón 7",  short:"S7",  label:"Salón 7",  note:"Música (piano)" },
  { key:"Salón 8",  short:"S8",  label:"Salón 8",  note:"Música (batería)" },
  { key:"Salón 9",  short:"S9",  label:"Salón 9",  note:"Música (canto)" },
  { key:"Salón 10", short:"S10", label:"Salón 10", note:"Música (ensamble)" },
]);

// Rangos horarios
const PEAK_HOURS = new Set(["15:00","16:00","17:00","18:00","19:00"]);
const BASE_SLOTS = Object.freeze([
  "07:00","08:00","09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00","17:00","18:00",
  "19:00","20:00"
]);

/* =========================
   DOM
========================= */
const els = {
  // topbar
  btnReload:     document.getElementById("btn-reload"),
  btnExport:     document.getElementById("btn-export-json"),
  btnImport:     document.getElementById("btn-import-json"),
  btnFullscreen: document.getElementById("btn-fullscreen"),
  fileImport:    document.getElementById("file-import-json"),

  // sidebar
  sidebar:       document.getElementById("sidebar"),
  groupSelect:   document.getElementById("group-select"),
  search:        document.getElementById("search"),
  fClase:        document.getElementById("filter-clase"),
  fEdad:         document.getElementById("filter-edad"),
  dayTabs:       document.getElementById("day-tabs"),
  colorByArea:   document.getElementById("color-by-area"),
  colorByAge:    document.getElementById("color-by-age"),
  viewGrid:      document.getElementById("view-grid"),
  viewList:      document.getElementById("view-list"),
  btnClear:      document.getElementById("btn-clear"),

  // board
  gridWrap:      document.getElementById("grid-wrap"),
  grid:          document.getElementById("schedule-grid"),
  list:          document.getElementById("schedule-list"),
  resultsInfo:   document.getElementById("results-info"),

  // analytics/stats
  analyticsWrap:     document.getElementById("analyticsWrap"),
  analyticsTitle:    document.getElementById("analyticsTitle"),
  analyticsSubtitle: document.getElementById("analyticsSubtitle"),
  analyticsTabs:     document.getElementById("analyticsTabs"), // puede no existir
  anaTopTitle:       document.getElementById("anaTopTitle"),
  anaTopContent:     document.getElementById("anaTopContent"),
  anaBottomTitle:    document.getElementById("anaBottomTitle"),
  anaBottomContent:  document.getElementById("anaBottomContent"),
  anaAlertsContent:  document.getElementById("anaAlertsContent"),

  // modal
  modal:             document.getElementById("modal"),
  btnModalClose:     document.getElementById("modal-close"),
  btnModalSave:      document.getElementById("btn-save"),
  btnModalDelete:    document.getElementById("btn-delete"),
  btnAddSession:     document.getElementById("btn-add-session"),
  modalSessionsWrap: document.getElementById("sessions-list"),

  inClase:     document.getElementById("m-clase"),
  inEdad:      document.getElementById("m-edad"),
  inEnfoque:   document.getElementById("m-enfoque"),
  inNivel:     document.getElementById("m-nivel"),
  inCupoMax:   document.getElementById("m-cupo-max"),
  inCupoOcu:   document.getElementById("m-cupo-ocupado"),
  inActivo:    document.getElementById("m-activo"),

  toast:       document.getElementById("toast"),
};

function log(...a){ if (DEBUG) console.log("[horarios]", ...a); }

/* =========================
   STATE
========================= */
const state = {
  activeDay: "Lunes",
  activeView: "grid", // "grid" | "list"
  colorMode: "area",
  helpersOn: true,    // 🔒 SIEMPRE true
  fullscreenOn: false,

  allGroups: [],
  filteredGroups: [],

  unsubscribeGroups: null,

  // anti-spam
  _warnedListOnce: false,

  // init flags
  _booted: false,
};

/* =========================
   UTILS
========================= */
const utils = {
  normalize(s){
    return (s ?? "")
      .toString()
      .normalize("NFD").replace(/\p{Diacritic}/gu,"")
      .toLowerCase()
      .trim();
  },
  keyify(s){ return utils.normalize(s).replace(/\s+/g,"-"); },
  htmlEscape(str){
    return (str ?? "").toString()
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  },
  clampInt(v, min=0, max=9999){
    const n = Number.parseInt(v, 10);
    if (Number.isNaN(n)) return min;
    return Math.max(min, Math.min(max, n));
  },
  debounce(fn, wait=180){
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },
  normalizeHHMM(x){
    const s = (x ?? "").toString().trim();
    const m = s.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return "";
    const hh = String(Math.min(23, Math.max(0, parseInt(m[1],10)))).padStart(2,"0");
    const mm = String(Math.min(59, Math.max(0, parseInt(m[2],10)))).padStart(2,"0");
    return `${hh}:${mm}`;
  },
  safeTimeToMinutes(hhmm){
    const s = utils.normalizeHHMM(hhmm);
    if (!s) return 0;
    const [h,m] = s.split(":").map(n => parseInt(n,10));
    return h*60 + m;
  },
  compareSessions(a,b){
    return utils.safeTimeToMinutes(a?.time) - utils.safeTimeToMinutes(b?.time);
  },
  canonDay(day){
    const n = (day ?? "").toString().trim();
    const hit = DAYS.find(d => utils.normalize(d) === utils.normalize(n));
    return hit || "Lunes";
  },
  canonRoom(room){
    const n = (room ?? "").toString().trim();
    const hit = ROOMS.find(r =>
      utils.normalize(r.key) === utils.normalize(n) ||
      utils.normalize(r.label) === utils.normalize(n)
    );
    return hit?.key || "Salón 1";
  },
  percent(num, den){
    const a = Number(num)||0, b = Number(den)||0;
    if (!b) return 0;
    return Math.round((a/b)*100);
  },
  setInfo(msg){
    if (!els.resultsInfo) return;
    els.resultsInfo.textContent = msg || "—";
  },

  // URL state (PC-first, helpers always on)
  readFiltersFromURL(){
    const u = new URL(location.href);
    const dia  = u.searchParams.get("dia");
    const cm   = u.searchParams.get("color");
    const fs   = u.searchParams.get("fs");
    const view = u.searchParams.get("view"); // "grid" | "list"

    if (dia) state.activeDay = utils.canonDay(dia);
    if (cm === "age") state.colorMode = "age";
    if (cm === "area") state.colorMode = "area";
    if (fs === "1") state.fullscreenOn = true;

    // Helpers SIEMPRE activos (ignora URL)
    state.helpersOn = true;

    state.activeView = (view === "list") ? "list" : "grid";

    const q     = u.searchParams.get("q");
    const clase = u.searchParams.get("clase");
    const edad  = u.searchParams.get("edad");
    const gid   = u.searchParams.get("grupo");

    if (els.search && q != null) els.search.value = q;
    if (els.fClase && clase != null) els.fClase.value = clase;
    if (els.fEdad && edad != null) els.fEdad.value = edad;
    if (els.groupSelect && gid != null) els.groupSelect.value = gid;
  },

  writeFiltersToURL(){
    const u = new URL(location.href);

    const q     = (els.search?.value ?? "").toString();
    const clase = (els.fClase?.value ?? "").toString();
    const edad  = (els.fEdad?.value ?? "").toString();
    const gid   = (els.groupSelect?.value ?? "").toString();

    u.searchParams.set("dia", state.activeDay);
    u.searchParams.set("color", state.colorMode === "age" ? "age" : "area");
    u.searchParams.set("fs", state.fullscreenOn ? "1" : "0");
    u.searchParams.set("view", state.activeView === "list" ? "list" : "grid");

    if (q) u.searchParams.set("q", q); else u.searchParams.delete("q");
    if (clase) u.searchParams.set("clase", clase); else u.searchParams.delete("clase");
    if (edad) u.searchParams.set("edad", edad); else u.searchParams.delete("edad");
    if (gid) u.searchParams.set("grupo", gid); else u.searchParams.delete("grupo");

    history.replaceState(null, "", u.toString());
  },

  // Errores Firestore legibles
  formatFirestoreErr(err){
    const code = (err?.code || "").toString();
    const msg  = (err?.message || "").toString();

    if (code.includes("permission-denied")){
      return "Firestore bloqueó la escritura: permission-denied (Rules/Auth).";
    }
    if (code.includes("unauthenticated")){
      return "Firestore exige autenticación: unauthenticated.";
    }
    if (code.includes("not-found")){
      return "Documento no encontrado: not-found.";
    }
    if (code.includes("failed-precondition")){
      return "Firestore: failed-precondition (índices / estado / precondición).";
    }
    if (code.includes("invalid-argument")){
      return `Firestore: invalid-argument${msg ? " · " + msg : ""}`;
    }
    return `${code || "firestore-error"}${msg ? " · " + msg : ""}`.trim();
  }
};

/* =========================
   TOAST
========================= */
function toast(msg, type=""){
  const el = els.toast;
  if (!el) return;
  el.textContent = msg;

  // types esperados por CSS: toast-warn / toast-danger
  const cls = ["toast", "show"];
  if (type) cls.push(`toast-${type}`);

  el.className = cls.join(" ");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.className = "toast";
    el.textContent = "";
  }, 2600);
}

/* =========================
   QUICK SANITY
========================= */
function sanityBoot(){
  // Setea variables CSS útiles (rooms) si el CSS las usa
  try{
    document.documentElement.style.setProperty("--rooms", String(ROOMS.length));
  }catch(_){}

  if (!els.gridWrap) {
    console.warn("[horarios] Falta #grid-wrap. El fullscreen nativo/UI puede comportarse raro.");
  }
  if (!els.grid && !els.list){
    console.warn("[horarios] No se encontró schedule-grid ni schedule-list. Revisa IDs en HTML.");
  }
}

/* =========================
   Scroll helper (PC-first)
   - Captura wheel/trackpad y SIEMPRE scrollea .schedule-scroll
========================= */
function wireWheelToBoardScroll(){
  const isEditable = (el) => {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  };

  const getScroller = () =>
    document.querySelector(".schedule-scroll") ||
    els.gridWrap?.querySelector?.(".schedule-scroll") ||
    null;

  document.addEventListener("wheel", (e) => {
    // ctrl+wheel = zoom del browser, no lo tocamos
    if (e.ctrlKey) return;

    // no joder inputs/modals
    if (isEditable(e.target)) return;
    if (e.target?.closest?.("#modal")) return;

    const scroller = getScroller();
    if (!scroller) return;

    // Capturamos SIEMPRE y scrolleamos manualmente
    e.preventDefault();

    const dy = e.deltaY || 0;
    const dx = e.deltaX || 0;

    scroller.scrollTop  += dy;
    scroller.scrollLeft += dx;
  }, { passive:false });
}

/* =========================
   Day tabs UI
========================= */
function renderDayTabs(api){
  if (!els.dayTabs) return;

  els.dayTabs.innerHTML = "";
  const frag = document.createDocumentFragment();

  DAYS.forEach(d => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "day-tab";
    b.setAttribute("role","tab");
    b.setAttribute("aria-selected", d === state.activeDay ? "true" : "false");
    b.textContent = d;

    b.addEventListener("click", () => {
      // ✅ FIX: siempre pasar el día al core si existe
      if (api?.syncDayUI){
        api.syncDayUI(d);
      } else {
        state.activeDay = d;
        utils.writeFiltersToURL();
        api?.applyFiltersAndRender?.({ force:true });
      }
      syncDayTabsUI();
    });

    frag.appendChild(b);
  });

  els.dayTabs.appendChild(frag);
}

function syncDayTabsUI(){
  if (!els.dayTabs) return;

  [...els.dayTabs.querySelectorAll(".day-tab")].forEach(btn => {
    const isActive = utils.normalize(btn.textContent) === utils.normalize(state.activeDay);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
    btn.classList.toggle("is-active", isActive);
  });
}

/* =========================
   Vista (Tablero / Lista)
========================= */
function applyViewUI(api, mode, opts={ silent:false }){
  state.activeView = (mode === "list") ? "list" : "grid";

  if (els.viewGrid) els.viewGrid.checked = state.activeView === "grid";
  if (els.viewList) els.viewList.checked = state.activeView === "list";

  if (els.grid) els.grid.classList.toggle("hidden", state.activeView !== "grid");
  if (els.list) els.list.classList.toggle("hidden", state.activeView !== "list");

  utils.writeFiltersToURL();

  api?.showOnly?.(state.activeView);
  api?.applyFiltersAndRender?.({ force:true });

  if (!opts.silent && state.activeView === "list" && els.list){
    const empty = !els.list.innerHTML.trim();
    if (empty && !state._warnedListOnce){
      state._warnedListOnce = true;
      toast("Vista Lista activada. (Si no ves nada, falta render de lista en el core).", "warn");
    }
  }
}

/* =========================
   Fullscreen (UI) + native fullscreen (cross-browser)
========================= */
function applyFullscreenUI(on){
  state.fullscreenOn = !!on;
  document.body.classList.toggle("fullscreen-board", state.fullscreenOn);

  if (els.btnFullscreen){
    els.btnFullscreen.textContent = state.fullscreenOn ? "Salir" : "Pantalla completa";
    els.btnFullscreen.setAttribute("aria-pressed", state.fullscreenOn ? "true" : "false");
    els.btnFullscreen.title = state.fullscreenOn
      ? "Salir de pantalla completa"
      : "Ver solo el tablero en pantalla completa";
  }

  utils.writeFiltersToURL();
}

function isNativeFullscreenEnabled(){
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
}
function getNativeFullscreenElement(){
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}

async function tryNativeFullscreen(on){
  if (!isNativeFullscreenEnabled()) return;

  const target =
    els.gridWrap ||
    document.getElementById("grid-wrap") ||
    document.documentElement;

  try{
    if (on){
      if (!getNativeFullscreenElement()){
        const req = target.requestFullscreen || target.webkitRequestFullscreen;
        if (req) await req.call(target);
      }
    } else {
      if (getNativeFullscreenElement()){
        const exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) await exit.call(document);
      }
    }
  }catch(err){
    log("native fullscreen failed:", err);
  }
}

function wireFullscreen(){
  if (!els.btnFullscreen) return;

  els.btnFullscreen.addEventListener("click", async () => {
    const next = !state.fullscreenOn;
    applyFullscreenUI(next);
    await tryNativeFullscreen(next);
  });

  const onFsChange = () => {
    const isFs = !!getNativeFullscreenElement();
    // Si salieron del fullscreen nativo (esc, ui del browser), apaga UI fullscreen
    if (!isFs && state.fullscreenOn){
      applyFullscreenUI(false);
    }
  };

  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (state.fullscreenOn){
      applyFullscreenUI(false);
      tryNativeFullscreen(false);
    }
  });
}

/* =========================
   Body classes sync
========================= */
function applyBodyModeClasses(){
  // Helpers SIEMPRE true
  state.helpersOn = true;
  document.body.classList.toggle("helpers-on", true);
  document.body.classList.toggle("color-mode-area", state.colorMode !== "age");
  document.body.classList.toggle("color-mode-age", state.colorMode === "age");
}

/* =========================
   CORE CONTEXT
========================= */
const ctx = {
  els,
  state,
  utils,
  toast,

  db,
  GROUPS_COLLECTION,
  fs: {
    collection,
    onSnapshot,
    query,
    addDoc,
    updateDoc,
    deleteDoc,
    doc,
    serverTimestamp,
    setDoc,
  },

  DAYS,
  ROOMS,
  PEAK_HOURS,
  BASE_SLOTS,

  // Permisos: modo sin-login. La UI edita; Firestore podría bloquear por Rules.
  perms: {
    canEdit: () => true,
    refreshAdminUI: () => {},
    explainNoPerm: () => toast("Edición deshabilitada.", "warn"),
    explainFirestoreErr: (err) => {
      const pretty = utils.formatFirestoreErr(err);
      console.error("[Firestore]", err);
      toast(pretty, "danger");
    },
    normalizeEmail: (x) => (x ?? "").toString().trim().toLowerCase(),
  }
};

const api = initCore(ctx);

/* =============================================================================
   CHOQUES (UI): BLOQUEO TOTAL
   - Si el usuario intenta “crear” en una celda que ya tiene bloques, se frena.
   - No afecta click sobre un bloque (eso es editar).
============================================================================= */
function wireCollisionBlocker(){
  if (ALLOW_COLLISIONS_WITH_CONFIRM) return;

  const gridEl = els.grid || document.getElementById("schedule-grid");
  if (!gridEl) return;

  const getCell = (target) => (
    target.closest?.(".sg-cell-slot") ||
    target.closest?.(".sg-cell") ||
    target.closest?.("[data-room][data-time]") ||
    null
  );

  document.addEventListener("click", (e) => {
    // Solo dentro del tablero
    if (!gridEl.contains(e.target)) return;
    if (e.target?.closest?.("#modal")) return;

    // Si clickea un bloque: editar, no estorbamos
    if (e.target?.closest?.(".sg-block")) return;

    const cell = getCell(e.target);
    if (!cell) return;

    const room = cell.dataset?.room;
    const time = cell.dataset?.time;
    if (!room || !time) return;

    // ¿Hay ya bloque(s) en esa celda?
    const hasBlock = !!cell.querySelector(".sg-block");
    if (!hasBlock) return;

    // Bloquear creación encima
    e.stopPropagation();
    e.preventDefault();

    const day = state.activeDay || "—";
    toast(`🚫 Ocupado: ${day} ${time} en ${room}`, "danger");
  }, true); // capture: nos adelantamos al handler del core
}

/* =========================
   EVENTS
========================= */
function wireEvents(){
  // Reload
  els.btnReload?.addEventListener("click", () => api?.reload?.({ force:true }));

  // Export / Import JSON (backup)
  els.btnExport?.addEventListener("click", () => api?.exportBackup?.());
  els.btnImport?.addEventListener("click", () => els.fileImport?.click());
  els.fileImport?.addEventListener("change", (e) => api?.importBackupFromFile?.(e));

  // Filters
  const apply = () => {
    utils.writeFiltersToURL();
    api?.applyFiltersAndRender?.({ force:true });
  };
  const applySearch = utils.debounce(apply, 140);

  els.groupSelect?.addEventListener("change", apply);
  els.search?.addEventListener("input", applySearch);
  els.fClase?.addEventListener("change", apply);
  els.fEdad?.addEventListener("change", apply);

  // Color toggles
  els.colorByArea?.addEventListener("change", () => {
    if (!els.colorByArea.checked) return;
    state.colorMode = "area";
    applyBodyModeClasses();
    utils.writeFiltersToURL();
    api?.applyFiltersAndRender?.({ force:true });
  });

  els.colorByAge?.addEventListener("change", () => {
    if (!els.colorByAge.checked) return;
    state.colorMode = "age";
    applyBodyModeClasses();
    utils.writeFiltersToURL();
    api?.applyFiltersAndRender?.({ force:true });
  });

  // Vista (radios)
  els.viewGrid?.addEventListener("change", () => {
    if (els.viewGrid.checked) applyViewUI(api, "grid");
  });
  els.viewList?.addEventListener("change", () => {
    if (els.viewList.checked) applyViewUI(api, "list");
  });

  // Clear filters
  els.btnClear?.addEventListener("click", () => {
    if (els.search) els.search.value = "";
    if (els.fClase) els.fClase.value = "";
    if (els.fEdad) els.fEdad.value = "";
    if (els.groupSelect) els.groupSelect.value = "";
    utils.writeFiltersToURL();
    api?.applyFiltersAndRender?.({ force:true });
  });

  // Errores globales para no “morir en silencio”
  window.addEventListener("error", (e) => {
    console.error("[window.error]", e?.error || e);
    if (DEBUG) toast("Error JS (mira consola).", "danger");
  });
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[unhandledrejection]", e?.reason || e);
    if (DEBUG) toast("Promesa rechazada (mira consola).", "danger");
  });
}

/* =========================
   INIT
========================= */
function init(){
  if (state._booted) return;
  state._booted = true;

  sanityBoot();

  utils.setInfo("Cargando…");
  utils.readFiltersFromURL();

  // Sync color radios
  if (state.colorMode === "age"){
    if (els.colorByAge) els.colorByAge.checked = true;
  } else {
    if (els.colorByArea) els.colorByArea.checked = true;
  }

  // Helpers SIEMPRE true + body classes
  state.helpersOn = true;
  applyBodyModeClasses();

  // Tabs día
  renderDayTabs(api);
  syncDayTabsUI();

  // Vista inicial (sin doble toast)
  applyViewUI(api, state.activeView, { silent:true });

  // Events + fullscreen + wheel
  wireEvents();
  wireFullscreen();
  wireWheelToBoardScroll();

  // ✅ Bloqueo de choques (UI)
  wireCollisionBlocker();

  // Render inicial (carga Firestore)
  api?.reload?.({ force:true });

  // Fijar día actual
  if (api?.syncDayUI){
    api.syncDayUI(state.activeDay);
  } else {
    api?.applyFiltersAndRender?.({ force:true });
  }

  // Fullscreen por URL
  if (state.fullscreenOn){
    applyFullscreenUI(true);
    tryNativeFullscreen(true);
  }

  if (!DEBUG){
    log("Tip: agrega ?debug=1 para ver más toasts de errores.");
  }
}

init();
