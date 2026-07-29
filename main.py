import os
import json
from typing import List
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import ee

# ------------------------------------------------------------------------------
# Configuración e Inicialización de Google Earth Engine
# ------------------------------------------------------------------------------
# Leemos las credenciales desde el Secret de Hugging Face
gee_credentials_env = os.getenv("GEE_CREDENTIALS")

if gee_credentials_env:
    # Cargar credenciales desde la variable de entorno JSON
    credentials_info = json.loads(gee_credentials_env)
    credentials = ee.ServiceAccountCredentials(
        email=credentials_info["client_email"],
        key_data=gee_credentials_env
    )
    PROJECT_ID = credentials_info.get("project_id", "mapas-495614")
else:
    # Fallback local para pruebas en tu PC
    KEY_FILE_PATH = 'credenciales_gee.json'
    SERVICE_ACCOUNT_EMAIL = 'gee-backend-service@mapas-495614.iam.gserviceaccount.com'
    PROJECT_ID = 'mapas-495614'
    credentials = ee.ServiceAccountCredentials(
        email=SERVICE_ACCOUNT_EMAIL,
        key_file=KEY_FILE_PATH
    )

ee.Initialize(credentials=credentials, project=PROJECT_ID)

# ------------------------------------------------------------------------------
# Configuración de FastAPI
# ------------------------------------------------------------------------------
app = FastAPI(title="Geovisor Earth Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def cargar_configuracion_capas():
    with open("capas_config.json", "r", encoding="utf-8") as file:
        return json.load(file)

def enmascarar_nubes_s2(imagen):
    qa = imagen.select('QA60')
    mascara_nubes = 1 << 10
    mascara_cirros = 1 << 11
    mask = qa.bitwiseAnd(mascara_nubes).eq(0).And(qa.bitwiseAnd(mascara_cirros).eq(0))
    return imagen.updateMask(mask)

class SolicitudCapa(BaseModel):
    fecha_inicio: str
    fecha_fin: str
    tipo_capa: str
    bbox: List[float]

# ------------------------------------------------------------------------------
# Endpoints de la API
# ------------------------------------------------------------------------------
@app.get("/api/capas")
def obtener_lista_capas():
    config = cargar_configuracion_capas()
    return {clave: info["nombre"] for clave, info in config.items()}

@app.post("/api/capa")
def generar_capa(datos: SolicitudCapa):
    config = cargar_configuracion_capas()
    if datos.tipo_capa not in config:
        raise HTTPException(status_code=400, detail="Capa no válida")

    capa_info = config[datos.tipo_capa]

    try:
        area_visible = ee.Geometry.BBox(
            datos.bbox[0], datos.bbox[1], datos.bbox[2], datos.bbox[3]
        )

        s2_raw = (
            ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(area_visible)
            .filterDate(datos.fecha_inicio, datos.fecha_fin)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
        )

        s2_limpio = s2_raw.map(enmascarar_nubes_s2)

        fechas_pasadas = (
            s2_limpio.aggregate_array('system:time_start')
            .map(lambda d: ee.Date(d).format('YYYY-MM-dd'))
            .distinct()
            .getInfo()
        )

        if not fechas_pasadas:
            return {
                "status": "warning",
                "message": "No se encontraron pasadas satelitales utilizables en este rango.",
                "tile_url": None,
                "fechas_pasadas": []
            }

        imagen = s2_limpio.median()

        if capa_info["metodo"] == "normalized_difference":
            calculo = imagen.normalizedDifference(capa_info["bandas"])
        elif capa_info["metodo"] == "select":
            calculo = imagen.select(capa_info["bandas"])

        map_id = calculo.getMapId(capa_info["vis_params"])
        
        return {
            "status": "ok",
            "tile_url": map_id['tile_fetcher'].url_format,
            "fechas_pasadas": sorted(fechas_pasadas),
            "vis_params": capa_info.get("vis_params", {}),
            "nombre_capa": capa_info.get("nombre", "")
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/descargar-geotiff")
def descargar_geotiff(datos: SolicitudCapa):
    config = cargar_configuracion_capas()
    if datos.tipo_capa not in config:
        raise HTTPException(status_code=400, detail="Capa no válida")

    capa_info = config[datos.tipo_capa]

    try:
        area_visible = ee.Geometry.BBox(
            datos.bbox[0], datos.bbox[1], datos.bbox[2], datos.bbox[3]
        )

        s2_raw = (
            ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(area_visible)
            .filterDate(datos.fecha_inicio, datos.fecha_fin)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
        )

        s2_limpio = s2_raw.map(enmascarar_nubes_s2)
        imagen = s2_limpio.median()

        if capa_info["metodo"] == "normalized_difference":
            calculo = imagen.normalizedDifference(capa_info["bandas"])
        elif capa_info["metodo"] == "select":
            calculo = imagen.select(capa_info["bandas"])

        url_descarga = calculo.getDownloadURL({
            'name': f"{datos.tipo_capa}_{datos.fecha_inicio}_a_{datos.fecha_fin}",
            'scale': 10,
            'crs': 'EPSG:4326',
            'region': area_visible,
            'format': 'GEO_TIFF'
        })

        return {"status": "ok", "download_url": url_descarga}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar GeoTIFF: {str(e)}")

# ------------------------------------------------------------------------------
# Servir Archivos Estáticos (Frontend)
# ------------------------------------------------------------------------------
@app.get("/")
def read_root():
    return FileResponse("index.html")

app.mount("/", StaticFiles(directory=".", html=True), name="static")