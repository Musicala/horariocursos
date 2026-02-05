// core.stats.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala — Stats (v5.5)
// - computeStats(): métricas día + semana (según filtros)
// - renderStats(): pinta contadores simples + alertas (si existen en HTML)
// ------------------------------------------------------------

'use strict';

export function initStats(ctx){
  const { els, state, utils } = ctx;
  const { DAYS, ROOMS, PEAK_HOURS } = ctx;

  const ROOMS_ARR = Array.isArray(ROOMS) ? ROOMS : [];
  const ROOMS_KEYS = ROOMS_ARR.map(r => r?.key).filter(Boolean);
  const ROOMS_LABEL_BY_KEY = new Map(ROOMS_ARR.map(r => [r.key, r.label || r.key]));

  /* =========================
     helpers (stats-only)
  ========================= */
  function safeKey(v, fallback="—"){
    const t = (v == null ? "" : String(v)).trim();
    return t || fallback;
  }

  function incMap(map, key, by=1){
    const k = safeKey(key);
    map.set(k, (map.get(k) || 0) + (Number(by) || 0));
  }

  function addOccAgg(occMap, key, cupoOcu, cupoMax){
    const k = safeKey(key);
    const cur = occMap.get(k) || { ocu:0, max:0 };
    cur.ocu += Math.max(0, Number(cupoOcu) || 0);
    cur.max += Math.max(0, Number(cupoMax) || 0);
    occMap.set(k, cur);
  }

  function mapToSortedArray(map){
    const arr = Array.from(map.entries()).map(([k,v]) => ({ key:k, label:k, value:v }));
    arr.sort((a,b) => (b.value - a.value) || String(a.key).localeCompare(String(b.key), "es"));
    return arr;
  }

  function mapOccToSortedArray(map){
    const arr = Array.from(map.entries()).map(([k,v]) => {
      const ocu = Math.max(0, Number(v?.ocu) || 0);
      const mx  = Math.max(0, Number(v?.max) || 0);
      const pct = (mx > 0) ? Math.round((ocu/mx)*100) : 0;
      return { key:k, label:k, ocu, max:mx, pct };
    });
    arr.sort((a,b) => (b.pct - a.pct) || (b.ocu - a.ocu) || a.key.localeCompare(b.key, "es"));
    return arr;
  }

  function pctText(ocu, max){
    if (!max || max <= 0) return "—";
    const p = Math.round((ocu / Math.max(1, max)) * 100);
    return `${p}% (${ocu}/${max})`;
  }

  function safeElSetText(el, txt){
    if (!el) return;
    el.textContent = txt ?? "";
  }

  /* =========================
     clasificación (igual a core)
  ========================= */
  function toneClassForGroup(g){
    const raw = `${g?.clase ?? ""} ${g?.enfoque ?? ""}`.toLowerCase();
    const n = utils.normalize(raw);

    if (n.includes("danza") || n.includes("ballet") || n.includes("hip hop") || n.includes("baile")) return "dance";
    if (n.includes("teatro") || n.includes("actu") || n.includes("escena")) return "theater";
    if (n.includes("arte") || n.includes("plastica") || n.includes("plástica") || n.includes("pint") || n.includes("dibu")) return "arts";
    return "music";
  }

  function areaLabel(areaKey){
    const k = (areaKey || "music").toString();
    if (k === "dance") return "Danza";
    if (k === "theater") return "Teatro";
    if (k === "arts") return "Artes";
    return "Música";
  }

  function ageKey(g){
    return (g?.edad ?? "").toString().trim();
  }

  function normalizeSessions(sessions){
    const arr = Array.isArray(sessions) ? sessions : [];
    const out = arr
      .map(s => ({
        day:  utils.canonDay((s?.day ?? "").toString().trim()),
        time: utils.normalizeHHMM((s?.time ?? "").toString().trim()),
        room: utils.canonRoom((s?.room ?? "").toString().trim()),
      }))
      .filter(s => s.day && s.time && s.room && DAYS.includes(s.day));

    const filtered = (ROOMS_KEYS.length > 0)
      ? out.filter(s => ROOMS_KEYS.includes(s.room))
      : out;

    return filtered.sort(utils.compareSessions);
  }

  function hydrateLite(raw){
    const g = { ...(raw || {}) };
    g.clase   = (g.clase ?? "").toString().trim();
    g.edad    = (g.edad ?? "").toString().trim();
    g.enfoque = (g.enfoque ?? "").toString().trim();

    g.__sessions = normalizeSessions(g.sessions);
    g.__tone     = toneClassForGroup(g);
    g.__ageKey   = ageKey(g);

    // cupos (compat)
    g.__cupoMax = utils.clampInt(g?.cupoMax ?? g?.cupo_max ?? 0, 0);
    g.__cupoOcu = utils.clampInt(g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);

    return g;
  }

  /* =========================
     sesiones
  ========================= */
  function sessionsForDay(groups, day){
    const out = [];
    const dayCanon = utils.canonDay(day);

    for (const g0 of (groups || [])){
      const g = (g0 && g0.__sessions) ? g0 : hydrateLite(g0);
      const sessions = g.__sessions || [];
      for (const s of sessions){
        if (s.day !== dayCanon) continue;
        out.push({
          group: g,
          day: s.day,
          time: s.time,
          room: s.room,
        });
      }
    }

    return out.sort((a,b) => utils.compareSessions(a,b));
  }

  function sessionsForAllDays(groups){
    const out = [];
    for (const g0 of (groups || [])){
      const g = (g0 && g0.__sessions) ? g0 : hydrateLite(g0);
      const sessions = g.__sessions || [];
      for (const s of sessions){
        out.push({
          group: g,
          day: s.day,
          time: s.time,
          room: s.room,
        });
      }
    }
    return out.sort((a,b) => utils.compareSessions(a,b));
  }

  /* =========================
     compute
  ========================= */
  function computeStats(groups, day){
    const daySessions = sessionsForDay(groups, day);
    const weekSessions = sessionsForAllDays(groups);

    const roomsUsed = new Set();
    const occCells = new Map(); // time__room -> count
    let peakSessions = 0;
    let cupoMaxSum = 0;
    let cupoOcuSum = 0;

    for (const it of daySessions){
      roomsUsed.add(it.room);
      if (PEAK_HOURS?.has?.(it.time)) peakSessions++;

      const k = `${it.time}__${it.room}`;
      occCells.set(k, (occCells.get(k) || 0) + 1);

      const g = it.group;
      const mx = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
      const oc = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
      if (mx > 0){
        cupoMaxSum += mx;
        cupoOcuSum += oc;
      }
    }

    // celdas con más de 1 bloque
    const collisionsCells = Array.from(occCells.entries()).filter(([,v]) => v > 1);
    let conflictsExtras = 0;
    for (const [,v] of collisionsCells){
      conflictsExtras += Math.max(0, v - 1);
    }

    // WEEK distributions (según filtros)
    const byDay   = new Map();
    const byRoom  = new Map();
    const byHour  = new Map();
    const byEdad  = new Map();
    const byArea  = new Map();
    const byClase = new Map();

    const occByArea = new Map(); // label -> {ocu,max}
    const occByEdad = new Map();

    let weekPeakSessions = 0;
    let weekCupoMaxSum = 0;
    let weekCupoOcuSum = 0;

    for (const it of weekSessions){
      const g0 = it.group;
      const g = (g0 && g0.__sessions) ? g0 : hydrateLite(g0);

      const aKey = g.__tone || toneClassForGroup(g);
      const aLbl = areaLabel(aKey);
      const eKey = safeKey(g.__ageKey || g.edad || "", "Sin edad");
      const cKey = safeKey(g?.clase, "Sin clase");

      incMap(byDay, it.day, 1);
      incMap(byRoom, ROOMS_LABEL_BY_KEY.get(it.room) || it.room, 1);
      incMap(byHour, it.time, 1);
      incMap(byEdad, eKey, 1);
      incMap(byArea, aLbl, 1);
      incMap(byClase, cKey, 1);

      if (PEAK_HOURS?.has?.(it.time)) weekPeakSessions++;

      const mx = utils.clampInt(g?.__cupoMax ?? g?.cupoMax ?? g?.cupo_max ?? 0, 0);
      const oc = utils.clampInt(g?.__cupoOcu ?? g?.cupoOcupado ?? g?.cupo_ocupado ?? 0, 0);
      if (mx > 0){
        weekCupoMaxSum += mx;
        weekCupoOcuSum += oc;
        addOccAgg(occByArea, aLbl, oc, mx);
        addOccAgg(occByEdad, eKey, oc, mx);
      }
    }

    const byRoomArr = mapToSortedArray(byRoom);
    const byHourArr = mapToSortedArray(byHour);
    const byEdadArr = mapToSortedArray(byEdad);
    const byAreaArr = mapToSortedArray(byArea);
    const byClaseArr = mapToSortedArray(byClase);

    const occByAreaArr = mapOccToSortedArray(occByArea);
    const occByEdadArr = mapOccToSortedArray(occByEdad);

    const dayOrderArr = DAYS.map(d => ({ key:d, label:d, value: byDay.get(d) || 0 }));

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

      weekSessionsCount: weekSessions.length,
      weekPeakSessions,
      weekCupoMaxSum,
      weekCupoOcuSum,

      dist: {
        byDay: dayOrderArr,
        byRoom: byRoomArr,
        byHour: byHourArr,
        byEdad: byEdadArr,
        byArea: byAreaArr,
        byClase: byClaseArr,
        occByArea: occByAreaArr,
        occByEdad: occByEdadArr,
      }
    };
  }

  /* =========================
     render simple stats + alerts
  ========================= */
  function renderStats(st){
    const stats = st || null;
    if (!stats) return;

    safeElSetText(els.statTotalGroups,   String(stats.groupsCount));
    safeElSetText(els.statTotalSessions, String(stats.sessionsCount));
    safeElSetText(els.statTotalRooms,    String(stats.roomsUsedCount));

    // subtitle (si existe)
    if (els.analyticsSubtitle){
      els.analyticsSubtitle.textContent =
        `Día: ${state.activeDay} · Sesiones: ${stats.sessionsCount} · Choques: ${stats.conflictsExtras}`;
    }

    // alertas (si existe contenedor)
    if (els.anaAlertsContent){
      const notes = [];
      if (stats.conflictsExtras > 0) notes.push(`Hay ${stats.conflictsExtras} choque(s) extra (mismo salón y hora).`);
      if (stats.peakSessions >= 10) notes.push("Hora pico está bien cargada (ojo choques).");
      if (stats.cupoMaxSum > 0){
        const ocu = stats.cupoOcuSum / Math.max(1, stats.cupoMaxSum);
        if (ocu >= 0.92) notes.push("Ocupación muy alta: si entra demanda, se te estalla el cupo.");
        if (ocu <= 0.25 && stats.sessionsCount >= 8) notes.push("Ocupación baja: revisa mezcla de grupos o estrategia.");
      }

      els.anaAlertsContent.innerHTML = notes.length
        ? `<div style="display:flex;flex-direction:column;gap:8px;">
             ${notes.slice(0,6).map(n => `<div class="alert-row">${utils.htmlEscape(n)}</div>`).join("")}
           </div>`
        : `<div style="font-weight:800;color:rgba(107,114,128,0.95);">Sin alertas por ahora.</div>`;
    }
  }

  return {
    computeStats,
    renderStats,

    // por si el render (grid/list) quiere usar labels consistentes
    roomsLabelByKey: ROOMS_LABEL_BY_KEY,
    roomsArr: ROOMS_ARR,
    pctText,
  };
}
