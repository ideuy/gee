# Geovisor Satelital Interactivo - Google Earth Engine & FastAPI

Es un **Geovisor Web Full-Stack** liviano y modular diseñado para la visualización y análisis de imágenes satelitales en tiempo real utilizando datos de **Copernicus Sentinel-2** a través de la API de **Google Earth Engine (GEE)**, con un backend asíncrono en **FastAPI** y una interfaz cartográfica responsiva en **Leaflet.js**.

---

## Características Principales

- **Procesamiento de Índices Espectrales en Tiempo Real:** Cálculo dinámico al vuelo de **NDVI** (Índice de Vegetación) y **NDWI** (Índice de Agua), así como composiciones en **Color Real (RGB)** e **Infrarrojo (Falso Color)**.
- **Filtrado Automático de Nubes:** Enmascaramiento inteligente de nubes y cirros utilizando la banda de calidad `QA60` de Sentinel-2 para obtener mosaicos limpios.
- **Consulta Dinámica de Pasadas Satelitales:** Identificación y despliegue de las fechas exactas de las capturas satelitales disponibles dentro del área de interés (AOI) y rango temporal seleccionado.
- **Leyenda Dinámica Adaptativa:** Renderizado interactivo de gradientes de color y rangos de valores para índices cuantitativos (NDVI/NDWI) que se oculta automáticamente en composiciones RGB.
- **Sincronización por Bounding Box (`bbox`):** Procesa únicamente la extensión geográfica visible en la pantalla del usuario para optimizar el rendimiento y consumo de memoria.
- **Exportación e Integración GIS:** Generación de enlaces de descarga directa en formato **GeoTIFF** georreferenciado (EPSG:4326 a 10m de resolución) para análisis en software SIG (QGIS, ArcGIS).
- **Autenticación Híbrida Segura:** Soporte transparente para archivo local `credenciales_gee.json` en desarrollo y variables de entorno (`GEE_CREDENTIALS`) en producción.
- **Containerización con Docker:** Listo para desplegar en cualquier entorno Cloud mediante contenedores optimizados.

---

## Arquitectura del Sistema

```text
       ┌─────────────────────────────────────────────────────────┐
       │                   Navegador Web                         │
       │  Leaflet.js + HTML5 / CSS3 (Panel Flotante + Leyenda)   │
       └──────────────────────────┬──────────────────────────────┘
                                  │ Peticiones HTTP REST / JSON
                                  ▼
       ┌─────────────────────────────────────────────────────────┐
       │                   Backend FastAPI                       │
       │    (Servidor Uvicorn / Contenedor Docker en Render)     │
       └──────────────────────────┬──────────────────────────────┘
                                  │ Autenticación Service Account / API Python
                                  ▼
       ┌─────────────────────────────────────────────────────────┐
       │               Google Earth Engine (GEE)                 │
       │    Procesamiento espacial de colecciones Sentinel-2      │
       └──────────────────────────┬──────────────────────────────┘
                                  │ Plantillas de Tiles (XYZ) / GeoTIFF
                                  ▼
       ┌─────────────────────────────────────────────────────────┐
       │             Capas MapId / Servidor de Tiles             │
       └─────────────────────────────────────────────────────────┘
```

---

## Estructura del Proyecto

```text
.
├── capas_config.json      # Configuración modular de capas, algoritmos y paletas
├── credenciales_gee.json # Credenciales Service Account de Google Cloud (Solo Local / GitIgnored)
├── Dockerfile             # Configuración de imagen Docker optimizada para producción
├── estilos.css            # Estilos del geovisor, paneles flotantes, leyenda y badges
├── index.html             # Interfaz de usuario con mapa interactivo Leaflet
├── main.py                # Servidor backend FastAPI y conexión con Google Earth Engine
├── requirements.txt       # Dependencias del proyecto en Python
└── .gitignore             # Protección de archivos sensibles y entornos virtuales
```

---

## Recursos utilizados para crear el proyecto

1. **Python 3.13.7** para desarrollo.
2. **Cuenta de Google Cloud Platform (GCP)** con la **Earth Engine API** habilitada.
3. **Service Account de GCP** con rol de acceso a Earth Engine y su correspondiente archivo de clave privada en formato JSON (`credenciales_gee.json`).

---

## Configuración Modular de Capas (`capas_config.json`)

Para agregar nuevas capas o modificar las existentes, basta con editar el archivo `capas_config.json` sin necesidad de alterar el código del backend:

```json
{
  "ndvi": {
    "nombre": "Índice de Vegetación (NDVI)",
    "metodo": "normalized_difference",
    "bandas": ["B8", "B4"],
    "vis_params": {
      "min": 0.0,
      "max": 0.8,
      "palette": ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"]
    }
  },
  "rgb": {
    "nombre": "Color Natural (RGB)",
    "metodo": "select",
    "bandas": ["B4", "B3", "B2"],
    "vis_params": {
      "min": 0,
      "max": 3000,
      "gamma": 1.4
    }
  }
}
```

---

## Referencia de la API (REST Endpoints)

| Método | Endpoint | Descripción | Payload / Parámetros |
| :--- | :--- | :--- | :--- |
| `GET` | `/` | Sirve la aplicación web principal (`index.html`) | N/A |
| `GET` | `/api/capas` | Obtiene el diccionario de capas disponibles | N/A |
| `POST` | `/api/capa` | Procesa la imagen en GEE y retorna la URL de tiles, pasadas y leyenda | `{ "fecha_inicio": "YYYY-MM-DD", "fecha_fin": "YYYY-MM-DD", "tipo_capa": "ndvi", "bbox": [west, south, east, north] }` |
| `POST` | `/api/descargar-geotiff` | Genera enlace de descarga directa en formato GeoTIFF | `{ "fecha_inicio": "YYYY-MM-DD", "fecha_fin": "YYYY-MM-DD", "tipo_capa": "ndvi", "bbox": [west, south, east, north] }` |

---

## Despliegue en Producción (Render / Docker)

1. El proyecto se publicó en un repositorio en **GitHub**.
2. Se creó un **Web Service** en [Render.com](https://render.com/) y se vinculó el repositorio publicado de GitHub.
3. Render detecta automáticamente el `Dockerfile` del proyecto.
4. Al desplegar Render asignó un puerto dinámico mediante `$PORT` y proporcionó la URL HTTPS pública: [https://gee-ezk5.onrender.com/](https://gee-ezk5.onrender.com/)

---

## Licencia

Este proyecto está bajo la Licencia **MIT**. Consulta el archivo `LICENSE` para más detalles.

---

## Agradecimientos & Fuentes de Datos

- **Copernicus Sentinel Data:** Por proveer imágenes satelitales ópticas multiespectrales abiertas.
- **Google Earth Engine API:** Por la capacidad de cómputo en la nube para procesamiento geoespacial.
- **Leaflet.js & OpenStreetMap:** Por las bibliotecas de mapas interactivos de código abierto.
