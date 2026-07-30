// Detección automática del backend (usa localhost en desarrollo o la URL relativa si lo sirves directo)
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? '' 
    : 'https://gee-ezk5.onrender.com';

// 1. Inicialización del mapa Leaflet
const map = L.map('map').setView([-32.522, -55.766], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let capaActiva = null;
let popupInspector = L.popup();

// 2. Control de leyenda dinámica
const legendControl = L.control({ position: 'bottomright' });
legendControl.onAdd = function () {
    const div = L.DomUtil.create('div', 'legend');
    div.id = 'leyendaMapa';
    div.style.display = 'none';
    return div;
};
legendControl.addTo(map);

// Setear rango por defecto de los últimos 30 días
function inicializarFechas30Dias() {
    const hoy = new Date();
    const hace30Dias = new Date();
    hace30Dias.setDate(hoy.getDate() - 30);

    document.getElementById('fechaFin').value = hoy.toISOString().split('T')[0];
    document.getElementById('fechaInicio').value = hace30Dias.toISOString().split('T')[0];
}

// 3. Cargar la lista de capas disponibles desde /api/capas
async function cargarOpcionesCapas() {
    try {
        const response = await fetch(`${API_URL}/api/capas`);
        const capas = await response.json();
        
        const select = document.getElementById('tipoCapa');
        select.innerHTML = '';

        for (const [clave, nombre] of Object.entries(capas)) {
            const option = document.createElement('option');
            option.value = clave;
            option.innerText = nombre;
            select.appendChild(option);
        }

        actualizarCapa();

    } catch (error) {
        console.error(error);
        document.getElementById('statusMessage').innerText = 'Error al conectar con la API.';
    }
}

function obtenerBBoxActual() {
    const bounds = map.getBounds();
    return [
        bounds.getWest(),
        bounds.getSouth(),
        bounds.getEast(),
        bounds.getNorth()
    ];
}

function cambiarOpacidad(valor) {
    document.getElementById('opacityVal').innerText = `${Math.round(valor * 100)}%`;
    if (capaActiva) {
        capaActiva.setOpacity(valor);
    }
}

function actualizarLeyenda(visParams, nombreCapa) {
    const div = document.getElementById('leyendaMapa');
    
    if (visParams && visParams.palette && visParams.palette.length > 0) {
        const colores = visParams.palette.join(', ');
        const min = visParams.min !== undefined ? visParams.min : '';
        const max = visParams.max !== undefined ? visParams.max : '';

        div.innerHTML = `
            <h5>${nombreCapa}</h5>
            <div class="legend-gradient" style="background: linear-gradient(to right, ${colores});"></div>
            <div class="legend-labels">
                <span>${min}</span>
                <span>${max}</span>
            </div>
        `;
        div.style.display = 'block';
    } else {
        div.style.display = 'none';
    }
}

// 4. Solicitar capas de Earth Engine al backend (/api/capa)
async function actualizarCapa() {
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);
    
    const btnCargar = document.getElementById('btnCargar');
    const status = document.getElementById('statusMessage');
    const listaFechasDiv = document.getElementById('listaFechas');

    if (!tipoCapa || !fechaInicio || !fechaFin) return;

    btnCargar.disabled = true;
    status.innerText = 'Procesando mosaico en Earth Engine...';
    listaFechasDiv.innerHTML = '<span style="color:#888;">Buscando pasadas...</span>';

    try {
        const response = await fetch(`${API_URL}/api/capa`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                bbox: obtenerBBoxActual(),
                porcentaje_nubes: porcentajeNubes
            })
        });

        const data = await response.json();

        if (response.ok && data.tile_url) {
            if (capaActiva) map.removeLayer(capaActiva);

            const opacidadActual = parseFloat(document.getElementById('opacitySlider').value);

            capaActiva = L.tileLayer(data.tile_url, {
                attribution: 'Google Earth Engine | Sentinel-2',
                opacity: opacidadActual
            }).addTo(map);

            actualizarLeyenda(data.vis_params, data.nombre_capa);

            if (data.fechas_pasadas && data.fechas_pasadas.length > 0) {
                listaFechasDiv.innerHTML = data.fechas_pasadas
                    .map(fecha => `<span class="fecha-badge">${fecha}</span>`)
                    .join('');
                status.innerText = `Mosaico generado (${data.fechas_pasadas.length} capturas).`;
            } else {
                listaFechasDiv.innerHTML = '<span style="color:#d32f2f;">Sin pasadas utilizables.</span>';
            }

        } else {
            status.innerText = data.message || 'Error al generar la capa.';
            listaFechasDiv.innerHTML = '-';
            actualizarLeyenda(null, '');
        }

    } catch (error) {
        console.error(error);
        status.innerText = 'Error de conexión con el backend.';
    } finally {
        btnCargar.disabled = false;
    }
}

