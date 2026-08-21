// Detección automática del backend (usa localhost en desarrollo o la URL relativa para web)
const API_URL = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? (window.location.port === '8000' ? '' : 'http://127.0.0.1:8000')
    : 'https://gee-ezk5.onrender.com';

// 1. Inicialización del mapa Leaflet
const map = L.map('map').setView([-32.522, -55.766], 7);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);

let capaActiva = null;
let popupInspector = L.popup();
let configCapasGlobal = {}; // Guardaremos la estructura de capas completa

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

// 3. Cargar la configuración general de capas desde /api/capas
async function cargarOpcionesCapas() {
    try {
        const response = await fetch(`${API_URL}/api/capas`);
        configCapasGlobal = await response.json();
        
        // Poblar el menú desplegable inicial según el sensor seleccionado
        actualizarSelectCapas();

        // Esperar a que el mapa esté completamente listo y renderizado
        if (map.getBounds().isValid()) {
            actualizarCapa();
        } else {
            map.once('load', () => {
                actualizarCapa();
            });
            // Fallback por seguridad si el evento load ya pasó
            setTimeout(() => {
                if (!capaActiva) actualizarCapa();
            }, 500);
        }

    } catch (error) {
        console.error(error);
        document.getElementById('statusMessage').innerText = 'Error al conectar con la API.';
    }
}

// Rellenar el select de capas dinámicamente según el sensor activo
function actualizarSelectCapas() {
    const sensorSeleccionado = document.getElementById('sensor').value;
    const selectCapa = document.getElementById('tipoCapa');
    selectCapa.innerHTML = '';

    const capasDelSensor = configCapasGlobal[sensorSeleccionado];

    if (capasDelSensor) {
        for (const [clave, objCapa] of Object.entries(capasDelSensor)) {
            const option = document.createElement('option');
            option.value = clave;
            option.innerText = objCapa.nombre || clave;
            selectCapa.appendChild(option);
        }
    }
}

