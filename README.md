# Kokoro AI Voice Reader 🚀 (WebGPU Chrome Extension)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![WebGPU Accelerated](https://img.shields.io/badge/WebGPU-Hardware_Accelerated-blue.svg)](https://www.w3.org/TR/webgpu/)
[![Model: Kokoro-82M](https://img.shields.io/badge/Model-Kokoro--82M-purple.svg)](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
[![Audio: MP3 Encoder](https://img.shields.io/badge/Audio-Local_MP3_Encoder-orange.svg)](#exportación-de-audio-en-mp3)
[![Privacy: 100% Local](https://img.shields.io/badge/Privacy-100%25_Local_&_Offline-success.svg)](#privacidad-y-seguridad)

> **Lector inteligente de PDFs, libros extensos y textos con voces humanas ultra-naturales Kokoro-82M, acelerado por hardware mediante WebGPU y WGSL directamente en tu navegador.**  
> 100% privado, sin servidores externos, sin suscripciones a la nube y con streaming de audio inmediato.

---

## ✨ Características Principales

- **⚡ Aceleración por Hardware con WebGPU & WGSL:**
  La inferencia neuronal de **Kokoro-82M** se compila directamente a *shaders* de bajo nivel de GPU (Metal en macOS, DirectX 12 en Windows y Vulkan en Linux). Cero peajes de Python, cero inicializaciones lentas y latencia de arranque inferior a 300 ms.
- **📚 Diseñado para Libros y Documentos Masivos:**
  Probado y optimizado para obras extensas de más de 500 páginas (como *Canción de Hielo y Fuego* o antologías poéticas completas) con más de 26.000 fragmentos procesados en streaming continuo e ininterrumpido.
- **📄 Extractor de Documentos PDF Integrado (PDF.js):**
  - **PDFs Online:** Si abres cualquier documento PDF en una pestaña de Chrome, la extensión detecta y extrae el texto completo en un solo clic.
  - **PDFs / TXT Locales:** Soporte para arrastrar y soltar (*drag & drop*) o seleccionar archivos locales `.pdf`, `.txt` y `.md`.
- **🎵 Descarga de Audio en MP3 Ultraligero (LameJS):**
  - Codificador MP3 en JavaScript puro integrado en local (sin llamadas externas ni descargas de binarios).
  - Comprime el audio a **64 kbps mono a 24 kHz**, logrando una **reducción de tamaño del ~82%** respecto al WAV tradicional (ej. un libro de 1 hora pasa de 172 MB a ~28 MB).
  - **Protección de integridad:** El botón de descarga permanece bloqueado mientras el motor neuronal trabaja y se activa al alcanzar el 100% de la conversión para garantizar audios completos.
- **📊 Indicador de Progreso en Tiempo Real:**
  Visualiza en paralelo la posición de escucha (`🔊 Frase 3 de 26.000`) y el progreso de síntesis en GPU (`⚡ Sintetizado: 45%`), permitiendo descargar el MP3 completo mucho antes de que termine de reproducirse la locución.
- **🎤 Modo Karaoke / Surround Sincronizado:**
  Seguimiento visual del texto con desplazamiento y resaltado suave sincronizado con cada frase locutada en tiempo real.
- **🛡️ 100% Privado, Local y Sin Conexión:**
  Ningún texto, libro o historial de navegación sale jamás de tu equipo. Funciona con total autonomía sin depender de APIs de terceros (OpenAI, ElevenLabs, etc.).
- **🌐 Captura Limpia de Selección Web:**
  En periódicos y páginas web, selecciona cualquier párrafo o noticia con el ratón y pulsa *«Capturar Selección»* (o usa la burbuja flotante) para escuchar únicamente el contenido deseado con 0% de publicidad, banners o cookies.
- **🗣️ Voces Neuronales Multilingües:**
  - 🇪🇸 **Español:** Dora, Alex, Enrique.
  - 🇬🇧/🇺🇸 **Inglés:** Bella, Nicole, Sarah, Sky, Adam, Michael, Emma, George, entre otras.

---

## 🛠️ Instalación en Google Chrome (Modo Desarrollador)

1. **Clona o descarga este repositorio:**
   ```bash
   git clone https://github.com/0utKast/kokoro-ai-voice-reader.git
   ```
2. Abre Google Chrome y entra en:
   ```
   chrome://extensions/
   ```
3. Activa la casilla **"Modo de desarrollador"** en la esquina superior derecha.
4. Haz clic en el botón **"Cargar descomprimida"** (*Load unpacked*).
5. Selecciona la carpeta raíz del repositorio clonado (`kokoro-ai-voice-reader`).
6. El icono de **Kokoro AI** aparecerá en tu barra de extensiones. Haz clic sobre él para abrir el panel lateral permanente.

---

## 🎧 Atajos de Teclado

| Atajo (Mac) | Atajo (Windows / Linux) | Acción |
|-------------|-------------------------|--------|
| `Option + Shift + S` | `Alt + Shift + S` | Capturar selección web o abrir panel de lectura |
| `Option + Shift + X` | `Alt + Shift + X` | Detener inmediatamente la reproducción |

---

## 🏛️ Arquitectura del Sistema (Manifest V3)

En Google Chrome Manifest V3, los *Service Workers* de fondo carecen de acceso al contexto de `navigator.gpu` y a la interfaz `AudioContext` de la Web Audio API. Para sortear esta limitación de forma nativa y robusta, la extensión implementa la arquitectura de **Offscreen Documents**:

```
 ┌────────────────────────┐      Captura / Selección      ┌────────────────────────┐
 │   Página Web Activa    │ ─────────────────────────────> │ Background Service     │
 │   (Content Script)     │                                │ Worker                 │
 └────────────────────────┘                                └───────────┬────────────┘
                                                                       │
                                                       Ciclo de vida   │ Asegurar offscreen
                                                                       ▼
 ┌────────────────────────┐      Progreso / Karaoke        ┌────────────────────────┐
 │   Side Panel UI        │ <───────────────────────────── │ Offscreen Document     │
 │   (Panel Lateral HTML) │                                │ (WebGPU + Web Audio)   │
 └────────────────────────┘                                └───────────┬────────────┘
                                                                       │
                                                            Kokoro-82M │ WGSL Shaders
                                                            LameJS MP3 │ Streaming Buffer
                                                                       ▼
                                                           ┌────────────────────────┐
                                                           │ Altavoces / Salida     │
                                                           │ Archivo MP3 Local      │
                                                           └────────────────────────┘
```

### Módulos Principales
- **`src/offscreen/`**: Alberga el motor neuronal KokoroTTS (ONNX Runtime WebGPU) y el sintetizador Web Audio. Genera y encadena buffers de 24 kHz en tiempo real y codifica a MP3 al vuelo.
- **`src/sidepanel/`**: Interfaz de usuario con estética Glassmorphism, controles de velocidad (0.5x - 2.0x), barra de progreso desacoplada y visor Karaoke.
- **`src/content/`**: Detecta selecciones de texto, muestra la píldora flotante rápida y aplica Mozilla Readability como respaldo.
- **`src/shared/`**:
  - `audio-utils.js`: Codificadores locales WAV y MP3 (vía LameJS).
  - `pdf-extractor.js`: Motor de extracción de texto para PDFs locales y remotos basado en PDF.js.
  - `storage.js`: Persistencia de voz, velocidad y ajustes en `chrome.storage.local`.

---

## 📦 Estructura del Código Fuente

```
kokoro-ai-voice-reader/
├── manifest.json              # Configuración de Manifest V3 y permisos
├── CHROMEWEBSTORE.md          # Metadatos y justificaciones para la Chrome Web Store
├── README.md                  # Documentación oficial del proyecto
├── icons/                     # Iconos en resoluciones 16, 32, 48 y 128 px
└── src/
    ├── background/            # Service worker coordinador de ciclo de vida
    ├── content/               # Content script para selección web y Readability
    ├── libs/                  # ONNX Runtime Web, Kokoro.web.js, PDF.js, LameJS
    ├── offscreen/             # Motor WebGPU, inferencia neuronal y reproducción de audio
    ├── shared/                # Utilidades de audio, constantes y extractor PDF
    └── sidepanel/             # Interfaz de usuario y controles del panel lateral
```

---

## 🔒 Privacidad y Seguridad

- **Cero Telemetría:** No se recopila ningún tipo de analítica ni dato de uso.
- **Cero Envío de Texto:** Las obras, libros, artículos y textos introducidos se procesan exclusivamente en la memoria RAM y VRAM de tu ordenador.
- **Almacenamiento Local:** Las preferencias (voz favorita y velocidad) se almacenan localmente en tu perfil de Chrome (`chrome.storage.local`).

---

## 👤 Autor

Desarrollado por **0utKast**  
Repositorio oficial: [https://github.com/0utKast/kokoro-ai-voice-reader](https://github.com/0utKast/kokoro-ai-voice-reader)
