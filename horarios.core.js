// horarios.core.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala — Core (Simplificado PRO) v5.2
// - Firestore: subscribe groups, CRUD, upsert import
// - Vista: Grid / Lista (main.js controla UI; core renderiza según state.activeView)
// - Filtros: grupo, búsqueda, clase, edad
// - Modal: crear/editar/eliminar + sesiones (día/hora/salón)
// - Backup: export/import JSON
// - ✅ Anti-choques: valida ocupación global al guardar (día/hora/salón)
// - Perf: delegación de eventos en grid, fragments, renders limpios, render cache
// ------------------------------------------------------------

'use strict';

export function initCore(ctx){
  const { els, state, utils, toast, perms } = ctx;
  const { DAYS, ROOMS, PEAK_HOURS, BASE_SLOTS } = ctx;

  const CORE_VERSION = "core.v5.2-grid-list-modal-backup-anti-collisions";

  /* =========================================================
     CONSTANTS / HELPERS
  ========================================================= */
  const AREA_COLORS = {
    music:  "#0C41C4",
    dance:  "#CE0071",
    theater:"#680DBF",
    arts:   "#220A63",
  };

  const AGE_COLORS = {
    Musibabies:   "#0C41C4",
    Musicalitos:  "#5729FF",
    Musikids:     "#680DBF",
    Musiteens:    "#CE0071",
    Musigrandes:  "#220A63",
    Musiadultos:  "#0C0A1E",
  };

  function hexToRGBA(hex, a){
    const h = (hex || "").replace("#","").trim();
    if (h.length !== 6) return `rgba(17,24,39,${a})`;
    const r = parseInt(h.slice(0,2),16);
    const g = parseInt(h.slice(2,4),16);
    const b = parseInt(h.slice(4,6),16);
    return `rgba(${r},${g},${b},${a})`;
  }

  function toneClassForGroup(g){
    const raw = `${g?.clase ?? ""} ${g?.enfoque ?? ""}`.toLowerCase();
    const n = utils.normalize(raw);

    if (n.includes("danza") || n.includes("ballet") || n.includes("hip hop") || n.includes("baile")) return "dance";
    if (n.includes("teatro") || n.includes("actu") || n.includes("escena")) return "theater";
    if (n.includes("arte") || n.includes("plastica") || n.includes("plástica") || n.includes("pint") || n.includes("dibu")) return "arts";
    return "music";
  }

  function ageKey(g){
    return (g?.edad ?? "").toString().trim();
  }

  function normalizeSessions(sessions){
    const arr = Array.isArray(sessions) ? sessions : [];
    return arr
      .map(s => ({
        day:  utils.canonDay((s?.day ?? "").toString().trim()),
        time: utils.normalizeHHMM((s?.time ?? "").toString().trim()),
        room: utils.canonRoom((s?.room ?? "").toString().trim()),
      }))
      .filter(s => s.day && s.time && s.room && DAYS.includes(s.day))
      .sort(utils.compareSessions);
  }

  function hydrateGroup(raw){
    const g = { ...(raw || {}) };

    g.clase   = (g.clase ?? "").toString().trim();
    g.edad    = (g.edad ?? "").toString().trim();
    g.enfoque = (g.enfoque ?? "").toString().trim();
    g.nivel   = (g.nivel ?? "").toString().trim();

    g.__sessions = normalizeSessions(g.sessions);
    g.__tone     = toneClassForGroup(g);
    g.__ageKey   = ageKey(g);

    g.__cupoMax = utils.clampInt(g?.cupoMax ?? g?.cupo_max ?? 0, 0);
    g.__cupoOcu = utils.clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);

    g.__search = utils.normalize([
      g.clase, g.edad, g.enfoque, g.nivel,
      (g.docente ?? ""), (g.notas ?? "")
    ].filter(Boolean).join(" "));

    return g;
  }

  function applyBlockColors(blockEl, g){
    if (!blockEl || !g) return;

    const tone = g.__tone || toneClassForGroup(g);
    const age  = g.__ageKey || ageKey(g);

    const areaHex = AREA_COLORS[tone] || "#0C41C4";
    const ageHex  = AGE_COLORS[age]   || "#0C41C4";

    blockEl.dataset.tone = tone;
    if (age) blockEl.dataset.age = age;

    const hex = (state.colorMode === "area") ? areaHex : ageHex;

    blockEl.style.borderColor = hexToRGBA(hex, 0.55);
    blockEl.style.background  = `linear-gradient(180deg, ${hexToRGBA(hex, 0.12)}, rgba(255,255,255,0.94))`;
  }

  function safeElSetText(el, txt){
    if (!el) return;
    el.textContent = txt ?? "";
  }

  /* =========================================================
     RENDER CACHE (simple)
  ========================================================= */
  const renderCache = {
    key: "",
    reset(){ this.key = ""; }
  };

  function computeKey(){
    const q = utils.normalize(els.search?.value ?? "");
    const clase = (els.fClase?.value ?? "").trim();
    const edad  = (els.fEdad?.value ?? "").trim();
    const gid   = (els.groupSelect?.value ?? "").trim();

    // Ojo: no dependas de filteredGroups length, eso cambia dentro del render.
    return [
      state.activeDay,
      state.activeView,
      state.colorMode,
      state.helpersOn ? "H1" : "H0",
      q, clase, edad, gid,
      (state.allGroups?.length ?? 0),
    ].join("::");
  }

  /* =========================================================
     FIRESTORE
  ========================================================= */
  function subscribeGroupsOnce(){
    if (state.unsubscribeGroups){
      try{ state.unsubscribeGroups(); }catch(_){}
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

          syncGroupSelectOptions();
          fillFilterOptionsFromData(arr);

          applyFiltersAndRender({ force:true });

          if (arr.length === 0){
            utils.setInfo("No hay grupos en Firestore todavía (colección 'groups' vacía).");
          }
        },
        (err) => {
          console.error(err);
          utils.setInfo("No se pudieron cargar los horarios.");
          toast("Firestore bloqueó la lectura (Rules) o no hay conexión.", "warn");
        }
      );
    }catch(err){
      console.error(err);
      utils.setInfo("Error conectando a Firestore.");
      toast("Error conectando a Firestore. Revisa firebase.js / rutas.", "danger");
    }
  }

  async function reload({ force=false } = {}){
    if (force) renderCache.reset();
    subscribeGroupsOnce();
  }

  function onAuthChanged(){
    // Hoy no hay auth, pero se deja por compatibilidad
  }

  /* =========================================================
     FILTER OPTIONS
  ========================================================= */
  function rebuildSelectOptions(selectEl, values, { keepFirstEmpty=true, firstLabel="Todos" } = {}){
    if (!selectEl) return;

    const prev = (selectEl.value ?? "").toString();

    let html = "";
    if (keepFirstEmpty){
      html += `<option value="">${utils.htmlEscape(firstLabel)}</option>`;
    }
    for (const v of values){
      html += `<option value="${utils.htmlEscape(v)}">${utils.htmlEscape(v)}</option>`;
    }
    selectEl.innerHTML = html;

    const exists = Array.from(selectEl.options).some(o => o.value === prev);
    if (exists) selectEl.value = prev;
  }

  function fillFilterOptionsFromData(groups){
    const clases = new Set();
    const edades = new Set();

    for (const g of groups){
      if (g?.clase) clases.add(g.clase);
      if (g?.edad)  edades.add(g.edad);
    }

    const clasesArr = Array.from(clases).sort((a,b)=>a.localeCompare(b,"es"));
    const edadesArr = Array.from(edades).sort((a,b)=>a.localeCompare(b,"es"));

    rebuildSelectOptions(els.fClase, clasesArr, { keepFirstEmpty:true, firstLabel:"Todas las clases" });
    rebuildSelectOptions(els.fEdad,  edadesArr, { keepFirstEmpty:true, firstLabel:"Todas las edades" });
  }

  function syncGroupSelectOptions(){
    const sel = els.groupSelect;
    if (!sel) return;

    const groups = state.allGroups || [];
    const current = (sel.value ?? "").toString();

    const frag = document.createDocumentFragment();
    const first = document.createElement("option");
    first.value = "";
    first.textContent = "Todos los grupos";
    frag.appendChild(first);

    groups
      .slice()
      .sort((a,b) => {
        const aa = [a?.enfoque, a?.edad, a?.clase].filter(Boolean).join(" · ");
        const bb = [b?.enfoque, b?.edad, b?.clase].filter(Boolean).join(" · ");
        return aa.localeCompare(bb, "es");
      })
      .forEach(g => {
        const o = document.createElement("option");
        o.value = g.id;
        const label = [g.enfoque, g.edad, g.clase].filter(Boolean).join(" · ");
        o.textContent = label || g.id;
        frag.appendChild(o);
      });

    sel.innerHTML = "";
    sel.appendChild(frag);

    if (current && groups.some(g => g.id === current)) sel.value = current;
  }

  /* =========================================================
     FILTERING
  ========================================================= */
  function getFilterState(){
    return {
      search: utils.normalize(els.search?.value ?? ""),
      clase: (els.fClase?.value ?? "").trim(),
      edad:  (els.fEdad?.value ?? "").trim(),
      groupId: (els.groupSelect?.value ?? "").trim(),
    };
  }

  function groupMatches(g, f){
    if (!g) return false;
    if (f.groupId && (g?.id ?? "") !== f.groupId) return false;
    if (f.clase && (g?.clase ?? "") !== f.clase) return false;
    if (f.edad  && (g?.edad  ?? "") !== f.edad)  return false;

    if (f.search){
      const hay = g?.__search ?? "";
      if (!hay.includes(f.search)) return false;
    }
    return true;
  }

  function applyFilters(){
    const f = getFilterState();
    const all = state.allGroups || [];
    state.filteredGroups = all.filter(g => groupMatches(g, f));
  }

  /* =========================================================
     COLLISION CHECK (GLOBAL) — ✅ CLAVE
     - Revisa si alguna sesión del payload choca con sesiones de otros grupos
     - Excluye el mismo grupo si estamos editando (sameId)
  ========================================================= */
  function buildGlobalOccupancyIndex(groups, { excludeId=null } = {}){
    const occ = new Map(); // key -> { groupId, label }
    for (const g0 of (groups || [])){
      const g = hydrateGroup(g0);
      const gid = g?.id || "";
      if (excludeId && gid === excludeId) continue;

      const label = [g.enfoque, g.edad, g.clase].filter(Boolean).join(" · ") || gid || "Grupo";

      for (const s of (g.__sessions || [])){
        const key = `${s.day}__${s.time}__${s.room}`;
        if (!occ.has(key)){
          occ.set(key, { groupId: gid, label });
        }
      }
    }
    return occ;
  }

  function findFirstCollision(payloadSessions, occIndex){
    for (const s of (payloadSessions || [])){
      const key = `${s.day}__${s.time}__${s.room}`;
      const hit = occIndex.get(key);
      if (hit){
        return { session: s, hit };
      }
    }
    return null;
  }

  function hasDuplicateInsideSameGroup(payloadSessions){
    const seen = new Set();
    for (const s of (payloadSessions || [])){
      const key = `${s.day}__${s.time}__${s.room}`;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  }

  /* =========================================================
     STATS
  ========================================================= */
  function sessionsForDay(groups, day){
    const out = [];
    const dayCanon = utils.canonDay(day);

    for (const g0 of groups){
      const g = hydrateGroup(g0);
      const sessions = g.__sessions || [];
      for (const s of sessions){
        if (s.day !== dayCanon) continue;
        out.push({ group: g, day: dayCanon, time: s.time, room: s.room });
      }
    }

    out.sort((a,b) => utils.safeTimeToMinutes(a.time) - utils.safeTimeToMinutes(b.time));
    return out;
  }

  function computeStats(groups, day){
    const daySessions = sessionsForDay(groups, day);
    const roomsUsed = new Set();
    const occ = new Map(); // time__room -> count

    let peakSessions = 0;
    let cupoMaxSum = 0;
    let cupoOcuSum = 0;

    for (const it of daySessions){
      roomsUsed.add(it.room);
      if (PEAK_HOURS?.has?.(it.time)) peakSessions++;

      const k = `${it.time}__${it.room}`;
      occ.set(k, (occ.get(k) || 0) + 1);

      const g = it.group;
      const mx = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
      const oc = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
      if (mx > 0){
        cupoMaxSum += mx;
        cupoOcuSum += oc;
      }
    }

    let collisionsCells = 0;
    let conflictsExtras = 0;
    for (const [, c] of occ){
      if (c > 1){
        collisionsCells++;
        conflictsExtras += (c - 1);
      }
    }

    return {
      groupsCount: (groups || []).length,
      sessionsCount: daySessions.length,
      roomsUsedCount: roomsUsed.size,
      peakSessions,
      collisionsCells,
      conflictsExtras,
      cupoMaxSum,
      cupoOcuSum,
      daySessions,
    };
  }

  function renderStats(){
    // Stats “clásicos” si existen en el HTML (no asumimos)
    const st = computeStats(state.filteredGroups, state.activeDay);

    safeElSetText(els.statTotalGroups,   String(st.groupsCount));
    safeElSetText(els.statTotalSessions, String(st.sessionsCount));
    safeElSetText(els.statTotalRooms,    String(st.roomsUsedCount));

    if (els.analyticsSubtitle){
      els.analyticsSubtitle.textContent =
        `Día: ${state.activeDay} · Sesiones: ${st.sessionsCount} · Choques: ${st.conflictsExtras}`;
    }

    if (els.anaAlertsContent){
      const notes = [];
      if (st.conflictsExtras > 0) notes.push(`Hay ${st.conflictsExtras} choque(s) extra (mismo salón y hora).`);
      if (st.peakSessions >= 10) notes.push("Hora pico está bien cargada (ojo choques).");
      if (st.cupoMaxSum > 0){
        const ocu = st.cupoOcuSum / Math.max(1, st.cupoMaxSum);
        if (ocu >= 0.92) notes.push("Ocupación muy alta: si entra demanda, se te estalla el cupo.");
        if (ocu <= 0.25 && st.sessionsCount >= 8) notes.push("Ocupación baja: revisa mezcla de grupos o estrategia.");
      }

      els.anaAlertsContent.innerHTML = notes.length
        ? `<div style="display:flex;flex-direction:column;gap:8px;">
             ${notes.slice(0,6).map(n => `<div class="alert-row">${utils.htmlEscape(n)}</div>`).join("")}
           </div>`
        : `<div style="font-weight:800;color:rgba(107,114,128,.95);">Sin alertas por ahora.</div>`;
    }
  }

  /* =========================================================
     MODAL + CRUD
  ========================================================= */
  const M = {
    modal: els.modal,
    btnClose: els.btnModalClose,
    btnSave: els.btnModalSave,
    btnDelete: els.btnModalDelete,
    btnAddSession: els.btnAddSession,
    sessionsWrap: els.modalSessionsWrap,

    inClase: els.inClase,
    inEdad: els.inEdad,
    inEnfoque: els.inEnfoque,
    inNivel: els.inNivel,
    inCupoMax: els.inCupoMax,
    inCupoOcu: els.inCupoOcu,
    inActivo: els.inActivo,
  };

  function modalOpen(){
    if (!M.modal) return;

    M.modal.classList.remove("hidden");
    M.modal.classList.add("open");
    M.modal.setAttribute("aria-hidden", "false");
    document.body.classList.add("modal-open");

    M.inEnfoque?.focus?.({ preventScroll:true });
  }

  function modalClose(){
    if (!M.modal) return;

    M.modal.classList.remove("open");
    M.modal.classList.add("hidden");
    M.modal.setAttribute("aria-hidden", "true");
    document.body.classList.remove("modal-open");
  }

  function clearSessionsUI(){
    if (!M.sessionsWrap) return;
    M.sessionsWrap.innerHTML = "";
  }

  function makeSessionRow({ day="", time="", room="" } = {}){
    const row = document.createElement("div");
    row.className = "session-row";

    const daySel = document.createElement("select");
    daySel.className = "session-day";
    daySel.innerHTML = DAYS
      .map(d => `<option value="${utils.htmlEscape(d)}"${d===day?" selected":""}>${utils.htmlEscape(d)}</option>`)
      .join("");

    const timeInp = document.createElement("input");
    timeInp.type = "time";
    timeInp.className = "session-time";
    timeInp.value = utils.normalizeHHMM(time) || "15:00";

    const roomSel = document.createElement("select");
    roomSel.className = "session-room";
    roomSel.innerHTML = ROOMS
      .map(r => `<option value="${utils.htmlEscape(r.key)}"${r.key===room?" selected":""}>${utils.htmlEscape(r.label)}</option>`)
      .join("");

    const del = document.createElement("button");
    del.type = "button";
    del.className = "session-del";
    del.textContent = "Quitar";
    del.addEventListener("click", () => row.remove());

    row.appendChild(daySel);
    row.appendChild(timeInp);
    row.appendChild(roomSel);
    row.appendChild(del);

    return row;
  }

  function readSessionsFromUI(){
    if (!M.sessionsWrap) return [];
    const rows = Array.from(M.sessionsWrap.querySelectorAll(".session-row"));
    const sessions = rows.map(row => {
      const day  = row.querySelector(".session-day")?.value ?? "";
      const time = row.querySelector(".session-time")?.value ?? "";
      const room = row.querySelector(".session-room")?.value ?? "";
      return {
        day:  utils.canonDay(day),
        time: utils.normalizeHHMM(time),
        room: utils.canonRoom(room),
      };
    });
    return normalizeSessions(sessions);
  }

  function writeSessionsToUI(sessions){
    clearSessionsUI();
    if (!M.sessionsWrap) return;

    const arr = normalizeSessions(sessions);
    const frag = document.createDocumentFragment();
    for (const s of arr){
      frag.appendChild(makeSessionRow(s));
    }
    M.sessionsWrap.appendChild(frag);
  }

  function modalSetMode({ isNew=false } = {}){
    const can = perms.canEdit();

    if (M.btnSave)   M.btnSave.classList.toggle("hidden", !can);
    if (M.btnDelete) M.btnDelete.classList.toggle("hidden", !can || isNew);

    if (M.modal){
      M.modal.querySelectorAll("input,select,textarea,button.session-del").forEach(el => {
        if (el === M.btnClose) return;
        el.disabled = !can;
      });
    }
  }

  function modalFill(g, { isNew=false } = {}){
    if (!g) return;

    if (M.inClase)   M.inClase.value   = g.clase || "";
    if (M.inEdad)    M.inEdad.value    = g.edad || "";
    if (M.inEnfoque) M.inEnfoque.value = g.enfoque || "";
    if (M.inNivel)   M.inNivel.value   = g.nivel || "";

    if (M.inCupoMax) M.inCupoMax.value = String(utils.clampInt(g.__cupoMax ?? g.cupoMax ?? g.cupo_max ?? 0, 0));
    if (M.inCupoOcu) M.inCupoOcu.value = String(utils.clampInt(g.__cupoOcu ?? g.cupoOcupado ?? g.cupo_ocupado ?? 0, 0));

    if (M.inActivo){
      const v = (g.activo == null) ? true : !!g.activo;
      M.inActivo.checked = v;
    }

    writeSessionsToUI(g.__sessions || g.sessions || []);
    modalSetMode({ isNew });
  }

  function modalRead(){
    const out = {
      clase:   (M.inClase?.value ?? "").trim(),
      edad:    (M.inEdad?.value ?? "").trim(),
      enfoque: (M.inEnfoque?.value ?? "").trim(),
      nivel:   (M.inNivel?.value ?? "").trim(),
      cupoMax: utils.clampInt(M.inCupoMax?.value ?? 0, 0),
      cupoOcupado: utils.clampInt(M.inCupoOcu?.value ?? 0, 0),
      activo: (M.inActivo ? !!M.inActivo.checked : true),
      sessions: readSessionsFromUI(),
      updatedAt: Date.now(),
    };

    if (!out.clase) delete out.clase;
    if (!out.edad) delete out.edad;
    if (!out.enfoque) delete out.enfoque;
    if (!out.nivel) delete out.nivel;

    return out;
  }

  function openModalForGroup(g){
    const hg = hydrateGroup(g);
    state.activeGroup = hg;

    modalFill(hg, { isNew:false });
    modalOpen();
  }

  function openModalNewAt(day, time, room){
    state.activeGroup = null;

    const draft = hydrateGroup({
      clase: "",
      edad: "",
      enfoque: "",
      nivel: "",
      cupoMax: 0,
      cupoOcupado: 0,
      activo: true,
      sessions: [{ day, time, room }],
    });

    state.__draftNew = draft;
    modalFill(draft, { isNew:true });
    modalOpen();
  }

  async function saveGroup(){
    if (!perms.canEdit()){
      perms.explainNoPerm("guardar");
      return;
    }

    const payload = modalRead();

    if (!payload.enfoque && !payload.clase){
      toast("Pon al menos Enfoque o Clase.", "warn");
      return;
    }
    if (!payload.sessions?.length){
      toast("Agrega al menos una sesión (día/hora/salón).", "warn");
      return;
    }

    // ✅ 1) No permitir duplicados dentro del mismo grupo
    if (hasDuplicateInsideSameGroup(payload.sessions)){
      toast("🚫 Este grupo tiene dos sesiones iguales (mismo día/hora/salón).", "danger");
      return;
    }

    // ✅ 2) No permitir choques contra otros grupos (global)
    const activeId = state.activeGroup?.id || null;
    const occIndex = buildGlobalOccupancyIndex(state.allGroups || [], { excludeId: activeId });
    const collision = findFirstCollision(payload.sessions, occIndex);

    if (collision){
      const s = collision.session;
      const other = collision.hit?.label || "otro grupo";
      toast(`🚫 Ocupado: ${s.day} ${s.time} en ${s.room} (ya lo usa: ${other})`, "danger");
      return;
    }

    try{
      utils.setInfo("Guardando…");

      const colRef = ctx.fs.collection(ctx.db, ctx.GROUPS_COLLECTION);

      if (activeId){
        const docRef = ctx.fs.doc(colRef, activeId);
        await ctx.fs.setDoc(docRef, payload, { merge:true });
        toast("Grupo actualizado ✅");
      } else {
        const docRef = ctx.fs.doc(colRef);
        await ctx.fs.setDoc(docRef, payload, { merge:true });
        toast("Grupo creado ✅");
      }

      modalClose();
      state.__draftNew = null;
      state.activeGroup = null;

      renderCache.reset();
      utils.setInfo("Listo.");
    }catch(err){
      console.error(err);

      if (perms?.explainFirestoreErr) perms.explainFirestoreErr(err);
      else toast("No se pudo guardar. Revisa Rules/Auth.", "danger");

      utils.setInfo("Error guardando.");
    }
  }

  async function deleteGroup(){
    if (!perms.canEdit()){
      perms.explainNoPerm("eliminar");
      return;
    }
    const id = state.activeGroup?.id;
    if (!id){
      toast("Ese grupo no tiene ID. No hay nada que borrar.", "warn");
      return;
    }

    const ok = confirm("¿Eliminar este grupo? Esto no se puede deshacer.");
    if (!ok) return;

    try{
      utils.setInfo("Eliminando…");
      const docRef = ctx.fs.doc(ctx.db, ctx.GROUPS_COLLECTION, id);
      await ctx.fs.deleteDoc(docRef);
      toast("Grupo eliminado ✅");
      modalClose();
      state.activeGroup = null;
      renderCache.reset();
      utils.setInfo("Listo.");
    }catch(err){
      console.error(err);
      if (perms?.explainFirestoreErr) perms.explainFirestoreErr(err);
      else toast("No se pudo eliminar. Firestore bloqueó la acción.", "danger");
      utils.setInfo("Error eliminando.");
    }
  }

  function wireModalOnce(){
    if (!M.modal || M.modal.__wired) return;
    M.modal.__wired = true;

    M.btnClose?.addEventListener("click", modalClose);

    document.addEventListener("keydown", (e) => {
      if (!M.modal?.classList.contains("open")) return;
      if (e.key === "Escape") modalClose();
    });

    M.btnAddSession?.addEventListener("click", () => {
      if (!perms.canEdit()){
        perms.explainNoPerm("editar");
        return;
      }
      if (!M.sessionsWrap) return;
      M.sessionsWrap.appendChild(makeSessionRow({
        day: state.activeDay,
        time: "15:00",
        room: ROOMS[0]?.key || "Salón 1"
      }));
    });

    M.btnSave?.addEventListener("click", saveGroup);
    M.btnDelete?.addEventListener("click", deleteGroup);
  }

  /* =========================================================
     GRID RENDER (ONE GRID) + DELEGATION
  ========================================================= */
  function buildTimeSlots(daySessions){
    const set = new Set();
    for (const s of daySessions){
      if (s.time) set.add(s.time);
    }
    for (const t of (BASE_SLOTS || [])) set.add(t);

    const arr = Array.from(set);
    arr.sort((a,b) => utils.safeTimeToMinutes(a) - utils.safeTimeToMinutes(b));
    return arr;
  }

  function renderGrid(){
    if (!els.grid) return;

    const st = computeStats(state.filteredGroups, state.activeDay);
    const daySessions = st.daySessions;
    const slots = buildTimeSlots(daySessions);

    const map = new Map();
    for (const s of daySessions){
      const key = `${s.time}__${s.room}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(s);
    }

    const board = document.createElement("div");
    board.className = "sg sg-board";
    board.style.gridTemplateColumns = `140px repeat(${ROOMS.length}, minmax(140px, 1fr))`;

    const corner = document.createElement("div");
    corner.className = "sg-cell sg-sticky-top sg-sticky-left sg-corner";
    corner.textContent = "Hora";
    board.appendChild(corner);

    for (const r of ROOMS){
      const h = document.createElement("div");
      h.className = "sg-cell sg-sticky-top sg-room";
      h.dataset.room = r.key;
      h.innerHTML = `
        <div class="room-title">${utils.htmlEscape(r.label)}</div>
        <div class="room-note">${utils.htmlEscape(r.note || "")}</div>
      `;
      board.appendChild(h);
    }

    for (let rowIdx=0; rowIdx<slots.length; rowIdx++){
      const time = slots[rowIdx];
      const zebra = (rowIdx % 2 === 0) ? "sg-row-even" : "sg-row-odd";
      const peak = !!(state.helpersOn && PEAK_HOURS?.has?.(time));

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
        const items = (map.get(key) || []).slice();

        if (items.length > 1){
          cell.classList.add("sg-conflict");
          cell.title = "Choque: hay más de un grupo en este salón/hora";
        }

        if (!items.length){
          cell.innerHTML = `<div class="sg-empty" aria-hidden="true"></div>`;
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

            block.dataset.action = "edit";
            block.dataset.id = g?.id || "";

            const secondary = [g?.clase, nivel].filter(Boolean).join(" · ");

            block.innerHTML = `
              <div class="sg-block-title">${utils.htmlEscape(enfoque || g?.clase || "Grupo")}</div>
              <div class="sg-block-meta">
                <span>${utils.htmlEscape(edad || "")}</span>
                ${secondary ? `<span class="sg-muted">· ${utils.htmlEscape(secondary)}</span>` : ""}
                ${cupoTxt ? `<span class="sg-chip">${utils.htmlEscape(cupoTxt)}</span>` : ""}
              </div>
            `;

            applyBlockColors(block, g);
            cell.appendChild(block);
          }
        }

        board.appendChild(cell);
      }
    }

    els.grid.innerHTML = "";
    els.grid.appendChild(board);

    utils.setInfo(`${state.filteredGroups.length} grupo(s) · ${state.activeDay} · ${st.sessionsCount} sesión(es)`);
  }

  function wireGridDelegationOnce(){
    if (!els.grid || els.grid.__wired) return;
    els.grid.__wired = true;

    els.grid.addEventListener("click", (e) => {
      const t = e.target;

      const block = t?.closest?.(".sg-block[data-action='edit']");
      if (block){
        e.preventDefault();
        e.stopPropagation();
        const id = block.getAttribute("data-id") || "";
        const g = (state.allGroups || []).find(x => x.id === id);
        if (!g) return;
        if (perms.canEdit()) openModalForGroup(g);
        else toast(block.title || "Grupo");
        return;
      }

      const cell = t?.closest?.(".sg-cell-slot");
      if (cell){
        const time = cell.getAttribute("data-time") || "";
        const room = cell.getAttribute("data-room") || "";
        if (!time || !room) return;

        const hasBlock = !!cell.querySelector(".sg-block");
        if (hasBlock) return; // main.js ya bloquea y avisa. aquí simplemente no crea.

        if (!perms.canEdit()){
          perms.explainNoPerm("crear");
          return;
        }
        openModalNewAt(state.activeDay, time, room);
      }
    });
  }

  /* =========================================================
     LIST RENDER
  ========================================================= */
  function renderList(){
    if (!els.list) return;

    const groups = state.filteredGroups || [];
    const dayCanon = utils.canonDay(state.activeDay);

    const items = [];
    for (const g0 of groups){
      const g = hydrateGroup(g0);
      const sessions = g.__sessions || [];
      for (const s of sessions){
        if (s.day !== dayCanon) continue;
        items.push({ g, s });
      }
    }

    items.sort((a,b) => {
      const ta = utils.safeTimeToMinutes(a.s.time);
      const tb = utils.safeTimeToMinutes(b.s.time);
      if (ta !== tb) return ta - tb;
      const ra = String(a.s.room || "");
      const rb = String(b.s.room || "");
      const rcmp = ra.localeCompare(rb, "es");
      if (rcmp !== 0) return rcmp;
      const na = String(a.g.enfoque || a.g.clase || "");
      const nb = String(b.g.enfoque || b.g.clase || "");
      return na.localeCompare(nb, "es");
    });

    if (!items.length){
      els.list.innerHTML = `
        <div class="empty" style="padding:14px;color:rgba(107,114,128,.95);font-weight:900;">
          No hay horarios para <b>${utils.htmlEscape(state.activeDay)}</b> con los filtros actuales.
        </div>
      `;
      return;
    }

    els.list.innerHTML = items.map(({g,s}) => {
      const enfoque = (g.enfoque || g.clase || "Grupo").trim();
      const edad = (g.edad || "").trim();
      const clase = (g.clase || "").trim();
      const nivel = (g.nivel || "").trim();

      const cupoMax = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
      const cupoOcu = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
      const cupoTxt = (cupoMax > 0) ? `${cupoOcu}/${cupoMax}` : "";

      const title = [clase, edad, enfoque, nivel].filter(Boolean).join(" · ");

      return `
        <article class="list-item" data-action="edit" data-id="${utils.htmlEscape(g.id || "")}" title="${utils.htmlEscape(title)}">
          <div class="li-top">
            <span class="li-time">${utils.htmlEscape(s.time)}</span>
            <span class="li-room">${utils.htmlEscape(s.room)}</span>
          </div>
          <div class="li-title">${utils.htmlEscape(enfoque)}</div>
          <div class="li-meta">
            ${edad ? `<span class="pill">${utils.htmlEscape(edad)}</span>` : ""}
            ${clase ? `<span class="pill">${utils.htmlEscape(clase)}</span>` : ""}
            ${nivel ? `<span class="pill ghost">${utils.htmlEscape(nivel)}</span>` : ""}
            ${cupoTxt ? `<span class="pill">${utils.htmlEscape(cupoTxt)}</span>` : ""}
          </div>
        </article>
      `;
    }).join("");

    if (!els.list.__wired){
      els.list.__wired = true;
      els.list.addEventListener("click", (e) => {
        const item = e.target?.closest?.(".list-item[data-action='edit']");
        if (!item) return;
        const id = item.getAttribute("data-id") || "";
        const g = (state.allGroups || []).find(x => x.id === id);
        if (!g) return;
        if (perms.canEdit()) openModalForGroup(g);
        else toast(item.getAttribute("title") || "Grupo");
      });
    }
  }

  /* =========================================================
     ANALYTICS WRAP (si existe en HTML)
  ========================================================= */
  function renderAnalyticsIfPresent(){
    if (!els.analyticsWrap) return;

    const st = computeStats(state.filteredGroups, state.activeDay);

    if (els.analyticsTitle) els.analyticsTitle.textContent = "Resumen";
    if (els.analyticsSubtitle) {
      els.analyticsSubtitle.textContent =
        `Día: ${state.activeDay} · Sesiones: ${st.sessionsCount} · Choques: ${st.conflictsExtras}`;
    }

    if (els.anaTopTitle) els.anaTopTitle.textContent = "Operación";
    if (els.anaTopContent){
      const ocu = (st.cupoMaxSum > 0) ? utils.percent(st.cupoOcuSum, st.cupoMaxSum) : 0;
      const ocuTxt = (st.cupoMaxSum > 0) ? `${ocu}% (${st.cupoOcuSum}/${st.cupoMaxSum})` : "—";
      els.anaTopContent.innerHTML = `
        <div style="display:flex;flex-wrap:wrap;gap:10px;">
          <span class="stat-pill"><span class="dot-mini"></span>Grupos: ${st.groupsCount}</span>
          <span class="stat-pill"><span class="dot-mini"></span>Sesiones: ${st.sessionsCount}</span>
          <span class="stat-pill"><span class="dot-mini"></span>Salones usados: ${st.roomsUsedCount}/${ROOMS.length}</span>
          <span class="stat-pill"><span class="dot-mini"></span>Choques: ${st.conflictsExtras}</span>
          <span class="stat-pill"><span class="dot-mini"></span>Ocupación: ${ocuTxt}</span>
        </div>
      `;
    }

    if (els.anaBottomTitle) els.anaBottomTitle.textContent = "Nota";
    if (els.anaBottomContent){
      const notes = [];
      if (st.conflictsExtras > 0) notes.push("Hay choques: revisa salón/hora duplicados.");
      if (st.roomsUsedCount === ROOMS.length) notes.push("Día usando todos los salones: está apretado.");
      if (!notes.length) notes.push("Todo normal por ahora.");
      els.anaBottomContent.innerHTML = `
        <div style="color:rgba(107,114,128,.95);font-weight:800;">
          ${notes.map(n => `<div class="alert-row">${utils.htmlEscape(n)}</div>`).join("")}
        </div>
      `;
    }
  }

  /* =========================================================
     APPLY FILTERS + RENDER (central)
  ========================================================= */
  function syncViewContainers(){
    if (!els.grid || !els.list) return;

    const isList = (state.activeView === "list");
    els.list.classList.toggle("hidden", !isList);
    els.grid.classList.toggle("hidden", isList);
  }

  function showOnly(view){
    state.activeView = (view === "list") ? "list" : "grid";
    syncViewContainers();
  }

  function applyFiltersAndRender({ force=false } = {}){
    applyFilters();

    const k = computeKey();
    if (!force && renderCache.key === k) return;
    renderCache.key = k;

    syncViewContainers();

    if (state.activeView === "list"){
      renderList();
    } else {
      renderGrid();
    }

    renderStats();
    renderAnalyticsIfPresent();
  }

  /* =========================================================
     EXPORT / IMPORT JSON (backup/restore)
  ========================================================= */
  function downloadJSON(filename, obj){
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type:"application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function exportBackup(){
    const payload = {
      kind: "musicala.horarios.backup",
      version: CORE_VERSION,
      exportedAt: new Date().toISOString(),
      groups: (state.allGroups || []).map(g => {
        const out = { ...g };
        delete out.__sessions;
        delete out.__tone;
        delete out.__ageKey;
        delete out.__search;
        delete out.__cupoMax;
        delete out.__cupoOcu;
        return out;
      }),
    };

    downloadJSON(`horarios_backup_${new Date().toISOString().slice(0,10)}.json`, payload);
    toast("Backup descargado ✅");
  }

  async function upsertGroupById(id, data){
    const clean = { ...(data || {}) };

    delete clean.__sessions;
    delete clean.__tone;
    delete clean.__ageKey;
    delete clean.__search;
    delete clean.__cupoMax;
    delete clean.__cupoOcu;

    const docRef = ctx.fs.doc(ctx.db, ctx.GROUPS_COLLECTION, id);
    await ctx.fs.setDoc(docRef, clean, { merge:true });
  }

  async function importBackupFromFile(eOrFile){
    if (!perms.canEdit()){
      perms.explainNoPerm("importar");
      return;
    }

    const file = eOrFile?.target?.files?.[0] || eOrFile;
    if (!file) return;

    try{
      const txt = await file.text();
      const json = JSON.parse(txt);

      const groups = Array.isArray(json?.groups) ? json.groups : null;

      if (!groups){
        toast("Ese JSON no tiene .groups (backup inválido).", "warn");
        return;
      }

      const ok = confirm(`Se van a importar ${groups.length} grupo(s) (upsert por ID). ¿Continuar?`);
      if (!ok) return;

      utils.setInfo("Importando…");

      let done = 0;
      for (const g of groups){
        const id = (g?.id ?? "").toString().trim();
        if (!id) continue;
        await upsertGroupById(id, g);
        done++;
      }

      toast(`Importados ${done} grupo(s) ✅`);
      utils.setInfo("Importación lista.");
      renderCache.reset();
    }catch(err){
      console.error(err);
      toast("No pude leer ese JSON. O está roto o no era un backup.", "danger");
      utils.setInfo("Error importando.");
    }finally{
      if (eOrFile?.target && eOrFile.target.value != null){
        eOrFile.target.value = "";
      }
    }
  }

  function wireBackupOnce(){
    if (els.btnExport && !els.btnExport.__wired){
      els.btnExport.__wired = true;
      els.btnExport.addEventListener("click", exportBackup);
    }

    if (els.btnImport && !els.btnImport.__wired){
      els.btnImport.__wired = true;
      els.btnImport.addEventListener("click", () => els.fileImport?.click?.());
    }

    if (els.fileImport && !els.fileImport.__wired){
      els.fileImport.__wired = true;
      els.fileImport.addEventListener("change", importBackupFromFile);
    }
  }

  /* =========================================================
     UI WIRING (compat)
  ========================================================= */
  function syncDayUI(newDay){
    const d = utils.canonDay(newDay);
    if (!DAYS.includes(d)) return;
    if (state.activeDay === d) return;

    state.activeDay = d;
    renderCache.reset();
    applyFiltersAndRender({ force:true });
    utils.writeFiltersToURL?.();
  }

  /* =========================================================
     INIT
  ========================================================= */
  function init(){
    const d = utils.canonDay(state.activeDay || DAYS[0]);
    state.activeDay = DAYS.includes(d) ? d : DAYS[0];

    state.activeView = (state.activeView === "list") ? "list" : "grid";

    document.body.classList.toggle("color-mode-area", state.colorMode !== "age");
    document.body.classList.toggle("color-mode-age",  state.colorMode === "age");
    document.body.classList.toggle("helpers-off", !state.helpersOn);

    wireGridDelegationOnce();
    wireModalOnce();
    wireBackupOnce();

    applyFiltersAndRender({ force:true });
    subscribeGroupsOnce();
  }

  init();

  /* =========================================================
     PUBLIC API (for main.js)
  ========================================================= */
  return {
    version: CORE_VERSION,
    reload,
    onAuthChanged,
    syncDayUI,
    applyFiltersAndRender,
    showOnly,
    exportBackup,
    importBackupFromFile,
  };
}
