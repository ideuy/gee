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

// 6. Configuración y formateador enriquecido para el Inspector de Píxel
function construirContenidoPopup(data, tipoCapa, lat, lng) {
    const { nombre_capa, metodo, valores } = data;

    // 1. Detección inteligente por palabras clave
    const textoBusqueda = `${tipoCapa || ''} ${nombre_capa || ''}`.toLowerCase();

    let claveCapa = 'desconocida';
    if (textoBusqueda.includes('asfalto') || textoBusqueda.includes('infraestructura')) {
        claveCapa = 'infraestructura_asfalto';
    } else if (textoBusqueda.includes('vial') || textoBusqueda.includes('impermeable') || textoBusqueda.includes('red_vial')) {
        claveCapa = 'red_vial_alta_resolucion';
    } else if (textoBusqueda.includes('bsi') || textoBusqueda.includes('desnudo')) {
        claveCapa = 'bsi';
    } else if (textoBusqueda.includes('ui') || (textoBusqueda.includes('urbano') && !textoBusqueda.includes('ndbi'))) {
        claveCapa = 'ui';
    } else if (textoBusqueda.includes('swir') || textoBusqueda.includes('agri') || textoBusqueda.includes('humedad')) {
        claveCapa = 'swir';
    } else if (textoBusqueda.includes('natural') || textoBusqueda.includes('rgb')) {
        claveCapa = 'color_natural';
    } else if (textoBusqueda.includes('falso')) {
        claveCapa = 'falso_color';
    } else if (textoBusqueda.includes('ndvi')) {
        claveCapa = 'ndvi';
    } else if (textoBusqueda.includes('ndwi')) {
        claveCapa = 'ndwi';
    } else if (textoBusqueda.includes('ndbi')) {
        claveCapa = 'ndbi';
    } else if (textoBusqueda.includes('ndmi')) {
        claveCapa = 'ndmi';
    } else if (textoBusqueda.includes('nbr')) {
        claveCapa = 'nbr';
    }

    // -------------------------------------------------------------------------
    // HELPERS: Generadores de HTML reutilizables
    // -------------------------------------------------------------------------
    
    const renderIndice = (vals, rangos) => {
        const val = vals?.indice !== undefined ? vals.indice : (typeof vals === 'number' ? vals : null);
        if (val === undefined || val === null) return '<i>Sin datos en esta coordenada.</i>';

        const regla = rangos.find(r => val > r.threshold) || rangos[rangos.length - 1];

        return `
            <div style="margin: 8px 0; display: flex; align-items: center; justify-content: space-between;">
                <b>Valor calculado:</b>
                <span style="font-size: 1.15em; font-weight: bold; color: ${regla.color};">${val.toFixed(4)}</span>
            </div>
            <div style="background: #f5f5f5; padding: 6px 8px; border-left: 3px solid ${regla.color}; border-radius: 2px;">
                <b>Diagnóstico:</b> <span style="color: #333;">${regla.diagnostico}</span>
            </div>
        `;
    };

    const renderBandas = (vals, nombresBandas = {}, interpretacionText = '') => {
        if (!vals) return '<i>Sin datos en esta coordenada.</i>';

        const items = Object.entries(vals).map(([banda, val]) => {
            const etiqueta = nombresBandas[banda] || banda;
            const pct = (val !== null && val !== undefined) ? (val / 100).toFixed(2) : '-';
            return `<li><b>${etiqueta}:</b> ${val ?? '-'} <span style="color:#666;">(${pct}%)</span></li>`;
        }).join('');

        return `
            <div style="margin: 6px 0;">
                <b>Desglose por Banda (Reflectancia):</b>
                <ul style="margin: 4px 0; padding-left: 18px;">${items}</ul>
            </div>
            <div style="background: #f0f4f9; padding: 6px; border-radius: 4px; font-size: 0.82em; color: #444;">
                <b>Interpretación:</b> ${interpretacionText}
            </div>
        `;
    };

    // -------------------------------------------------------------------------
    // DICCIONARIO DE CAPAS
    // -------------------------------------------------------------------------
    const metadatosCapas = {
        'ui': {
            titulo: 'Índice Urbano (UI)',
            descripcion: 'Mide la presencia de estructuras construidas, techos y pavimentos comparando SWIR2 (B12) con NIR (B8).',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.1, color: '#f03b20', diagnostico: 'Superficie construida densa, pavimentos, asfalto o edificación' },
                { threshold: -0.1, color: '#feb24c', diagnostico: 'Zona de transición, suelo descubierto o infraestructura dispersa' },
                { threshold: -Infinity, color: '#3182bd', diagnostico: 'Cobertura natural (Vegetación activa, bosque o cuerpos de agua)' }
            ])
        },
        'bsi': {
            titulo: 'Índice de Suelo Desnudo (BSI)',
            descripcion: 'Combina bandas espectrales para diferenciar suelo limpio, tierra arada y movimiento de suelos por obras viales.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.15, color: '#a63603', diagnostico: 'Suelo totalmente descubierto, movimiento de tierras o cantera' },
                { threshold: 0.0, color: '#fe9929', diagnostico: 'Suelo parcialmente despejado, rastrojo seco o baja densidad vegetal' },
                { threshold: -Infinity, color: '#006837', diagnostico: 'Suelo cubierto por vegetación viva o agua' }
            ])
        },
        'infraestructura_asfalto': {
            titulo: 'Infraestructura, Asfalto y Hormigón',
            descripcion: 'Combinación SWIR2-SWIR1-Rojo (B12, B11, B4) para resaltar materiales de construcción y red vial.',
            interpretar: (vals) => renderBandas(vals, 
                { B12: 'B12 (SWIR 2)', B11: 'B11 (SWIR 1)', B4: 'B4 (Rojo)' },
                'El hormigón y asfalto destacan en tonos brillantes o azulados, mientras que el suelo desnudo aparece magenta/marrón.'
            )
        },
        'red_vial_alta_resolucion': {
            titulo: 'Traza Vial y Cobertura Impermeable',
            descripcion: 'Combinación NIR-SWIR1-Rojo (B8, B11, B4) aprovechando la resolución espacial de 10 m de la banda B8 para perfilar caminos y calles.',
            interpretar: (vals) => renderBandas(vals, 
                { B8: 'B8 (NIR - 10m)', B11: 'B11 (SWIR 1)', B4: 'B4 (Rojo)' },
                'Ofrece alta definición de bordes. Ideal para identificar apertura de caminos, rutas secundarias y vías de tren.'
            )
        },
        'color_natural': {
            titulo: 'Reflectancia de la Superficie (Color Natural RGB)',
            descripcion: 'Mide la proporción de luz solar que refleja la Tierra en el espectro visible (Azul, Verde, Rojo), reproduciendo el color real del terreno.',
            interpretar: (vals) => renderBandas(vals, 
                { B2: 'B2 (Azul)', B3: 'B3 (Verde)', B4: 'B4 (Rojo)' },
                'Los valores corresponden al producto Sentinel-2 Nivel-2A (Reflectancia en Superficie escalada x 10.000).'
            )
        },
        'falso_color': {
            titulo: 'Reflectancia Infrarroja (Falso Color)',
            descripcion: 'Destaca la respuesta de la vegetación densa y estructuras urbanas usando el Infrarrojo Cercano.',
            interpretar: (vals) => renderBandas(vals, 
                { B8: 'B8 (NIR - Infrarrojo)', B4: 'B4 (Rojo)', B3: 'B3 (Verde)' },
                'La cubierta vegetal viva refleja con gran intensidad en B8 (NIR). Cuanto mayor es el % de B8 respecto a B4, mayor es el vigor celular.'
            )
        },
        'swir': {
            titulo: 'Agricultura / Humedad Suelo (SWIR)',
            descripcion: 'Combina el Infrarrojo de Onda Corta con NIR para penetrar bruma atmosférica, medir humedad foliar/suelo y diferenciar vegetación de suelo desnudo.',
            interpretar: (vals) => renderBandas(vals, 
                { B11: 'B11 (SWIR 1)', B12: 'B12 (SWIR 2)', B8: 'B8 (NIR - Infrarrojo)', B2: 'B2 (Azul)', B3: 'B3 (Verde)', B4: 'B4 (Rojo)' },
                'Las bandas SWIR absorben fuertemente en presencia de agua. Los valores divididos entre 10.000 representan el porcentaje real de reflectancia.'
            )
        },
        'ndvi': {
            titulo: 'Índice de Vegetación (NDVI)',
            descripcion: 'Evalúa la masa foliar y la salud fotosintética de la vegetación. Rango: -1.0 a +1.0.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.5, color: '#2e7d32', diagnostico: 'Vegetación densa, boscosa o cultivos de alto vigor' },
                { threshold: 0.2, color: '#7cb342', diagnostico: 'Vegetación escasa, pastizales o cultivos en desarrollo' },
                { threshold: 0.0, color: '#8d6e63', diagnostico: 'Suelo desnudo, rocas o cobertura urbana' },
                { threshold: -Infinity, color: '#0288d1', diagnostico: 'Cuerpo de agua, nieve o sombras profundas' }
            ])
        },
        'ndwi': {
            titulo: 'Índice de Agua (NDWI)',
            descripcion: 'Delimita la presencia de agua superficial y el nivel de humedad del suelo/foliar. Rango: -1.0 a +1.0.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.3, color: '#0288d1', diagnostico: 'Cuerpo de agua claro (ríos, lagunas, embalses)' },
                { threshold: 0.0, color: '#00acc1', diagnostico: 'Zona húmeda, vegetación saturada o agua turbia' },
                { threshold: -Infinity, color: '#616161', diagnostico: 'Superficie no acuática (suelo seco, vegetación o zona urbana)' }
            ])
        },
        'ndbi': {
            titulo: 'Índice de Edificación / Urbano (NDBI)',
            descripcion: 'Mide la presencia de zonas construidas, infraestructuras y superficies impermeables comparando SWIR y NIR. Rango: -1.0 a +1.0.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.1, color: '#d32f2f', diagnostico: 'Área urbana, edificación, pavimento o suelo desnudo árido/seco' },
                { threshold: -0.1, color: '#f57c00', diagnostico: 'Cobertura mixta, vegetación escasa o transición rural/urbana' },
                { threshold: -Infinity, color: '#388e3c', diagnostico: 'Zona no urbana (Vegetación saludable, humedad o cuerpo de agua)' }
            ])
        },
        'ndmi': {
            titulo: 'Índice de Humedad de la Vegetación (NDMI)',
            descripcion: 'Mide el contenido de agua en la cubierta vegetal (NIR - SWIR). Clave para estrés hídrico y prevención de incendios. Rango: -1.0 a +1.0.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.3, color: '#0288d1', diagnostico: 'Vegetación canopia densa sin estrés hídrico (alto contenido de agua)' },
                { threshold: 0.1, color: '#7cb342', diagnostico: 'Humedad moderada / vegetación con estrés hídrico leve' },
                { threshold: -0.1, color: '#f57c00', diagnostico: 'Baja humedad / estrés hídrico severo o suelo disperso' },
                { threshold: -Infinity, color: '#d32f2f', diagnostico: 'Suelo desnudo, vegetación seca/muerta o superficie sin humedad' }
            ])
        },
        'nbr': {
            titulo: 'Índice de Quemado / Incendios (NBR)',
            descripcion: 'Cuantifica la severidad del fuego y áreas afectadas comparando biomasa viva (NIR) con suelo/ceniza expuesto (SWIR2). Rango: -1.0 a +1.0.',
            interpretar: (vals) => renderIndice(vals, [
                { threshold: 0.1, color: '#2e7d32', diagnostico: 'Vegetación saludable o superficie sin evidencia de quemado' },
                { threshold: -0.1, color: '#f57c00', diagnostico: 'Suelo descubierto, vegetación muy dispersa o baja severidad de fuego' },
                { threshold: -Infinity, color: '#d32f2f', diagnostico: 'Área afectada por incendio (Severidad de quemado moderada a alta)' }
            ])
        }
    };

    // Plantilla de respaldo genérica
    const meta = metadatosCapas[claveCapa] || {
        titulo: nombre_capa || 'Información del Píxel',
        descripcion: metodo === 'normalized_difference' || metodo === 'custom_formula'
            ? 'Índice espectral calculado.' 
            : 'Valores brutos de las bandas espectrales.',
        interpretar: (vals) => `<code>${JSON.stringify(vals)}</code>`
    };

    return `
        <div style="max-width: 280px; font-family: system-ui, -apple-system, sans-serif; font-size: 0.88em; line-height: 1.35; color: #222;">
            <div style="border-bottom: 1px solid #ddd; padding-bottom: 5px; margin-bottom: 6px;">
                <h4 style="margin: 0; color: #1a73e8; font-size: 1.05em;">${meta.titulo}</h4>
                <small style="color: #777;">Coordenadas: ${lat.toFixed(4)}, ${lng.toFixed(4)}</small>
            </div>
            
            <p style="margin: 0 0 8px 0; color: #555; font-size: 0.85em;">
                ${meta.descripcion}
            </p>

            ${meta.interpretar(valores)}
        </div>
    `;
}

// Evento de clic sobre el mapa
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
            <div style="text-align: center; padding: 8px;">
                <b style="color: #1a73e8;">Consultando Sentinel-2...</b><br>
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