// 5. Descarga de archivo GeoTIFF (/api/descargar-geotiff)
async function descargarGeoTIFF() {
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);
    
    const status = document.getElementById('statusMessage');
    const btnDescargar = document.getElementById('btnDescargar');

    if (!tipoCapa || !fechaInicio || !fechaFin) {
        status.innerText = 'Seleccioná datos válidos antes de descargar.';
        return;
    }

    btnDescargar.disabled = true;
    status.innerText = 'Generando archivo GeoTIFF (10m)...';

    try {
        const response = await fetch(`${API_URL}/api/descargar-geotiff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                bbox: obtenerBBoxActual(),
                porcentaje_nubes: porcentajeNubes
            })
        });

        const data = await response.json();

        if (response.ok && data.download_url) {
            status.innerText = '¡Descarga generada!';
            window.open(data.download_url, '_blank');
        } else {
            status.innerText = data.detail || 'Error al solicitar la descarga.';
        }

    } catch (error) {
        console.error(error);
        status.innerText = 'Error de comunicación con el backend.';
    } finally {
        btnDescargar.disabled = false;
    }
}

// 6. Inspector de Píxel al hacer clic en el mapa (/api/inspeccionar-pixel)
map.on('click', async function(e) {
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);

    if (!capaActiva || !tipoCapa) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    popupInspector
        .setLatLng(e.latlng)
        .setContent(`
            <div style="text-align: center; padding: 5px;">
                <b>Consultando valor...</b><br>
                <small style="color: #666;">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</small>
            </div>
        `)
        .openOn(map);

    try {
        const response = await fetch(`${API_URL}/api/inspeccionar-pixel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                lat: lat,
                lng: lng,
                porcentaje_nubes: porcentajeNubes
            })
        });

        const data = await response.json();

        if (response.ok && data.status === 'ok') {
            let contenidoHtml = `<div style="min-width: 140px;"><b>${data.nombre_capa}</b><hr style="margin: 4px 0; border: 0; border-top: 1px solid #ccc;">`;

            if (data.metodo === 'normalized_difference' && data.valores && data.valores.indice !== undefined) {
                const val = data.valores.indice;
                const valFormateado = (val !== null) ? val.toFixed(4) : 'Sin datos';
                contenidoHtml += `<b>Valor del Índice:</b> <span style="color: #0288d1; font-weight: bold;">${valFormateado}</span>`;
            } else if (data.metodo === 'select' && data.valores) {
                contenidoHtml += `<small>`;
                for (const [banda, val] of Object.entries(data.valores)) {
                    const valFormateado = (val !== null) ? val : 'Sin datos';
                    contenidoHtml += `<b>${banda}:</b> ${valFormateado}<br>`;
                }
                contenidoHtml += `</small>`;
            } else {
                contenidoHtml += `<span style="color: #888;">Sin datos en esta coordenada.</span>`;
            }

            contenidoHtml += `</div>`;
            popupInspector.setContent(contenidoHtml);

        } else {
            popupInspector.setContent(`<i>${data.message || 'Sin datos disponibles'}</i>`);
        }

    } catch (error) {
        console.error(error);
        popupInspector.setContent('<i>Error de comunicación con el servidor.</i>');
    }
});

// Inicialización automática
window.onload = function() {
    inicializarFechas30Dias();
    cargarOpcionesCapas();
};