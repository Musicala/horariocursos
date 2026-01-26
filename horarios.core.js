// horarios.core.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala — Core (Split PRO balanced)
// - Firestore + hydration + filters + views + renders + analytics + modal + CRUD
// - Export/Import JSON (backup / restore) con upsert por ID
// - Perf: menos listeners repetidos, delegación en sesiones, fragments en renders
// - Robust: normalización day/room/time, filtros tolerantes, analytics más claros
// ------------------------------------------------------------

'use strict';

export function initCore(ctx){
  const { els, state, utils, toast, perms } = ctx;
  const { DAYS, ROOMS, PEAK_HOURS, BASE_SLOTS } = ctx;

  const CORE_VERSION = "core.v4.2-export-import";

  /* =========================================================
     CONSTANTS / HELPERS
  ========================================================= */
  const VIEW_SET = new Set(["grid","list","dashboard","occupancy","conflicts","proposals"]);

  // Si quieres, estos colores deberían vivir en CSS variables, pero bueno.
  const AREA_COLORS = {
    music:  "#0C41C4",
    dance:  "#CE0071",
    theater:"#680DBF",
    arts:   "#220A63",
  };

  // Ajusta según tus “edades” reales (son keys exactos)
  const AGE_COLORS = {
    Musibabies:   "#0C41C4",
    Musicalitos:  "#5729FF",
    Musikids:     "#680DBF",
    Musiteens:    "#CE0071",
    Musigrandes:  "#220A63",
    Musiadultos:  "#0C0A1E",
  };

  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);

  function safeSetLS(k, v){
    try{ localStorage.setItem(k, v); }catch(_){}
  }
  function safeGetLS(k){
    try{ return localStorage.getItem(k); }catch(_){ return null; }
  }

  function hexToRGBA(hex, a){
    const h = (hex || "").replace("#","").trim();
    if (h.length !== 6) return `rgba(17,24,39,${a})`;
    const r = parseInt(h.slice(0,2),16);
    const g = parseInt(h.slice(2,4),16);
    const b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function bandForTime(hhmm){
    const m = utils.safeTimeToMinutes(hhmm);
    if (m < 12*60) return "Mañana";
    if (m < 16*60) return "Mediodía";
    if (m < 20*60) return "Tarde";
    return "Noche";
  }

  function toneClassForGroup(g){
    // Detecta "área" por clase/enfoque, tolerancia humana
    const raw = `${g?.clase ?? ""} ${g?.enfoque ?? ""}`.toLowerCase();
    const n = utils.normalize(raw);

    if (n.includes("danza") || n.includes("ballet") || n.includes("hip hop") || n.includes("baile")) return "dance";
    if (n.includes("teatro") || n.includes("actu") || n.includes("escena")) return "theater";
    if (n.includes("arte") || n.includes("plastica") || n.includes("pint") || n.includes("dibu")) return "arts";
    return "music";
  }

  function ageKey(g){
    return (g?.edad ?? "").toString().trim();
  }

  function normalizeSessions(sessions){
    const arr = Array.isArray(sessions) ? sessions : [];
    return arr
      .map(s => ({
        day:  utils.canonDay((s?.day ?? "").trim()),
        time: utils.normalizeHHMM(s?.time ?? ""),
        room: utils.canonRoom((s?.room ?? "").trim()),
      }))
      .filter(s => s.day && s.time && s.room && DAYS.includes(s.day))
      .sort(utils.compareSessions);
  }

  function hydrateGroup(raw){
    const g = { ...raw };

    g.clase   = (g.clase ?? "").toString().trim();
    g.edad    = (g.edad ?? "").toString().trim();
    g.enfoque = (g.enfoque ?? "").toString().trim();
    g.nivel   = (g.nivel ?? "").toString().trim();

    g.__sessions = normalizeSessions(g.sessions);

    const ds = new Set();
    for (const s of g.__sessions) ds.add(s.day);
    g.__days = ds;

    g.__tone   = toneClassForGroup(g);
    g.__ageKey = ageKey(g);

    // Cupos normalizados (acepta variantes)
    g.__cupoMax = utils.clampInt(g?.cupoMax ?? g?.cupo_max ?? 0, 0);
    g.__cupoOcu = utils.clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);

    // Búsqueda normalizada
    g.__search = utils.normalize([
      g.clase, g.edad, g.enfoque, g.nivel,
      (g.docente ?? ""), (g.salon ?? "")
    ].filter(Boolean).join(" "));

    return g;
  }

  function applyBlockColors(blockEl, g){
    const tone = g.__tone || toneClassForGroup(g);
    const age  = g.__ageKey || ageKey(g);

    const areaHex = AREA_COLORS[tone] || "#0C41C4";
    const ageHex  = AGE_COLORS[age]   || "#0C41C4";

    blockEl.dataset.tone = tone;
    if (age) blockEl.dataset.age = age;

    const hex = (state.colorMode === "area") ? areaHex : ageHex;

    blockEl.style.borderColor = hexToRGBA(hex, 0.55);
    blockEl.style.background  = `linear-gradient(180deg, ${hexToRGBA(hex, 0.12)}, rgba(255,255,255,0.92))`;
  }

  /* =========================================================
     FIRESTORE
  ========================================================= */
  function subscribeGroupsOnce(){
    if (state.unsubscribeGroups){
      state.unsubscribeGroups();
      state.unsubscribeGroups = null;
    }

    utils.setInfo("Cargando horarios…");

    try{
      const qy = ctx.fs.query(ctx.fs.collection(ctx.db, ctx.GROUPS_COLLECTION));

      state.unsubscribeGroups = ctx.fs.onSnapshot(
        qy,
        (snap) => {
          const arr = [];
          snap.forEach(d => arr.push(hydrateGroup({ id: d.id, ...d.data() })));
          state.allGroups = arr;

          fillFilterOptionsFromData(state.allGroups);
          applyFiltersAndRender();

          if (arr.length === 0){
            utils.setInfo("No hay grupos en Firestore todavía (colección 'groups' vacía).");
          }
        },
        (err) => {
          console.error(err);
          utils.setInfo("No se pudieron cargar los horarios.");
          toast("Firestore bloqueó la lectura (Rules) o no hay conexión.");
        }
      );
    }catch(err){
      console.error(err);
      utils.setInfo("Error conectando a Firestore.");
      toast("Error conectando a Firestore. Revisa firebase.js / rutas.");
    }
  }

  /* =========================================================
     FILTER OPTIONS
  ========================================================= */
  function rebuildSelectOptions(selectEl, values, { keepFirstEmpty=true } = {}){
    if (!selectEl) return;

    const prev = (selectEl.value ?? "").toString();
    const firstOpt = keepFirstEmpty ? selectEl.options?.[0] : null;

    selectEl.innerHTML = "";

    if (keepFirstEmpty){
      const opt = document.createElement("option");
      opt.value = firstOpt?.value ?? "";
      opt.textContent = firstOpt?.textContent ?? "Todos";
      selectEl.appendChild(opt);
    }

    for (const v of values){
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = v;
      selectEl.appendChild(opt);
    }

    const exists = Array.from(selectEl.options).some(o => o.value === prev);
    if (exists) selectEl.value = prev;
  }

  function fillFilterOptionsFromData(groups){
    const clases = new Set();
    const edades = new Set();
    const dias   = new Set();

    for (const g of groups){
      if (g?.clase) clases.add(g.clase);
      if (g?.edad)  edades.add(g.edad);
      for (const d of (g.__days || [])) dias.add(d);
    }

    const clasesArr = Array.from(clases).sort((a,b)=>a.localeCompare(b,"es"));
    const edadesArr = Array.from(edades).sort((a,b)=>a.localeCompare(b,"es"));
    const diasArr   = Array.from(dias).sort((a,b)=>DAYS.indexOf(a)-DAYS.indexOf(b));

    rebuildSelectOptions(els.fClase, clasesArr, { keepFirstEmpty:true });
    rebuildSelectOptions(els.fEdad,  edadesArr, { keepFirstEmpty:true });
    rebuildSelectOptions(els.fDia,   diasArr,   { keepFirstEmpty:true });
  }

  /* =========================================================
     FILTERING
  ========================================================= */
  function getFilterState(){
    return {
      search: utils.normalize(els.search?.value ?? ""),
      clase: (els.fClase?.value ?? "").trim(),
      edad:  (els.fEdad?.value ?? "").trim(),
      dia:   (els.fDia?.value ?? "").trim(),
    };
  }

  function groupMatches(g, f){
    if (f.clase && (g?.clase ?? "") !== f.clase) return false;
    if (f.edad  && (g?.edad  ?? "") !== f.edad)  return false;

    if (f.dia){
      const want = utils.canonDay(f.dia);
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
    state.filteredGroups = state.allGroups.filter(g => groupMatches(g, f));
  }

  /* =========================================================
     VIEW MODE + UI
  ========================================================= */
  function setPressed(btn, on){
    if (!btn) return;
    btn.classList.toggle("ghost", !on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function showOnly(mode){
    const showGrid = (mode === "grid");
    const showList = (mode === "list");
    const showAna  = (mode === "dashboard" || mode === "occupancy" || mode === "conflicts" || mode === "proposals");

    els.gridWrap?.classList.toggle("hidden", !showGrid);
    els.listWrap?.classList.toggle("hidden", !showList);
    els.analyticsWrap?.classList.toggle("hidden", !showAna);

    const showDaybar = (showGrid || showList);
    els.daybarWrap?.classList.toggle("hidden", !showDaybar);
    els.ageLegendWrap?.classList.toggle("hidden", !showDaybar);

    els.quickStatsWrap?.classList.toggle("hidden", showAna);
  }

  function setView(mode){
    const m = VIEW_SET.has(mode) ? mode : "grid";
    state.activeView = m;

    setPressed(els.btnViewGrid,       m === "grid");
    setPressed(els.btnViewList,       m === "list");
    setPressed(els.btnViewDashboard,  m === "dashboard");
    setPressed(els.btnViewOccupancy,  m === "occupancy");
    setPressed(els.btnViewConflicts,  m === "conflicts");
    setPressed(els.btnViewProposals,  m === "proposals");

    showOnly(m);

    if (m === "grid") renderGrid();
    else if (m === "list") renderList();
    else renderAnalytics(m);

    safeSetLS(ctx.LS_VIEW, m);
  }

  function initViewFromStorage(){
    const m = safeGetLS(ctx.LS_VIEW);
    if (m && VIEW_SET.has(m)) state.activeView = m;
  }

  /* =========================================================
     COLOR + HELPERS
  ========================================================= */
  function initUIModes(){
    const cm = safeGetLS(ctx.LS_COLOR_MODE);
    if (cm === "area" || cm === "age") state.colorMode = cm;

    if (els.colorByArea) els.colorByArea.checked = (state.colorMode === "area");
    if (els.colorByAge)  els.colorByAge.checked  = (state.colorMode === "age");

    const h = safeGetLS(ctx.LS_HELPERS);
    if (h === "0") state.helpersOn = false;

    const t = safeGetLS(ctx.LS_ANA_TAB);
    if (t) state.activeAnaTab = t;

    applyHelpersUI();
    applyColorModeUI();
    applyAnalyticsTabUI(state.activeAnaTab);
  }

  function applyColorModeUI(){
    document.body.classList.toggle("color-mode-area", state.colorMode === "area");
    document.body.classList.toggle("color-mode-age",  state.colorMode === "age");
    els.grid?.classList.toggle("color-mode-area", state.colorMode === "area");
    els.grid?.classList.toggle("color-mode-age",  state.colorMode === "age");
    safeSetLS(ctx.LS_COLOR_MODE, state.colorMode);
  }

  function applyHelpersUI(){
    document.body.classList.toggle("helpers-off", !state.helpersOn);
    if (els.btnToggleHelpers){
      els.btnToggleHelpers.setAttribute("aria-pressed", state.helpersOn ? "true" : "false");
      els.btnToggleHelpers.textContent = state.helpersOn ? "Ayudas" : "Ayudas (off)";
    }
    safeSetLS(ctx.LS_HELPERS, state.helpersOn ? "1" : "0");
  }

  /* =========================================================
     STATS / ALERTS
  ========================================================= */
  function sessionsForDay(groups, day){
    const out = [];
    const dayCanon = utils.canonDay(day);

    for (const g of groups){
      const sessions = g.__sessions || normalizeSessions(g?.sessions);
      for (const s of sessions){
        if (s.day !== dayCanon) continue;
        out.push({ group: g, day: dayCanon, time: s.time, room: s.room });
      }
    }

    out.sort((a,b) => utils.safeTimeToMinutes(a.time) - utils.safeTimeToMinutes(b.time));
    return out;
  }

  function computeStats(groups, day){
    const dayCanon = utils.canonDay(day);

    const out = {
      groupsCount: groups.length,
      sessionsCount: 0,
      roomsUsedCount: 0,
      byArea: { music:0, dance:0, theater:0, arts:0 },
      byAge: new Map(),
      collisionsCells: 0,
      conflictsExtras: 0,
      peakSessions: 0,
      cupoMaxSum: 0,
      cupoOcuSum: 0,
      notes: []
    };

    const roomsUsed = new Set();
    const occ = new Map(); // time__room -> count

    const groupsInDay = new Set();
    const daySessions = sessionsForDay(groups, dayCanon);
    for (const it of daySessions) groupsInDay.add(it.group?.id || it.group);

    for (const g of groups){
      const tone = g.__tone || toneClassForGroup(g);
      if (tone === "music") out.byArea.music++;
      else if (tone === "dance") out.byArea.dance++;
      else if (tone === "theater") out.byArea.theater++;
      else if (tone === "arts") out.byArea.arts++;

      const ak = g.__ageKey || ageKey(g);
      if (ak) out.byAge.set(ak, (out.byAge.get(ak) || 0) + 1);

      if (groupsInDay.has(g?.id || g)){
        out.cupoMaxSum += utils.clampInt(g.__cupoMax ?? 0, 0);
        out.cupoOcuSum += utils.clampInt(g.__cupoOcu ?? 0, 0);
      }
    }

    for (const it of daySessions){
      const time = it.time;
      const room = it.room;
      if (!time || !room) continue;

      out.sessionsCount++;
      roomsUsed.add(room);

      if (PEAK_HOURS.has(time)) out.peakSessions++;

      const k = `${time}__${room}`;
      occ.set(k, (occ.get(k) || 0) + 1);
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
    const st = computeStats(state.filteredGroups, state.activeDay);

    if (els.statTotalGroups)   els.statTotalGroups.textContent   = String(st.groupsCount);
    if (els.statTotalSessions) els.statTotalSessions.textContent = String(st.sessionsCount);
    if (els.statTotalRooms)    els.statTotalRooms.textContent    = String(st.roomsUsedCount);

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
      els.statsSubtitle.textContent =
        `Día: ${state.activeDay} · Sesiones: ${st.sessionsCount} · Choques: ${st.conflictsExtras}`;
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

  /* =========================================================
     DAY UI SYNC + TABS
  ========================================================= */
  function syncDayUI(newDay, { fromSelect=false } = {}){
    const d = utils.canonDay(newDay);
    if (!DAYS.includes(d)) return;

    state.activeDay = d;

    if (els.fDia){
      const cur = utils.canonDay(els.fDia.value || "");
      if (!fromSelect || cur !== d) els.fDia.value = d;
    }

    renderDayTabs();
    renderStats();

    if (state.activeView === "grid") renderGrid();
    else if (state.activeView === "list") renderList();
    else renderAnalytics(state.activeView);

    utils.writeFiltersToURL();
  }

  function renderDayTabs(){
    if (!els.dayTabs) return;
    els.dayTabs.innerHTML = "";

    const frag = document.createDocumentFragment();

    DAYS.forEach((day) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-tab" + (day === state.activeDay ? " active" : "");
      btn.textContent = day;
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", day === state.activeDay ? "true" : "false");
      btn.addEventListener("click", () => syncDayUI(day));
      frag.appendChild(btn);
    });

    els.dayTabs.appendChild(frag);
  }

  /* =========================================================
     RENDER GRID (ONE GRID)
  ========================================================= */
  function buildTimeSlots(daySessions){
    const set = new Set();
    for (const s of daySessions){
      if (s.time) set.add(s.time);
    }
    for (const t of BASE_SLOTS) set.add(t);

    const arr = Array.from(set);
    arr.sort((a,b) => utils.safeTimeToMinutes(a) - utils.safeTimeToMinutes(b));
    return arr;
  }

  function renderGrid(){
    if (!els.grid) return;

    const daySessions = sessionsForDay(state.filteredGroups, state.activeDay);
    const slots = buildTimeSlots(daySessions);

    // time__room -> items[]
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
      h.innerHTML = `
        <div class="room-title">${utils.htmlEscape(r.label)}</div>
        <div class="room-note">${utils.htmlEscape(r.note)}</div>
      `;
      board.appendChild(h);
    }

    // Rows
    for (let rowIdx=0; rowIdx<slots.length; rowIdx++){
      const time = slots[rowIdx];
      const zebra = (rowIdx % 2 === 0) ? "sg-row-even" : "sg-row-odd";
      const peak = state.helpersOn && PEAK_HOURS.has(time);

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
            if (!perms.canEdit()){
              perms.explainNoPerm("crear");
              return;
            }
            openModalNewAt(state.activeDay, time, r.key);
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

            const cupoMax = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
            const cupoOcu = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
            const cupoTxt = (cupoMax > 0) ? `${cupoOcu}/${cupoMax}` : "";

            const title = [g?.clase, edad, enfoque, nivel].filter(Boolean).join(" · ");

            const block = document.createElement("button");
            block.type = "button";

            const tone = g.__tone || toneClassForGroup(g);
            const ageClass = edad ? `age-${utils.normalize(edad).replace(/\s+/g,'-')}` : "";
            block.className = `sg-block ${tone} ${ageClass}`.trim();
            block.setAttribute("title", title);

            block.innerHTML = `
              <div class="sg-block-title">${utils.htmlEscape(enfoque || g?.clase || "Grupo")}</div>
              <div class="sg-block-meta">
                <span>${utils.htmlEscape(edad || "")}</span>
                ${cupoTxt ? `<span class="sg-chip">${utils.htmlEscape(cupoTxt)}</span>` : ""}
              </div>
            `;

            applyBlockColors(block, g);

            block.addEventListener("click", (e) => {
              e.stopPropagation();
              if (perms.canEdit()) openModalForGroup(g);
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

    utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${state.activeDay} · ${daySessions.length} sesión(es)`);
  }

  /* =========================================================
     RENDER LIST
  ========================================================= */
  function renderList(){
    if (!els.list) return;

    const daySessions = sessionsForDay(state.filteredGroups, state.activeDay);

    const items = daySessions.slice().sort((a,b) => {
      const t = utils.safeTimeToMinutes(a.time) - utils.safeTimeToMinutes(b.time);
      if (t !== 0) return t;
      return (a.room || "").localeCompare(b.room || "", "es");
    });

    if (!items.length){
      els.list.innerHTML = `
        <div class="list-empty">
          No hay sesiones para <strong>${utils.htmlEscape(state.activeDay)}</strong> con los filtros actuales.
        </div>
      `;
      utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${state.activeDay} · 0 sesión(es)`);
      return;
    }

    const byTime = new Map();
    for (const it of items){
      if (!byTime.has(it.time)) byTime.set(it.time, []);
      byTime.get(it.time).push(it);
    }

    const times = Array.from(byTime.keys()).sort((a,b)=>utils.safeTimeToMinutes(a)-utils.safeTimeToMinutes(b));
    const frag = document.createDocumentFragment();

    for (const time of times){
      const wrap = document.createElement("div");
      wrap.className = "list-time-block";

      const head = document.createElement("div");
      head.className = "list-time-head";
      head.innerHTML = `<div class="list-time">${utils.htmlEscape(time)}</div>`;
      wrap.appendChild(head);

      const rows = document.createElement("div");
      rows.className = "list-rows";

      const its = byTime.get(time) || [];
      its.sort((a,b) => (a.room || "").localeCompare(b.room || "", "es"));

      for (const it of its){
        const g = it.group;
        const tone = g.__tone || toneClassForGroup(g);
        const enfoque = (g?.enfoque ?? "").trim();
        const nivel  = (g?.nivel ?? "").trim();
        const edad   = (g?.edad ?? "").trim();
        const clase  = (g?.clase ?? "").trim();

        const cupoMax = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
        const cupoOcu = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
        const cupoTxt = (cupoMax > 0) ? `${cupoOcu}/${cupoMax}` : "";

        const row = document.createElement("button");
        row.type = "button";
        row.className = `list-row ${tone}`;
        row.title = [clase, edad, enfoque, nivel].filter(Boolean).join(" · ");

        row.innerHTML = `
          <div class="list-room">${utils.htmlEscape(it.room || "")}</div>
          <div class="list-main">
            <div class="list-title">${utils.htmlEscape(enfoque || clase || "Grupo")}</div>
            <div class="list-meta">
              <span>${utils.htmlEscape(clase || "")}</span>
              ${edad ? `<span>· ${utils.htmlEscape(edad)}</span>` : ""}
              ${nivel ? `<span>· ${utils.htmlEscape(nivel)}</span>` : ""}
            </div>
          </div>
          <div class="list-side">
            ${cupoTxt ? `<span class="sg-chip">${utils.htmlEscape(cupoTxt)}</span>` : ""}
          </div>
        `;

        row.addEventListener("click", () => {
          if (perms.canEdit()) openModalForGroup(g);
          else toast(row.title || "Grupo");
        });

        rows.appendChild(row);
      }

      wrap.appendChild(rows);
      frag.appendChild(wrap);
    }

    els.list.innerHTML = "";
    els.list.appendChild(frag);

    utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${state.activeDay} · ${daySessions.length} sesión(es)`);
  }

  /* =========================================================
     ANALYTICS
  ========================================================= */
  function applyAnalyticsTabUI(tab){
    state.activeAnaTab = tab || "dashboard";
    safeSetLS(ctx.LS_ANA_TAB, state.activeAnaTab);

    const setTab = (btn, isOn) => {
      if (!btn) return;
      btn.classList.toggle("ghost", !isOn);
      btn.setAttribute("aria-selected", isOn ? "true" : "false");
    };

    setTab(els.tabAnaDashboard, state.activeAnaTab === "dashboard");
    setTab(els.tabAnaEdad,      state.activeAnaTab === "edad");
    setTab(els.tabAnaSalon,     state.activeAnaTab === "salon");
    setTab(els.tabAnaArea,      state.activeAnaTab === "area");
    setTab(els.tabAnaFranja,    state.activeAnaTab === "franja");
  }

  function setKPI(idEl, v, subEl, sub){
    if (idEl) idEl.textContent = v;
    if (subEl && sub != null) subEl.textContent = sub;
  }

  function renderPillsFromMap(map, { max=12, labelPrefix="" } = {}){
    const entries = Array.from(map.entries()).sort((a,b)=>b[1]-a[1]).slice(0, max);
    if (!entries.length) return `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin datos para mostrar.</div>`;
    return `
      <div style="display:flex;flex-wrap:wrap;gap:8px;">
        ${entries.map(([k,v]) => `
          <span class="stat-pill" style="display:inline-flex;gap:8px;align-items:center;">
            <span class="dot-mini"></span>${utils.htmlEscape(labelPrefix ? `${labelPrefix}${k}` : k)}: ${v}
          </span>
        `).join("")}
      </div>
    `;
  }

  function computeAnalytics(groups, day){
    const st = computeStats(groups, day);
    const daySessions = sessionsForDay(groups, day);

    const byAgeSessions  = new Map();
    const byRoomSessions = new Map();
    const byAreaSessions = new Map();
    const byBandSessions = new Map();
    const collisions = [];

    const occMap = new Map(); // time__room -> items[]
    for (const it of daySessions){
      const g = it.group;
      const age  = g.__ageKey || ageKey(g) || "Sin edad";
      const room = it.room || "Sin salón";
      const area = g.__tone || toneClassForGroup(g);
      const band = bandForTime(it.time);

      byAgeSessions.set(age,   (byAgeSessions.get(age)   || 0) + 1);
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
    collisions.sort((a,b)=> b.count - a.count || utils.safeTimeToMinutes(a.time)-utils.safeTimeToMinutes(b.time));

    const ocu = st.cupoMaxSum > 0 ? (st.cupoOcuSum / Math.max(1, st.cupoMaxSum)) : null;

    return { st, daySessions, byAgeSessions, byRoomSessions, byAreaSessions, byBandSessions, collisions, ocu };
  }

  function renderAnalytics(mode){
    if (!els.analyticsWrap) return;

    const dayCanon = state.activeDay;
    const A = computeAnalytics(state.filteredGroups, dayCanon);

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

    setKPI(els.kpiGroups, String(A.st.groupsCount), els.kpiGroupsSub, "Activos según filtros");
    setKPI(els.kpiSessions, String(A.st.sessionsCount), els.kpiSessionsSub, `Sesiones en ${dayCanon}`);

    const occText = (A.ocu == null) ? "—" : `${utils.percent(A.ocu)}`;
    const occSub  = (A.ocu == null) ? "Sin cupos en datos" : `${A.st.cupoOcuSum}/${A.st.cupoMaxSum} cupos (en ${dayCanon})`;
    setKPI(els.kpiOccupancy, occText, els.kpiOccupancySub, occSub);

    setKPI(els.kpiCollisions, String(A.st.collisionsCells), els.kpiCollisionsSub, "Celdas con 2+ sesiones");

    // Reset containers
    const top    = els.anaTopContent;
    const bottom = els.anaBottomContent;
    const alerts = els.anaAlertsContent;

    if (top) top.innerHTML = "";
    if (bottom) bottom.innerHTML = "";
    if (alerts) alerts.innerHTML = "";

    // Alerts
    if (alerts){
      const notes = A.st.notes.slice(0, 6);
      alerts.innerHTML = notes.length
        ? `<div style="display:flex;flex-direction:column;gap:8px;">
             ${notes.map(n => `<div class="alert-row">${utils.htmlEscape(n)}</div>`).join("")}
           </div>`
        : `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin alertas por ahora. Milagro.</div>`;
    }

    const renderTabContent = (tab) => {
      if (!top || !bottom) return;

      if (tab === "edad"){
        els.anaTopTitle && (els.anaTopTitle.textContent = "Sesiones por edad");
        top.innerHTML = renderPillsFromMap(A.byAgeSessions, { max: 24 });

        els.anaBottomTitle && (els.anaBottomTitle.textContent = "Grupos por edad");
        const byAgeGroups = new Map();
        for (const g of state.filteredGroups){
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
        bottom.innerHTML = renderPillsFromMap(new Map([
          ["Música", A.st.byArea.music],
          ["Danza",  A.st.byArea.dance],
          ["Teatro", A.st.byArea.theater],
          ["Artes",  A.st.byArea.arts],
        ]), { max: 12 });
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
      const topAges  = Array.from(A.byAgeSessions.entries()).sort((a,b)=>b[1]-a[1]).slice(0, 6);
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

    // Conflicts view
    if (mode === "conflicts"){
      applyAnalyticsTabUI("dashboard");
      els.anaTopTitle && (els.anaTopTitle.textContent = "Celdas con choques");

      if (top){
        top.innerHTML = A.collisions.length
          ? `<div style="display:flex;flex-direction:column;gap:8px;">
              ${A.collisions.slice(0, 30).map(c => `
                <div class="alert-row" style="border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.08);color:rgba(127,29,29,.95);">
                  <strong>${utils.htmlEscape(c.time)} · ${utils.htmlEscape(c.room)}</strong> · ${c.count} sesiones
                </div>
              `).join("")}
             </div>`
          : `<div style="font-weight:800;color:rgba(107,114,128,.95);">
              No hay choques para ${utils.htmlEscape(dayCanon)} con estos filtros.
             </div>`;
      }

      if (bottom){
        els.anaBottomTitle && (els.anaBottomTitle.textContent = "Detalle (primer choque)");
        const first = A.collisions[0];
        bottom.innerHTML = first ? `
          <div class="stats-box">
            <h4>${utils.htmlEscape(first.time)} · ${utils.htmlEscape(first.room)}</h4>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${first.items.map(it => {
                const g = it.group;
                return `<div class="stat-pill" style="justify-content:space-between;">
                          <span>${utils.htmlEscape(g.enfoque || g.clase || "Grupo")}</span>
                          <span style="opacity:.85">${utils.htmlEscape(g.edad || "")}</span>
                        </div>`;
              }).join("")}
            </div>
          </div>
        ` : `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin detalle.</div>`;
      }

      utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${dayCanon} · choques: ${A.st.conflictsExtras}`);
      return;
    }

    // Proposals view
    if (mode === "proposals"){
      applyAnalyticsTabUI("dashboard");
      els.anaTopTitle && (els.anaTopTitle.textContent = "Huecos sugeridos");

      const daySessions = A.daySessions;
      const occ = new Set(daySessions.map(s => `${s.time}__${s.room}`));

      const slots = Array.from(new Set([...BASE_SLOTS, ...daySessions.map(s=>s.time)]))
        .sort((a,b)=>utils.safeTimeToMinutes(a)-utils.safeTimeToMinutes(b));

      const preferred = slots.some(t => PEAK_HOURS.has(t))
        ? slots.filter(t => PEAK_HOURS.has(t))
        : slots.slice(-4);

      const suggestions = [];
      for (const t of preferred){
        for (const r of ROOMS){
          const k = `${t}__${r.key}`;
          if (!occ.has(k)) suggestions.push({ time:t, room:r.key });
        }
      }

      if (top){
        top.innerHTML = suggestions.length
          ? `<div style="display:flex;flex-wrap:wrap;gap:8px;">
              ${suggestions.slice(0, 40).map(s => `
                <span class="stat-pill"><span class="dot-mini"></span>${utils.htmlEscape(s.time)} · ${utils.htmlEscape(s.room)}</span>
              `).join("")}
             </div>`
          : `<div style="font-weight:800;color:rgba(107,114,128,.95);">No hay huecos sugeridos (o todo está lleno). Bien.</div>`;
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

      utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${dayCanon} · propuestas: ${Math.min(40, suggestions.length)}`);
      return;
    }

    // Occupancy/dashboard (tabbed)
    if (!["dashboard","edad","salon","area","franja"].includes(state.activeAnaTab)) applyAnalyticsTabUI("dashboard");
    renderTabContent(state.activeAnaTab);

    utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${dayCanon} · sesiones: ${A.st.sessionsCount}`);
  }

  /* =========================================================
     APPLY FILTERS + RENDER
  ========================================================= */
  function applyFiltersAndRender(){
    applyFilters();

    renderDayTabs();
    renderStats();

    if (state.activeView === "grid") renderGrid();
    else if (state.activeView === "list") renderList();
    else renderAnalytics(state.activeView);

    applyColorModeUI();
    applyHelpersUI();
  }

  /* =========================================================
     MODAL (ADMIN)
  ========================================================= */
  function openModal(){
    state._lastFocus = document.activeElement;

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
    state.editingId = null;
    state.editingDraft = null;
    if (els.sessionsList) els.sessionsList.innerHTML = "";

    setTimeout(() => state._lastFocus?.focus?.(), 0);
  }

  function setModalTitle(t){
    if (els.modalTitle) els.modalTitle.textContent = t;
  }

  function writeDraftToModal(d){
    if (!d) return;
    if (els.mClase)   els.mClase.value = d.clase ?? "Música";
    if (els.mEdad)    els.mEdad.value = d.edad ?? "Musikids";
    if (els.mEnfoque) els.mEnfoque.value = d.enfoque ?? "";
    if (els.mNivel)   els.mNivel.value = d.nivel ?? "";
    if (els.mCupoMax) els.mCupoMax.value = String(utils.clampInt(d.cupoMax ?? 0, 0));
    if (els.mCupoOcu) els.mCupoOcu.value = String(utils.clampInt(d.cupoOcupado ?? 0, 0));
    if (els.mActivo)  els.mActivo.checked = (d.activo !== false);
  }

  function readDraftFromModal(){
    const d = state.editingDraft || {};
    d.clase = (els.mClase?.value ?? "").trim();
    d.edad  = (els.mEdad?.value ?? "").trim();
    d.enfoque = (els.mEnfoque?.value ?? "").trim();
    d.nivel   = (els.mNivel?.value ?? "").trim();
    d.cupoMax = utils.clampInt(els.mCupoMax?.value ?? 0, 0);
    d.cupoOcupado = utils.clampInt(els.mCupoOcu?.value ?? 0, 0);
    d.activo = !!els.mActivo?.checked;
    return d;
  }

  function ensureDraftSessions(){
    if (!state.editingDraft) state.editingDraft = {};
    state.editingDraft.sessions = normalizeSessions(state.editingDraft.sessions);
  }

  // Delegación: un solo listener para cambios/elim
  function wireSessionsListDelegationOnce(){
    if (!els.sessionsList || els.sessionsList.__wired) return;
    els.sessionsList.__wired = true;

    els.sessionsList.addEventListener("change", (e) => {
      const target = e.target;
      if (!target) return;

      const k = target.getAttribute("data-k");
      const i = utils.clampInt(target.getAttribute("data-i"), 0);
      if (!k) return;

      ensureDraftSessions();
      if (!state.editingDraft.sessions[i]) return;

      const v = (target.value ?? "").trim();

      if (k === "time") state.editingDraft.sessions[i][k] = utils.normalizeHHMM(v);
      else if (k === "day") state.editingDraft.sessions[i][k] = utils.canonDay(v);
      else if (k === "room") state.editingDraft.sessions[i][k] = utils.canonRoom(v);
      else state.editingDraft.sessions[i][k] = v;

      state.editingDraft.sessions = normalizeSessions(state.editingDraft.sessions);
      renderSessionsList();
    });

    els.sessionsList.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-del]");
      if (!btn) return;

      const i = utils.clampInt(btn.getAttribute("data-del"), 0);
      ensureDraftSessions();
      state.editingDraft.sessions.splice(i, 1);
      renderSessionsList();
    });
  }

  function renderSessionsList(){
    if (!els.sessionsList) return;
    wireSessionsListDelegationOnce();

    ensureDraftSessions();
    const sessions = state.editingDraft.sessions;

    els.sessionsList.innerHTML = "";

    const frag = document.createDocumentFragment();

    sessions.forEach((s, idx) => {
      const row = document.createElement("div");
      row.className = "session-row";

      row.innerHTML = `
        <div class="field">
          <label>Día</label>
          <select data-k="day" data-i="${idx}">
            ${DAYS.map(x => `<option ${x===s.day?"selected":""}>${utils.htmlEscape(x)}</option>`).join("")}
          </select>
        </div>

        <div class="field">
          <label>Hora</label>
          <input data-k="time" data-i="${idx}" value="${utils.htmlEscape(s.time)}" placeholder="16:00" />
        </div>

        <div class="field">
          <label>Salón</label>
          <select data-k="room" data-i="${idx}">
            ${ROOMS.map(r => `<option ${r.key===s.room?"selected":""}>${utils.htmlEscape(r.key)}</option>`).join("")}
          </select>
        </div>

        <button class="icon-btn danger" type="button" data-del="${idx}" aria-label="Quitar">✕</button>
      `;

      frag.appendChild(row);
    });

    els.sessionsList.appendChild(frag);
  }

  function openModalForGroup(g){
    state.editingId = g?.id ?? null;
    state.editingDraft = {
      clase: g?.clase ?? "Música",
      edad: g?.edad ?? "Musikids",
      enfoque: g?.enfoque ?? "",
      nivel: g?.nivel ?? "",
      cupoMax: g?.cupoMax ?? g?.cupo_max ?? g?.__cupoMax ?? 0,
      cupoOcupado: g?.cupoOcupado ?? g?.cupo_ocupado ?? g?.__cupoOcu ?? 0,
      activo: (g?.activo !== false),
      sessions: normalizeSessions(g?.sessions),
    };

    setModalTitle(state.editingId ? "Editar grupo" : "Nuevo grupo");
    writeDraftToModal(state.editingDraft);
    renderSessionsList();
    openModal();
  }

  function openModalNew(){
    openModalForGroup({ id:null });
    state.editingId = null;
  }

  function openModalNewAt(day, time, roomKey){
    openModalNew();
    ensureDraftSessions();
    state.editingDraft.sessions.push({
      day: utils.canonDay(day),
      time: utils.normalizeHHMM(time),
      room: utils.canonRoom(roomKey)
    });
    state.editingDraft.sessions = normalizeSessions(state.editingDraft.sessions);
    renderSessionsList();
  }

  function addSession(){
    ensureDraftSessions();
    state.editingDraft.sessions.push({
      day: utils.canonDay(state.activeDay),
      time: "16:00",
      room: ROOMS[0].key
    });
    state.editingDraft.sessions = normalizeSessions(state.editingDraft.sessions);
    renderSessionsList();
  }

  /* =========================================================
     SAVE / DELETE
  ========================================================= */
  function validateDraftBeforeSave(d){
    if (!d.clase) d.clase = "Música";
    if (!d.edad)  d.edad  = "Musikids";
    d.sessions = normalizeSessions(d.sessions);

    if (!d.sessions.length){
      toast("Agrega al menos una sesión (día/hora/salón).");
      return false;
    }
    return true;
  }

  async function saveGroup(){
    if (!perms.canEdit()){
      perms.explainNoPerm("guardar");
      return;
    }

    try{
      const d = readDraftFromModal();
      d.sessions = normalizeSessions(state.editingDraft?.sessions);
      d.updatedAt = ctx.fs.serverTimestamp();

      if (!validateDraftBeforeSave(d)) return;

      if (!state.editingId){
        d.createdAt = ctx.fs.serverTimestamp();
        await ctx.fs.addDoc(ctx.fs.collection(ctx.db, ctx.GROUPS_COLLECTION), d);
        toast("Grupo creado ✅");
      } else {
        await ctx.fs.updateDoc(ctx.fs.doc(ctx.db, ctx.GROUPS_COLLECTION, state.editingId), d);
        toast("Grupo guardado ✅");
      }

      closeModal();
    }catch(err){
      console.error(err);
      perms.explainFirestoreErr(err);
    }
  }

  async function deleteGroup(){
    if (!perms.canEdit()){
      perms.explainNoPerm("eliminar");
      return;
    }
    if (!state.editingId){
      toast("Este grupo no existe aún.");
      return;
    }
    const ok = confirm("¿Eliminar este grupo? Esto no se puede deshacer.");
    if (!ok) return;

    try{
      await ctx.fs.deleteDoc(ctx.fs.doc(ctx.db, ctx.GROUPS_COLLECTION, state.editingId));
      toast("Grupo eliminado ✅");
      closeModal();
    }catch(err){
      console.error(err);
      perms.explainFirestoreErr(err);
    }
  }

  /* =========================================================
     EXPORT JSON (Backup)
     - Exporta ALL GROUPS (no solo filtrados)
     - Limpia campos internos (__*)
  ========================================================= */
  function stripInternalFields(g){
    const out = {};
    for (const [k, v] of Object.entries(g || {})){
      if (k.startsWith("__")) continue;
      out[k] = v;
    }
    out.sessions = normalizeSessions(out.sessions);
    return out;
  }

  async function exportJSON(){
    try{
      const groups = (state.allGroups || []).map(stripInternalFields);

      const payload = {
        app: "Horarios Grupales · Musicala",
        core: CORE_VERSION,
        exportedAt: new Date().toISOString(),
        counts: {
          groups: groups.length,
          filtered: (state.filteredGroups || []).length,
        },
        active: {
          day: state.activeDay,
          view: state.activeView,
          colorMode: state.colorMode,
          helpersOn: !!state.helpersOn
        },
        filters: {
          search: (els.search?.value ?? ""),
          clase:  (els.fClase?.value ?? ""),
          edad:   (els.fEdad?.value ?? ""),
          dia:    (els.fDia?.value ?? "")
        },
        groups
      };

      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `horarios_backup_${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
      toast("Exportación lista ✅");
    }catch(err){
      console.error(err);
      toast("No se pudo exportar 😵");
    }
  }

  /* =========================================================
     IMPORT JSON (Restore)
     - Acepta payload con {groups:[...]} o array directo
     - Upsert por ID (setDoc) si viene g.id
     - Si no trae id: crea nuevo (addDoc)
     - En batchs pequeños para no reventar Firestore
  ========================================================= */
  async function importJSONFile(file){
    if (!perms.canEdit()){
      perms.explainNoPerm("importar");
      return;
    }
    if (!file){
      toast("No llegó archivo para importar.");
      return;
    }

    try{
      const text = await file.text();
      let data;
      try{
        data = JSON.parse(text);
      }catch(_){
        toast("Ese archivo no parece JSON válido.");
        return;
      }

      let groups = [];
      if (Array.isArray(data)) groups = data;
      else if (isObj(data) && Array.isArray(data.groups)) groups = data.groups;
      else {
        toast("JSON sin 'groups'. No sé qué querías que hiciera con eso.");
        return;
      }

      // Sanitiza: quitar __*, normalizar sessions, defaults
      const cleaned = groups
        .filter(isObj)
        .map(stripInternalFields)
        .map(g => ({
          ...g,
          clase: (g.clase ?? "Música").toString().trim() || "Música",
          edad:  (g.edad  ?? "Musikids").toString().trim() || "Musikids",
          enfoque: (g.enfoque ?? "").toString().trim(),
          nivel:   (g.nivel ?? "").toString().trim(),
          cupoMax: utils.clampInt(g.cupoMax ?? g.cupo_max ?? 0, 0),
          cupoOcupado: utils.clampInt(g.cupoOcupado ?? g.cupo_ocupado ?? 0, 0),
          activo: (g.activo !== false),
          sessions: normalizeSessions(g.sessions),
        }))
        .filter(g => Array.isArray(g.sessions) && g.sessions.length);

      if (!cleaned.length){
        toast("No hay grupos válidos para importar (¿sin sesiones?).");
        return;
      }

      const ok = confirm(
        `Vas a importar ${cleaned.length} grupo(s).\n` +
        `Esto puede sobrescribir IDs existentes si coinciden.\n\n` +
        `¿Continuar?`
      );
      if (!ok) return;

      // Batch seguro: 35 por tanda para no saturar (y que UI no muera)
      const CHUNK = 35;
      let upserts = 0;
      let creates = 0;

      utils.setInfo(`Importando ${cleaned.length}…`);

      for (let i=0; i<cleaned.length; i+=CHUNK){
        const chunk = cleaned.slice(i, i+CHUNK);

        // Importante: no guardar timestamps como strings raras.
        // Si existe createdAt/updatedAt en el JSON, lo dejamos como está (puede ser string).
        // Preferimos setear updatedAt a serverTimestamp para consistencia.
        const promises = chunk.map(async (g) => {
          const payload = {
            ...g,
            updatedAt: ctx.fs.serverTimestamp(),
          };

          // Si viene id, upsert por id
          if (g.id){
            const id = g.id;
            const ref = ctx.fs.doc(ctx.db, ctx.GROUPS_COLLECTION, id);
            await ctx.fs.setDoc(ref, payload, { merge: true });
            upserts++;
            return;
          }

          // Si no viene id: crear
          payload.createdAt = ctx.fs.serverTimestamp();
          await ctx.fs.addDoc(ctx.fs.collection(ctx.db, ctx.GROUPS_COLLECTION), payload);
          creates++;
        });

        await Promise.all(promises);
      }

      toast(`Importado ✅ Upsert: ${upserts} · Nuevos: ${creates}`);
      utils.setInfo(`Importado ✅ (${cleaned.length})`);

      // Refresca vista (snapshot debería actualizar solo, pero por UX)
      applyFiltersAndRender();
    }catch(err){
      console.error(err);
      perms.explainFirestoreErr?.(err);
      toast("Falló la importación. Mira consola.");
    }
  }

  /* =========================================================
     PUBLIC API
  ========================================================= */
  return {
    // init helpers
    initViewFromStorage,
    initUIModes,

    // firestore
    subscribeGroupsOnce,

    // view & renders
    setView,
    showOnly,
    renderGrid,
    renderList,
    renderAnalytics,

    // day UI
    renderDayTabs,
    syncDayUI,

    // analytics tabs
    applyAnalyticsTabUI,

    // ui modes
    applyColorModeUI,
    applyHelpersUI,

    // filter+render
    applyFiltersAndRender,

    // modal/crud
    openModalNew,
    openModalForGroup,
    openModalNewAt,
    openModal,
    closeModal,
    addSession,
    saveGroup,
    deleteGroup,

    // backup
    exportJSON,
    importJSONFile,
  };
}
