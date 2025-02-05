  // URLs de las hojas de Google Sheets publicadas
  const urls = {
    cursos: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=1259762618&single=true&output=csv",
    lunes: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=726592366&single=true&output=csv",
    martes: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=299750924&single=true&output=csv",
    miercoles: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=1452295168&single=true&output=csv",
    jueves: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=1765813362&single=true&output=csv",
    viernes: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=1976511082&single=true&output=csv",
    sabado: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6MXaC7y75G80js1VLcdcnm8GkJ56qP6nyXzL_S1Kq9gv5UA3Z2zd0RRdo9CobxL6Y3_tVzhZmqBF/pub?gid=728137191&single=true&output=csv"
  };

  // Función para cargar y renderizar datos
  async function cargarDatos(dia) {
    const url = urls[dia];
    if (!url) {
      alert("No se encontró la hoja para el día seleccionado.");
      return;
    }

    try {
      const response = await fetch(url);
      const data = await response.text();
      renderizarTabla(data);
    } catch (error) {
      console.error("Error al cargar los datos:", error);
    }
  }

  // Función para renderizar la tabla
  function renderizarTabla(csvData) {
    const rows = csvData.split("\n").map(row => row.split(","));
    const tbody = document.querySelector("#tabla-horarios tbody");
    tbody.innerHTML = ""; // Limpia la tabla

    rows.forEach((row, index) => {
      const tr = document.createElement("tr");
      row.forEach(cell => {
        const td = document.createElement(index === 0 ? "th" : "td");
        td.textContent = cell.trim();

        // Aplica colores según el contenido
        if (td.textContent.includes("CL")) {
          td.style.backgroundColor = "#d1e7dd"; // Verde claro
          td.style.color = "#0f5132"; // Texto verde oscuro
        } else if (td.textContent.includes("CF")) {
          td.style.backgroundColor = "#f8d7da"; // Rojo claro
          td.style.color = "#842029"; // Texto rojo oscuro
        }

        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }

  // Carga inicial (opcional)
  cargarDatos("lunes");
