// render.analytics.js
// ------------------------------------------------------------
// Horarios Grupales · Musicala — Render Analytics (v6.0 PRO)
// - Renderiza el panel de analytics SOLO si existe en el HTML.
// - Depende de: ctx.els, ctx.state, ctx.utils, ctx.ROOMS
// - Recibe "st" (stats) ya calculado por core.stats.js / computeStats()
// - Mejora visual: KPIs en tarjetas, alertas tipo banner, distribución ordenada
// - Sin romper compatibilidad con tu HTML actual (anaTopContent / anaBottomContent)
// ------------------------------------------------------------

'use strict';

export function initAnalytics(ctx){
  const { els, state, utils } = ctx;
  const { ROOMS } = ctx;

  const ROOMS_ARR = Array.isArray(ROOMS) ? ROOMS : [];

  /* -------------------------
     helpers (render-only)
  ------------------------- */
  function percent(ocu, max){
    if (!max || max <= 0) return 0;
    // usa utils.percent si existe, si no, calcula
    if (typeof utils?.percent === "function") return utils.percent(ocu, max);
    return Math.round((Number(ocu || 0) / Math.max(1, Number(max || 0))) * 100);
  }

  function pctText(ocu, max){
    if (!max || max <= 0) return "—";
    const p = Math.round((Number(ocu || 0) / Math.max(1, Number(max || 0))) * 100);
    return `${p}% (${ocu}/${max})`;
  }

  function safeArr(x){ return Array.isArray(x) ? x : []; }
  function safeNum(x){ return Number.isFinite(Number(x)) ? Number(x) : 0; }

  function compactBarRow(label, value, max, suffix=""){
    const v = safeNum(value);
    const m = Math.max(1, safeNum(max));
    const pct = Math.round((v / m) * 100);
    const w = Math.min(100, Math.max(0, pct));
    return `
      <div class="ana-row">
        <div class="ana-row-top">
          <span class="ana-row-label">${utils.htmlEscape(label)}</span>
          <span class="ana-row-val">${utils.htmlEscape(String(v))}${suffix}</span>
        </div>
        <div class="ana-bar" aria-hidden="true">
          <div class="ana-bar-fill" style="width:${w}%"></div>
        </div>
      </div>
    `;
  }

  function compactOccRow(label, ocu, max){
    const o = Math.max(0, safeNum(ocu));
    const m = Math.max(0, safeNum(max));
    const p = (m > 0) ? Math.round((o / m) * 100) : 0;
    const w = Math.min(100, Math.max(0, p));
    const txt = (m > 0) ? `${p}% (${o}/${m})` : "—";
    return `
      <div class="ana-row">
        <div class="ana-row-top">
          <span class="ana-row-label">${utils.htmlEscape(label)}</span>
          <span class="ana-row-val">${utils.htmlEscape(txt)}</span>
        </div>
        <div class="ana-bar" aria-hidden="true">
          <div class="ana-bar-fill" style="width:${w}%"></div>
        </div>
      </div>
    `;
  }

  function toneFromOcc(pct){
    const p = safeNum(pct);
    if (p >= 85) return "danger";
    if (p >= 60) return "warn";
    return "good";
  }

  function analyticsStylesHint(){
    // Nota: esto se inyecta dentro del HTML de analytics para que el panel
    // se vea bien aunque no hayas actualizado styles.css todavía.
    return `
      <style>
        .ana-shell{
          display:flex;
          flex-direction:column;
          gap: 12px;
        }

        .ana-header{
          display:flex;
          align-items:flex-start;
          justify-content:space-between;
          gap: 10px;
        }
        .ana-header h3{
          margin:0;
          font-weight: 1000;
          letter-spacing:.2px;
          color: rgba(34,10,99,.92);
          font-size: 14px;
        }
        .ana-header .ana-sub{
          margin: 4px 0 0;
          font-size: 12.5px;
          color: rgba(107,114,128,.95);
          font-weight: 800;
          line-height: 1.25;
        }

        .ana-dashboard{
          display:grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 860px){
          .ana-dashboard{ grid-template-columns: 1.2fr 1fr 1.3fr; }
        }

        .ana-card{
          background: linear-gradient(180deg, rgba(255,255,255,.92), rgba(255,255,255,.82));
          border: 1px solid rgba(17,24,39,.10);
          border-radius: 18px;
          padding: 14px;
          box-shadow: 0 10px 28px rgba(17,24,39,.06);
        }

        .ana-card-title{
          display:flex;
          align-items:baseline;
          justify-content:space-between;
          gap: 10px;
          margin: 0 0 10px;
        }
        .ana-card-title strong{
          font-weight: 1000;
          letter-spacing:.2px;
          color: rgba(11,16,32,.92);
          font-size: 13.5px;
        }
        .ana-card-title span{
          font-size: 12px;
          color: rgba(107,114,128,.9);
          font-weight: 800;
          white-space: nowrap;
        }

        /* KPIs */
        .ana-kpis{
          display:grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }
        .ana-kpi{
          border-radius: 16px;
          border: 1px solid rgba(17,24,39,.10);
          background: rgba(255,255,255,.86);
          padding: 12px;
          box-shadow: 0 10px 22px rgba(17,24,39,.05);
          position: relative;
          overflow:hidden;
        }
        .ana-kpi::after{
          content:"";
          position:absolute;
          inset:auto -40px -40px auto;
          width: 140px;
          height: 140px;
          border-radius: 999px;
          background: radial-gradient(circle at 30% 30%, rgba(12,65,196,.18), transparent 65%);
          pointer-events:none;
        }
        .ana-kpi .kpi-label{
          font-size: 12px;
          color: rgba(107,114,128,.95);
          font-weight: 900;
          margin-bottom: 6px;
        }
        .ana-kpi .kpi-value{
          font-size: 22px;
          font-weight: 1100;
          letter-spacing: .2px;
          color: rgba(17,24,39,.92);
          line-height: 1.05;
        }
        .ana-kpi .kpi-meta{
          margin-top: 6px;
          font-size: 12px;
          color: rgba(107,114,128,.9);
          font-weight: 800;
        }

        /* Alerts */
        .ana-alerts{
          display:flex;
          flex-direction:column;
          gap: 8px;
        }
        .ana-alert{
          border-radius: 16px;
          border: 1px solid rgba(17,24,39,.10);
          background: rgba(255,255,255,.86);
          padding: 10px 12px;
          display:flex;
          gap: 10px;
          align-items:flex-start;
        }
        .ana-alert .ico{
          width: 28px; height: 28px;
          border-radius: 10px;
          display:grid;
          place-items:center;
          font-weight: 1000;
          flex: 0 0 auto;
          color: rgba(11,16,32,.92);
          background: rgba(2,6,23,.06);
        }
        .ana-alert.good .ico{ background: rgba(16,185,129,.14); }
        .ana-alert.warn .ico{ background: rgba(245,158,11,.16); }
        .ana-alert.danger .ico{ background: rgba(239,68,68,.14); }

        .ana-alert .txt{
          font-size: 12.8px;
          font-weight: 850;
          color: rgba(11,16,32,.88);
          line-height: 1.25;
        }
        .ana-alert .sub{
          margin-top: 3px;
          font-size: 12px;
          font-weight: 800;
          color: rgba(107,114,128,.95);
        }

        /* Distribución */
        .ana-grid{
          display:grid;
          grid-template-columns: 1fr;
          gap: 12px;
        }
        @media (min-width: 860px){
          .ana-grid{ grid-template-columns: 1fr 1fr; }
        }

        .ana-title{
          font-weight: 1000;
          margin: 0 0 8px;
          color: rgba(11,16,32,.92);
          font-size: 13.5px;
          letter-spacing: .2px;
        }
        .ana-muted{
          color: rgba(107,114,128,.95);
          font-weight: 800;
          font-size: 12.5px;
          line-height: 1.25;
          margin-bottom: 8px;
        }

        .ana-row{
          display:flex;
          flex-direction:column;
          gap: 6px;
          padding: 9px 0;
          border-bottom: 1px dashed rgba(17,24,39,.10);
        }
        .ana-row:last-child{ border-bottom: 0; }
        .ana-row-top{
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
        }
        .ana-row-label{
          font-weight: 950;
          color: rgba(11,16,32,.88);
        }
        .ana-row-val{
          font-weight: 900;
          color: rgba(11,16,32,.62);
        }
        .ana-bar{
          height: 10px;
          background: rgba(2,6,23,.06);
          border-radius: 999px;
          overflow:hidden;
        }
        .ana-bar-fill{
          height:100%;
          background: linear-gradient(90deg, rgba(12,65,196,.85), rgba(104,13,191,.75));
          border-radius: 999px;
        }

        .ana-details{
          border: 1px solid rgba(17,24,39,.10);
          background: rgba(255,255,255,.84);
          border-radius: 16px;
          padding: 10px 12px;
        }
        .ana-details summary{
          cursor:pointer;
          list-style:none;
          font-weight: 950;
          color: rgba(11,16,32,.9);
          font-size: 13px;
          display:flex;
          align-items:center;
          justify-content:space-between;
          gap:10px;
        }
        .ana-details summary::-webkit-details-marker{ display:none; }
        .ana-details summary span{
          font-size: 12px;
          font-weight: 800;
          color: rgba(107,114,128,.95);
          white-space: nowrap;
        }
        .ana-details .ana-muted{ margin: 8px 0 2px; }

        /* Insight pill */
        .ana-insight{
          display:flex;
          flex-direction:column;
          gap:6px;
        }
        .ana-insight-item{
          padding: 10px 12px;
          border-radius: 16px;
          border: 1px solid rgba(17,24,39,.10);
          background: rgba(255,255,255,.86);
          font-size: 12.8px;
          font-weight: 850;
          color: rgba(11,16,32,.88);
          line-height: 1.25;
        }
        .ana-insight-item b{ font-weight: 1000; color: rgba(34,10,99,.95); }
      </style>
    `;
  }

  /* -------------------------
     main render
  ------------------------- */
  function renderAnalyticsIfPresent(st){
    if (!els.analyticsWrap) return;
    const stats = st;
    if (!stats) return;

    // Titles arriba del bloque (si existen)
    if (els.analyticsTitle) els.analyticsTitle.textContent = "Resumen + Distribución";
    if (els.analyticsSubtitle){
      els.analyticsSubtitle.textContent =
        `Día: ${state.activeDay} · Hoy: ${stats.sessionsCount} sesiones · Semana (filtros): ${stats.weekSessionsCount} sesiones · Choques hoy: ${stats.conflictsExtras}`;
    }

    // ---------- KPIs + Alertas (parte superior) ----------
    if (els.anaTopTitle) els.anaTopTitle.textContent = "Operación";

    if (els.anaTopContent){
      const ocuDayPct = (stats.cupoMaxSum > 0) ? percent(stats.cupoOcuSum, stats.cupoMaxSum) : 0;
      const ocuDayTxt = (stats.cupoMaxSum > 0)
        ? `${ocuDayPct}% (${stats.cupoOcuSum}/${stats.cupoMaxSum})`
        : "—";

      const ocuWeekTxt = pctText(stats.weekCupoOcuSum, stats.weekCupoMaxSum);
      const roomsTotal = ROOMS_ARR.length || 0;

      // Señales rápidas (alertas)
      const alerts = [];

      // Choques
      if ((stats.conflictsExtras || 0) > 0){
        alerts.push({
          tone: "danger",
          ico: "⛔",
          title: `Choques detectados: ${stats.conflictsExtras}`,
          sub: "Hay sesiones pisándose en mismo día/hora/salón (según filtros).",
        });
      } else {
        alerts.push({
          tone: "good",
          ico: "✅",
          title: "Sin choques hoy",
          sub: "Buenísimo. El tablero está limpio para este día.",
        });
      }

      // Ocupación semana (si hay datos)
      const weekOccPct = (stats.weekCupoMaxSum > 0)
        ? Math.round((stats.weekCupoOcuSum / Math.max(1, stats.weekCupoMaxSum)) * 100)
        : null;

      if (weekOccPct == null){
        alerts.push({
          tone: "warn",
          ico: "🧠",
          title: "Ocupación no calculable",
          sub: "Si llenas cupoMax/cupoOcupado en grupos, saco ocupación por edad/arte con más precisión.",
        });
      } else {
        const tone = toneFromOcc(weekOccPct);
        alerts.push({
          tone,
          ico: (tone === "danger") ? "🔥" : (tone === "warn" ? "⚠️" : "🌿"),
          title: `Ocupación semana: ${weekOccPct}%`,
          sub: `Cupos semana: ${stats.weekCupoOcuSum}/${stats.weekCupoMaxSum} (según filtros).`,
        });
      }

      // Hora pico
      if ((stats.weekPeakSessions || 0) > 0){
        alerts.push({
          tone: "good",
          ico: "⏰",
          title: `Hora pico (semana): ${stats.weekPeakSessions}`,
          sub: "Si esta hora se satura, ahí se te arman las filas y los cambios de salón.",
        });
      }

      els.anaTopContent.innerHTML = `
        ${analyticsStylesHint()}
        <div class="ana-shell">

          <div class="ana-dashboard">

            <div class="ana-card" role="region" aria-label="KPIs">
              <div class="ana-card-title">
                <strong>KPIs rápidos</strong>
                <span>Día seleccionado</span>
              </div>

              <div class="ana-kpis">
                <div class="ana-kpi">
                  <div class="kpi-label">Grupos (filtro)</div>
                  <div class="kpi-value">${stats.groupsCount}</div>
                  <div class="kpi-meta">Según filtros actuales</div>
                </div>

                <div class="ana-kpi">
                  <div class="kpi-label">Sesiones hoy</div>
                  <div class="kpi-value">${stats.sessionsCount}</div>
                  <div class="kpi-meta">En <b>${utils.htmlEscape(state.activeDay)}</b></div>
                </div>

                <div class="ana-kpi">
                  <div class="kpi-label">Salones usados</div>
                  <div class="kpi-value">${stats.roomsUsedCount}/${roomsTotal}</div>
                  <div class="kpi-meta">Uso del día</div>
                </div>

                <div class="ana-kpi">
                  <div class="kpi-label">Ocupación hoy</div>
                  <div class="kpi-value">${utils.htmlEscape(ocuDayTxt)}</div>
                  <div class="kpi-meta">Cupos del día</div>
                </div>
              </div>

              <div style="height:10px"></div>

              <div class="ana-details" style="padding:10px 12px;">
                <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
                  <div style="font-weight:950;color:rgba(11,16,32,.9);font-size:13px;">Semana (filtros)</div>
                  <div style="font-size:12px;font-weight:800;color:rgba(107,114,128,.95);white-space:nowrap;">
                    Sesiones: ${stats.weekSessionsCount} · Ocupación: ${utils.htmlEscape(ocuWeekTxt)}
                  </div>
                </div>
              </div>
            </div>

            <div class="ana-card" role="region" aria-label="Alertas">
              <div class="ana-card-title">
                <strong>Alertas</strong>
                <span>Señales rápidas</span>
              </div>

              <div class="ana-alerts">
                ${alerts.slice(0, 4).map(a => `
                  <div class="ana-alert ${a.tone}">
                    <div class="ico">${a.ico}</div>
                    <div>
                      <div class="txt">${utils.htmlEscape(a.title)}</div>
                      <div class="sub">${utils.htmlEscape(a.sub)}</div>
                    </div>
                  </div>
                `).join("")}
              </div>
            </div>

            <div class="ana-card" role="region" aria-label="Mini resumen">
              <div class="ana-card-title">
                <strong>Resumen</strong>
                <span>Contexto</span>
              </div>

              <div class="ana-insight">
                <div class="ana-insight-item">
                  Hoy tienes <b>${stats.sessionsCount}</b> sesiones con <b>${stats.groupsCount}</b> grupos filtrados.
                </div>
                <div class="ana-insight-item">
                  En la semana (con filtros) hay <b>${stats.weekSessionsCount}</b> sesiones.
                </div>
                <div class="ana-insight-item">
                  Choques hoy: <b>${stats.conflictsExtras}</b> · Hora pico semana: <b>${stats.weekPeakSessions}</b>.
                </div>
              </div>
            </div>

          </div>
        </div>
      `;
    }

    // ---------- Distribución (parte inferior) ----------
    if (els.anaBottomTitle) els.anaBottomTitle.textContent = "Distribución (según filtros)";

    if (els.anaBottomContent){
      const dist = stats.dist || {};

      const byDay   = safeArr(dist.byDay).slice(0, 7);
      const byArea  = safeArr(dist.byArea).slice(0, 6);
      const byEdad  = safeArr(dist.byEdad).slice(0, 10);
      const byRoom  = safeArr(dist.byRoom).slice(0, 10);
      const byHour  = safeArr(dist.byHour).slice(0, 10);

      const maxDay  = Math.max(1, ...byDay.map(x => safeNum(x.value)));
      const maxArea = Math.max(1, ...byArea.map(x => safeNum(x.value)));
      const maxEdad = Math.max(1, ...byEdad.map(x => safeNum(x.value)));
      const maxRoom = Math.max(1, ...byRoom.map(x => safeNum(x.value)));
      const maxHour = Math.max(1, ...byHour.map(x => safeNum(x.value)));

      const occArea = safeArr(dist.occByArea).slice(0, 6);
      const occEdad = safeArr(dist.occByEdad).slice(0, 10);

      // Insights (basados en top)
      const hottestDay  = byDay.slice().sort((a,b)=> safeNum(b.value)-safeNum(a.value))[0];
      const hottestHour = byHour[0];
      const hottestRoom = byRoom[0];

      const insights = [];
      if (hottestDay?.value > 0)  insights.push(`Día más cargado (semana): <b>${utils.htmlEscape(hottestDay.label)}</b> (${hottestDay.value} sesiones).`);
      if (hottestHour?.value > 0) insights.push(`Hora más cargada: <b>${utils.htmlEscape(hottestHour.label)}</b> (${hottestHour.value} sesiones).`);
      if (hottestRoom?.value > 0) insights.push(`Salón más usado: <b>${utils.htmlEscape(hottestRoom.label)}</b> (${hottestRoom.value} sesiones).`);

      if ((stats.weekCupoMaxSum || 0) <= 0){
        insights.push("Tip: si llenas cupoMax/cupoOcupado en grupos, te saco ocupación por edad y por arte con más precisión.");
      }

      els.anaBottomContent.innerHTML = `
        ${analyticsStylesHint()}

        <div class="ana-grid">

          <div class="ana-card">
            <div class="ana-title">Sesiones por día</div>
            <div class="ana-muted">Semana completa (con filtros actuales)</div>
            ${byDay.length
              ? byDay.map(x => compactBarRow(x.label, x.value, maxDay)).join("")
              : `<div class="ana-muted">Sin datos para mostrar con los filtros actuales.</div>`
            }
          </div>

          <div class="ana-card">
            <div class="ana-title">Sesiones por arte</div>
            <div class="ana-muted">Clasificación automática por enfoque/clase</div>
            ${byArea.length
              ? byArea.map(x => compactBarRow(x.label, x.value, maxArea)).join("")
              : `<div class="ana-muted">Sin datos.</div>`
            }

            ${occArea.length
              ? `
                <div style="height:10px"></div>
                <details class="ana-details">
                  <summary>Ocupación por arte <span>(cupo)</span></summary>
                  <div class="ana-muted">Agregado por cupoOcupado / cupoMax</div>
                  ${occArea.map(x => compactOccRow(x.key, x.ocu, x.max)).join("")}
                </details>
              `
              : ""
            }
          </div>

          <div class="ana-card">
            <div class="ana-title">Sesiones por edad</div>
            <div class="ana-muted">Según campo “edad” del grupo</div>
            ${byEdad.length
              ? byEdad.slice(0, 6).map(x => compactBarRow(x.label, x.value, maxEdad)).join("")
              : `<div class="ana-muted">Sin datos.</div>`
            }

            ${(byEdad.length > 6)
              ? `
                <div style="height:10px"></div>
                <details class="ana-details">
                  <summary>Ver más edades <span>(${byEdad.length})</span></summary>
                  <div class="ana-muted">Listado completo (según filtros)</div>
                  ${byEdad.map(x => compactBarRow(x.label, x.value, maxEdad)).join("")}
                </details>
              `
              : ""
            }

            ${occEdad.length
              ? `
                <div style="height:10px"></div>
                <details class="ana-details">
                  <summary>Ocupación por edad <span>(cupo)</span></summary>
                  <div class="ana-muted">Agregado por cupoOcupado / cupoMax</div>
                  ${occEdad.map(x => compactOccRow(x.key, x.ocu, x.max)).join("")}
                </details>
              `
              : ""
            }
          </div>

          <div class="ana-card">
            <div class="ana-title">Concentración</div>
            <div class="ana-muted">Dónde se acumula la operación</div>

            <details class="ana-details" open>
              <summary>Top salones <span>(sesiones)</span></summary>
              <div class="ana-muted">Los más usados (según filtros)</div>
              ${byRoom.length
                ? byRoom.slice(0, 5).map(x => compactBarRow(x.label, x.value, maxRoom)).join("")
                : `<div class="ana-muted">Sin datos.</div>`
              }
            </details>

            <div style="height:10px"></div>

            <details class="ana-details" open>
              <summary>Top horas <span>(sesiones)</span></summary>
              <div class="ana-muted">Horas más cargadas (según filtros)</div>
              ${byHour.length
                ? byHour.slice(0, 5).map(x => compactBarRow(x.label, x.value, maxHour)).join("")
                : `<div class="ana-muted">Sin datos.</div>`
              }
            </details>

            ${(byRoom.length > 5 || byHour.length > 5)
              ? `
                <div style="height:10px"></div>
                <details class="ana-details">
                  <summary>Ver detalle completo <span>(top 10)</span></summary>
                  <div class="ana-muted">Salones</div>
                  ${byRoom.map(x => compactBarRow(x.label, x.value, maxRoom)).join("")}
                  <div style="height:10px"></div>
                  <div class="ana-muted">Horas</div>
                  ${byHour.map(x => compactBarRow(x.label, x.value, maxHour)).join("")}
                </details>
              `
              : ""
            }
          </div>

        </div>

        <div style="height:12px"></div>

        <div class="ana-card">
          <div class="ana-title">Insights</div>
          <div class="ana-muted">Lectura rápida para decisiones</div>

          <div class="ana-insight">
            ${insights.length
              ? insights.map(x => `<div class="ana-insight-item">${x}</div>`).join("")
              : `<div class="ana-insight-item">Todo normal por ahora.</div>`
            }
          </div>
        </div>
      `;
    }
  }

  return { renderAnalyticsIfPresent };
}