// Evento al cambiar de sensor (Óptico vs Radar)
document.getElementById('sensor').addEventListener('change', function() {
    const sensor = this.value;
    const divOrbita = document.getElementById('divOrbita');
    const divNubes = document.getElementById('divNubes');

    if (sensor === 'sentinel-1') {
        divOrbita.style.display = 'block';
        divNubes.style.display = 'none'; // El radar no usa filtro de nubes
    } else {
        divOrbita.style.display = 'none';
        divNubes.style.display = 'block';
    }

    actualizarSelectCapas();
    actualizarCapa();
});

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
    const sensor = document.getElementById('sensor').value;
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);
    const orbita = document.getElementById('orbita').value;
    
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
                sensor: sensor,
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                bbox: obtenerBBoxActual(),
                porcentaje_nubes: porcentajeNubes,
                orbita: orbita
            })
        });

        const data = await response.json();

        if (response.ok && data.tile_url) {
            if (capaActiva) map.removeLayer(capaActiva);

            const opacidadActual = parseFloat(document.getElementById('opacitySlider').value);

            capaActiva = L.tileLayer(data.tile_url, {
                attribution: `Google Earth Engine | ${sensor.toUpperCase()}`,
                opacity: opacidadActual
            }).addTo(map);

            actualizarLeyenda(data.vis_params, data.nombre_capa);

            if (data.fechas_pasadas && data.fechas_pasadas.length > 0) {
                listaFechasDiv.innerHTML = data.fechas_pasadas
                    .map(fecha => `<span class="fecha-badge">${fecha}</span>`)
                    .join('');
                status.innerText = `Mosaico generado (${data.fechas_pasadas.length} capturas).`;
            } else {
                listaFechasDiv.innerHTML = '<span style="color:#d32f2f;">Sin pasadas en este rango.</span>';
                status.innerText = `Mosaico generado (sin metadatos de fecha).`;
            }

        } else {
            status.innerText = data.message || data.error || 'Error al generar la capa.';
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
    const sensor = document.getElementById('sensor').value;
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);
    const orbita = document.getElementById('orbita').value;
    
    const status = document.getElementById('statusMessage');
    const btnDescargar = document.getElementById('btnDescargar');

    if (!tipoCapa || !fechaInicio || !fechaFin) {
        status.innerText = 'Seleccioná datos válidos antes de descargar.';
        return;
    }

    btnDescargar.disabled = true;
    status.innerText = 'Generando archivo GeoTIFF...';

    try {
        const response = await fetch(`${API_URL}/api/descargar-geotiff`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sensor: sensor,
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                bbox: obtenerBBoxActual(),
                porcentaje_nubes: porcentajeNubes,
                orbita: orbita
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

// 6. Configuración y formateador enriquecido para el Inspector de Píxel
function construirContenidoPopup(data, tipoCapa, lat, lng) {
    const { nombre_capa, metodo, valores } = data;
    const textoBusqueda = `${tipoCapa || ''} ${nombre_capa || ''}`.toLowerCase();

    let claveCapa = tipoCapa; // Usamos el id de la capa directamente como clave principal

    const renderBandas = (vals, nombresBandas = {}, interpretacionText = '') => {
        if (!vals) return '<i>Sin datos en esta coordenada.</i>';

        const items = Object.entries(vals).map(([banda, val]) => {
            const etiqueta = nombresBandas[banda] || banda;
            const valFormateado = (typeof val === 'number') ? val.toFixed(2) : val;
            return `<li><b>${etiqueta}:</b> ${valFormateado}</li>`;
        }).join('');

        return `
            <div style="margin: 6px 0;">
                <b>Desglose por Banda / Parámetro:</b>
                <ul style="margin: 4px 0; padding-left: 18px;">${items}</ul>
            </div>
            <div style="background: #f0f4f9; padding: 6px; border-radius: 4px; font-size: 0.82em; color: #444;">
                <b>Interpretación:</b> ${interpretacionText}
            </div>
        `;
    };

    const metadatosCapas = {
        'vv': {
            titulo: 'Retrodispersión VV (dB)',
            descripcion: 'Mide la retrodispersión de la señal radar en polarización vertical-vertical.',
            interpretar: (vals) => renderBandas(vals, { VV: 'VV (dB)' }, 'Valores más bajos indican superficies lisas (agua, planicies), mientras que valores altos reflejan rugosidad o estructuras urbanas.')
        },
        'vh': {
            titulo: 'Retrodispersión VH (dB)',
            descripcion: 'Mide la retrodispersión en polarización vertical-horizontal.',
            interpretar: (vals) => renderBandas(vals, { VH: 'VH (dB)' }, 'Sensible al volumen de vegetación y estructura tridimensional del terreno.')
        },
        'vv_vh': {
            titulo: 'Cociente VV/VH',
            descripcion: 'Relación entre polarizaciones útil para discriminación de coberturas y humedad.',
            interpretar: (vals) => renderBandas(vals, { VV_VH: 'VV/VH (dB)' }, 'Calculado mediante diferencia logarítmica (VV - VH).')
        },
        'color_natural': {
            titulo: 'Reflectancia de la Superficie (RGB)',
            descripcion: 'Color real del terreno (Sentinel-2).',
            interpretar: (vals) => renderBandas(vals, { B2: 'Azul', B3: 'Verde', B4: 'Rojo' }, 'Reflectancia superficial escalada.')
        },
        'ndvi': {
            titulo: 'Índice de Vegetación (NDVI)',
            descripcion: 'Evalúa vigor fotosintético.',
            interpretar: (vals) => `<b>Valor:</b> ${typeof vals === 'object' ? (vals.indice ?? JSON.stringify(vals)) : vals}`
        }
    };

    const meta = metadatosCapas[claveCapa] || {
        titulo: nombre_capa || 'Información del Píxel',
        descripcion: 'Valores espectrales o de radar recuperados.',
        interpretar: (vals) => `<pre style="font-size:0.9em;">${JSON.stringify(vals, null, 2)}</pre>`
    };

    return `
        <div style="max-width: 280px; font-family: system-ui, -apple-system, sans-serif; font-size: 0.88em; line-height: 1.35; color: #222;">
            <div style="border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 6px;">
                <h4 style="margin: 0; color: #1a73e8; font-size: 1.05em;">${meta.titulo}</h4>
                <small style="color: #777;">Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}</small>
            </div>
            <p style="margin: 0 0 8px 0; color: #555; font-size: 0.85em;">${meta.descripcion}</p>
            ${meta.interpretar(valores)}
        </div>
    `;
}

// Evento de clic sobre el mapa (Inspector de Píxel)
map.on('click', async function(e) {
    const sensor = document.getElementById('sensor').value;
    const tipoCapa = document.getElementById('tipoCapa').value;
    const fechaInicio = document.getElementById('fechaInicio').value;
    const fechaFin = document.getElementById('fechaFin').value;
    const porcentajeNubes = parseFloat(document.getElementById('cloudSlider').value);
    const orbita = document.getElementById('orbita').value;

    if (!capaActiva || !tipoCapa) return;

    const lat = e.latlng.lat;
    const lng = e.latlng.lng;

    popupInspector
        .setLatLng(e.latlng)
        .setContent(`
            <div style="text-align: center; padding: 8px;">
                <b style="color: #1a73e8;">Consultando ${sensor.toUpperCase()}...</b><br>
                <small style="color: #666;">Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}</small>
            </div>
        `)
        .openOn(map);

    try {
        const response = await fetch(`${API_URL}/api/inspeccionar-pixel`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sensor: sensor,
                tipo_capa: tipoCapa,
                fecha_inicio: fechaInicio,
                fecha_fin: fechaFin,
                lat: lat,
                lng: lng,
                porcentaje_nubes: porcentajeNubes,
                orbita: orbita
            })
        });

        const data = await response.json();

        if (response.ok && data.status === 'ok') {
            const htmlEnriquecido = construirContenidoPopup(data, tipoCapa, lat, lng);
            popupInspector.setContent(htmlEnriquecido);
        } else {
            popupInspector.setContent(`<i>${data.message || 'Sin datos disponibles para este punto.'}</i>`);
        }

    } catch (error) {
        console.error(error);
        popupInspector.setContent('<i>Error de comunicación al consultar el valor del píxel.</i>');
    }
});

// Inicialización automática
window.onload = function() {
    inicializarFechas30Dias();
    cargarOpcionesCapas();
};