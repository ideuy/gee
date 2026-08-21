import os
import json
import ee
from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from dotenv import load_dotenv

# ==========================================
# 1. CONFIGURACIÓN INICIAL Y AUTENTICACIÓN
# ==========================================
load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SERVICE_ACCOUNT_EMAIL = os.getenv('SERVICE_ACCOUNT_EMAIL')
PROJECT_ID = os.getenv('PROJECT_ID')
KEY_DATA = os.getenv('KEY_DATA')
KEY_FILE_PATH = os.getenv('KEY_FILE_PATH')

try:
    if KEY_DATA:
        # Modo Producción (Render)
        credentials = ee.ServiceAccountCredentials(
            email=SERVICE_ACCOUNT_EMAIL,
            key_data=KEY_DATA
        )
    elif KEY_FILE_PATH and os.path.exists(KEY_FILE_PATH):
        # Modo Desarrollo (Local)
        credentials = ee.ServiceAccountCredentials(
            email=SERVICE_ACCOUNT_EMAIL,
            key_file=KEY_FILE_PATH
        )
    else:
        raise ValueError("No se encontraron credenciales válidas para GEE.")

    ee.Initialize(credentials=credentials, project=PROJECT_ID)
    print("✅ Google Earth Engine inicializado correctamente.")
except Exception as e:
    print(f"❌ Error al inicializar GEE: {e}")

# ==========================================
# 2. CARGAR CONFIGURACIÓN DE CAPAS
# ==========================================
CONFIG_PATH = "capas.json"

try:
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config_capas = json.load(f)
        print(f"✅ Archivo de configuración '{CONFIG_PATH}' cargado exitosamente.")
except Exception as e:
    print(f"❌ Error crítico al cargar {CONFIG_PATH}: {e}")
    config_capas = {"sentinel-2": {}, "sentinel-1": {}}

# ==========================================
# 3. MODELOS PYDANTIC (ENTRADAS DE LA API)
# ==========================================
class CapaRequest(BaseModel):
    sensor: str = Field(default="sentinel-2", description="sentinel-1 o sentinel-2")
    tipo_capa: str
    fecha_inicio: str
    fecha_fin: str
    bbox: List[float]
    porcentaje_nubes: Optional[int] = 30
    orbita: Optional[str] = "AMBAS"

class PixelRequest(BaseModel):
    sensor: str = Field(default="sentinel-2")
    tipo_capa: str
    lat: float
    lng: float
    fecha_inicio: str
    fecha_fin: str
    porcentaje_nubes: Optional[int] = 30
    orbita: Optional[str] = "AMBAS"

class DescargaRequest(BaseModel):
    sensor: str = Field(default="sentinel-2")
    tipo_capa: str
    fecha_inicio: str
    fecha_fin: str
    bbox: List[float]
    porcentaje_nubes: Optional[int] = 30
    orbita: Optional[str] = "AMBAS"

# ==========================================
# 4. LÓGICA DE PROCESAMIENTO GEE (POR SENSOR)
# ==========================================
def enmascarar_nubes_s2(image):
    """Enmascara nubes usando QA60 SIN dividir por 10000 para preservar los rangos originales 0-10000"""
    qa = image.select('QA60')
    cloudBitMask = 1 << 10
    cirrusBitMask = 1 << 11
    mask = qa.bitwiseAnd(cloudBitMask).eq(0).And(qa.bitwiseAnd(cirrusBitMask).eq(0))
    return image.updateMask(mask)

def procesar_sentinel_2(req, geometria):
    """Lógica core dinámica para Sentinel-2 basada en capas.json"""
    coleccion = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED") \
        .filterBounds(geometria) \
        .filterDate(req.fecha_inicio, req.fecha_fin) \
        .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', req.porcentaje_nubes)) \
        .map(enmascarar_nubes_s2)
    
    mediana = coleccion.median()
    
    config_capa = config_capas.get("sentinel-2", {}).get(req.tipo_capa, {})
    metodo = config_capa.get("metodo")
    bandas = config_capa.get("bandas", [])

    if metodo == "normalized_difference" and len(bandas) == 2:
        indice = mediana.normalizedDifference(bandas).rename(req.tipo_capa.upper())
        mediana = mediana.addBands(indice)
    elif metodo == "custom_formula" and req.tipo_capa == "bsi":
        swir1 = mediana.select('B11')
        red = mediana.select('B4')
        nir = mediana.select('B8')
        blue = mediana.select('B2')
        bsi = swir1.add(red).subtract(nir.add(blue)) \
            .divide(swir1.add(red).add(nir.add(blue))) \
            .rename('BSI')
        mediana = mediana.addBands(bsi)
        
    return mediana

