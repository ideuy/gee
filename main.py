import os
import json
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from dotenv import load_dotenv
import ee

# ------------------------------------------------------------------------------
# Configuración e Inicialización de Google Earth Engine desde .env
# ------------------------------------------------------------------------------
load_dotenv()

SERVICE_ACCOUNT_EMAIL = os.getenv('SERVICE_ACCOUNT_EMAIL')
KEY_FILE_PATH = os.getenv('KEY_FILE_PATH')
PROJECT_ID = os.getenv('PROJECT_ID')

credentials = ee.ServiceAccountCredentials(
    email=SERVICE_ACCOUNT_EMAIL,
    key_file=KEY_FILE_PATH
)
ee.Initialize(credentials=credentials, project=PROJECT_ID)

# ------------------------------------------------------------------------------
# Configuración de FastAPI
# ------------------------------------------------------------------------------
app = FastAPI(title="API Google Earth Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Montar carpeta estática
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/")
def servir_frontend():
    """Sirve la interfaz web del geovisor en la raíz."""
    return FileResponse("static/index.html")


def cargar_configuracion_capas():
    with open("capas_config.json", "r", encoding="utf-8") as file:
        return json.load(file)


def enmascarar_nubes_s2(imagen):
    qa = imagen.select('QA60')
    mascara_nubes = 1 << 10
    mascara_cirros = 1 << 11
    
    mask = (
        qa.bitwiseAnd(mascara_nubes).eq(0)
        .And(qa.bitwiseAnd(mascara_cirros).eq(0))
    )
    return imagen.updateMask(mask)


# Modelos Pydantic
class SolicitudCapa(BaseModel):
    fecha_inicio: str
    fecha_fin: str
    tipo_capa: str
    bbox: List[float]
    porcentaje_nubes: float = 60.0


class SolicitudPixel(BaseModel):
    fecha_inicio: str
    fecha_fin: str
    tipo_capa: str
    lat: float
    lng: float
    porcentaje_nubes: float = 60.0


# Endpoints API
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
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', datos.porcentaje_nubes))
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
                "message": "No se encontraron pasadas satelitales con este filtro de nubes.",
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
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', datos.porcentaje_nubes))
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

        return {
            "status": "ok",
            "download_url": url_descarga
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al generar GeoTIFF: {str(e)}")


@app.post("/api/inspeccionar-pixel")
def inspeccionar_pixel(datos: SolicitudPixel):
    config = cargar_configuracion_capas()
    if datos.tipo_capa not in config:
        raise HTTPException(status_code=400, detail="Capa no válida")

    capa_info = config[datos.tipo_capa]

    try:
        punto = ee.Geometry.Point([datos.lng, datos.lat])

        s2_raw = (
            ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
            .filterBounds(punto)
            .filterDate(datos.fecha_inicio, datos.fecha_fin)
            .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', datos.porcentaje_nubes))
        )

        s2_limpio = s2_raw.map(enmascarar_nubes_s2)

        if s2_limpio.size().getInfo() == 0:
            return {
                "status": "warning",
                "message": "Sin pasadas en esta ubicación para el rango/filtro seleccionado."
            }

        imagen = s2_limpio.median()

        if capa_info["metodo"] == "normalized_difference":
            calculo = imagen.normalizedDifference(capa_info["bandas"]).rename("indice")
        elif capa_info["metodo"] == "select":
            calculo = imagen.select(capa_info["bandas"])

        valores = calculo.reduceRegion(
            reducer=ee.Reducer.first(),
            geometry=punto,
            scale=10
        ).getInfo()

        return {
            "status": "ok",
            "nombre_capa": capa_info["nombre"],
            "metodo": capa_info["metodo"],
            "valores": valores
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error al inspeccionar píxel: {str(e)}")