def procesar_sentinel_1(req, geometria):
    """Lógica core para Sentinel-1 (Radar SAR) con soporte completo para índices e hidrología"""
    coleccion = ee.ImageCollection("COPERNICUS/S1_GRD") \
        .filterBounds(geometria) \
        .filterDate(req.fecha_inicio, req.fecha_fin) \
        .filter(ee.Filter.eq('instrumentMode', 'IW')) \
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')) \
        .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))

    if req.orbita and req.orbita.upper() in ["ASCENDING", "DESCENDING"]:
        coleccion = coleccion.filter(ee.Filter.eq('orbitProperties_pass', req.orbita.upper()))

    # Obtenemos las medianas base en dB
    mediana = coleccion.select(['VV', 'VH']).median()
    
    # Relación VV / VH
    vv_vh_db = mediana.select('VV').subtract(mediana.select('VH')).rename('VV_VH')
    mediana = mediana.addBands(vv_vh_db)

    # Cálculos condicionales específicos integrados en el objeto de salida
    if req.tipo_capa == "mdi":
        mdi = mediana.select('VV').add(20).divide(20).rename('MDI')
        mediana = mediana.addBands(mdi)
        
    elif req.tipo_capa == "inundacion":
        inundacion = mediana.select('VV').lt(-18).rename('INUNDACION')
        mediana = mediana.addBands(inundacion)
        
    elif req.tipo_capa == "rvi":
        vv_l = ee.Image(10).pow(mediana.select('VV').divide(10))
        vh_l = ee.Image(10).pow(mediana.select('VH').divide(10))
        rvi = vh_l.multiply(4).divide(vv_l.add(vh_l)).rename('RVI')
        mediana = mediana.addBands(rvi)

    return mediana

# ==========================================
# 5. ENDPOINTS DE LA API REST
# ==========================================
@app.get("/api/capas")
async def obtener_capas(sensor: Optional[str] = None):
    """Devuelve la configuración completa de capas."""
    return config_capas

@app.post("/api/capa")
async def obtener_capa(req: CapaRequest):
    try:
        geometria = ee.Geometry.Rectangle(req.bbox)
        
        if req.sensor == "sentinel-2":
            coleccion = ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED") \
                .filterBounds(geometria) \
                .filterDate(req.fecha_inicio, req.fecha_fin) \
                .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', req.porcentaje_nubes)) \
                .map(enmascarar_nubes_s2)
            imagen = coleccion.median()
            config_vis = config_capas.get("sentinel-2", {}).get(req.tipo_capa)
        elif req.sensor == "sentinel-1":
            coleccion = ee.ImageCollection("COPERNICUS/S1_GRD") \
                .filterBounds(geometria) \
                .filterDate(req.fecha_inicio, req.fecha_fin) \
                .filter(ee.Filter.eq('instrumentMode', 'IW')) \
                .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV')) \
                .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
            
            if req.orbita and req.orbita.upper() in ["ASCENDING", "DESCENDING"]:
                coleccion = coleccion.filter(ee.Filter.eq('orbitProperties_pass', req.orbita.upper()))
            
            # Se invoca la función centralizada que ya añade todas las bandas dinámicas necesarias
            imagen = procesar_sentinel_1(req, geometria)
            config_vis = config_capas.get("sentinel-1", {}).get(req.tipo_capa)
        else:
            raise ValueError(f"Sensor no soportado: {req.sensor}")

        if not config_vis:
            raise ValueError(f"Configuración no encontrada para: {req.tipo_capa} en {req.sensor}")

        # Aplicar procesamiento de índices si corresponde (para Sentinel-2)
        metodo = config_vis.get("metodo")
        bandas = config_vis.get("bandas", [])
        
        if req.sensor == "sentinel-2":
            if metodo == "normalized_difference" and len(bandas) == 2:
                indice = imagen.normalizedDifference(bandas).rename(req.tipo_capa.upper())
                imagen = imagen.addBands(indice)
            elif metodo == "custom_formula" and req.tipo_capa == "bsi":
                swir1 = imagen.select('B11')
                red = imagen.select('B4')
                nir = imagen.select('B8')
                blue = imagen.select('B2')
                bsi = swir1.add(red).subtract(nir.add(blue)) \
                    .divide(swir1.add(red).add(nir.add(blue))) \
                    .rename('BSI')
                imagen = imagen.addBands(bsi)

        # Configurar visualización de forma segura
        v_params_json = config_vis.get("vis_params", {})
        
        if req.tipo_capa in ["ndvi", "ndwi", "ndmi", "ndbi", "nbr", "ui", "bsi", "rvi", "mdi", "inundacion"]:
            vis_bands = [req.tipo_capa.upper()]
        elif req.tipo_capa == "rgb_sar":
            vis_bands = ["VV", "VH", "VV_VH"]
        else:
            vis_bands = config_vis.get('bandas') 

        vis_params = {
            'bands': vis_bands,
            'min': config_vis.get('min', v_params_json.get('min', 0)),
            'max': config_vis.get('max', v_params_json.get('max', 3000))
        }
        
        if isinstance(vis_bands, list) and len(vis_bands) == 1:
            if 'palette' in v_params_json:
                vis_params['palette'] = v_params_json['palette']
            elif 'paleta' in config_vis:
                vis_params['palette'] = config_vis['paleta']
                
        if 'gamma' in v_params_json:
            vis_params['gamma'] = v_params_json['gamma']

        map_id = ee.Image(imagen).getMapId(vis_params)

        try:
            lista_fechas = coleccion.aggregate_array('system:time_start') \
                .map(lambda t: ee.Date(t).format('YYYY-MM-dd')) \
                .distinct().getInfo()
        except Exception:
            lista_fechas = []

        return {
            "tile_url": map_id['tile_fetcher'].url_format,
            "vis_params": vis_params,
            "nombre_capa": config_vis.get("nombre", req.tipo_capa),
            "fechas_pasadas": lista_fechas if lista_fechas else []
        }
        
    except Exception as e:
        return {"error": str(e), "message": str(e)}
    
@app.post("/api/inspeccionar-pixel")
async def inspeccionar_pixel(req: PixelRequest):
    try:
        punto = ee.Geometry.Point([req.lng, req.lat])
        
        if req.sensor == "sentinel-2":
            imagen = procesar_sentinel_2(req, punto)
            config_vis = config_capas.get("sentinel-2", {}).get(req.tipo_capa)
        elif req.sensor == "sentinel-1":
            imagen = procesar_sentinel_1(req, punto)
            config_vis = config_capas.get("sentinel-1", {}).get(req.tipo_capa)
        else:
            raise ValueError(f"Sensor no soportado: {req.sensor}")

        if not config_vis:
            raise ValueError(f"Configuración no encontrada para: {req.tipo_capa} en {req.sensor}")
            
        bandas = config_vis.get('bandas', [])
        if req.tipo_capa in ["ndvi", "ndwi", "ndmi", "ndbi", "nbr", "ui", "bsi", "rvi", "mdi", "inundacion"]:
            bandas = [req.tipo_capa.upper()]

        valores = imagen.select(bandas).reduceRegion(
            reducer=ee.Reducer.mean(),
            geometry=punto,
            scale=10,
            maxPixels=1e9
        ).getInfo()

        return {
            "status": "ok",
            "nombre_capa": config_vis.get("nombre", req.tipo_capa),
            "metodo": config_vis.get("metodo", "select"),
            "valores": valores
        }
        
    except Exception as e:
        return {"status": "error", "message": str(e)}

@app.post("/api/descargar-geotiff")
async def descargar_geotiff(req: DescargaRequest):
    try:
        geometria = ee.Geometry.Rectangle(req.bbox)
        
        if req.sensor == "sentinel-2":
            imagen = procesar_sentinel_2(req, geometria)
            config_vis = config_capas.get("sentinel-2", {}).get(req.tipo_capa)
        elif req.sensor == "sentinel-1":
            imagen = procesar_sentinel_1(req, geometria)
            config_vis = config_capas.get("sentinel-1", {}).get(req.tipo_capa)
        else:
            raise ValueError("Sensor no soportado.")
            
        if not config_vis:
            raise ValueError("Configuración de capa no encontrada.")
            
        bandas = config_vis.get('bandas', [])
        if req.tipo_capa in ["ndvi", "ndwi", "ndmi", "ndbi", "nbr", "ui", "bsi", "rvi", "mdi", "inundacion"]:
            bandas = [req.tipo_capa.upper()]
            
        imagen_descarga = imagen.select(bandas)
        
        url_descarga = imagen_descarga.getDownloadURL({
            'scale': 10,
            'crs': 'EPSG:4326',
            'region': geometria,
            'format': 'GEO_TIFF'
        })
        
        return {"download_url": url_descarga}
        
    except Exception as e:
        return {"detail": str(e)}

# ==========================================
# 6. ARCHIVOS ESTÁTICOS (FRONTEND)
# ==========================================
app.mount("/", StaticFiles(directory="static", html=True), name="static")