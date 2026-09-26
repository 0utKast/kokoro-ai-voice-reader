# Kokoro AI Voice Reader 🚀 (WebGPU Chrome Extension)

[![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![WebGPU Accelerated](https://img.shields.io/badge/WebGPU-Hardware_Accelerated-blue.svg)](https://www.w3.org/TR/webgpu/)
[![Model: Kokoro-82M](https://img.shields.io/badge/Model-Kokoro--82M-purple.svg)](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
[![Privacy 100% Local](https://img.shields.io/badge/Privacy-100%25_Local_&_Offline-success.svg)](#privacidad-y-seguridad)

¡Convierte cualquier texto o artículo web en voz humana ultra-natural con aceleración por hardware en tu propia tarjeta gráfica, directamente dentro de Google Chrome!

---

## ✨ Características Principales

- **Aceleración por Hardware con WebGPU:** Síntesis de voz ultra-rápida ejecutada directamente en tu GPU.
- **100% Privado y Autónomo:** Todo el procesamiento ocurre en local. Ningún texto o historial de navegación viaja jamás a la nube.
- **Sin Servidores ni Cuotas:** No requiere Python, ni servidores Flask, ni claves de API de pago (OpenAI, ElevenLabs).
- **Modo Karaoke / Surround Sincronizado:** Visualiza las oraciones activas con resaltado dinámico sincronizado en tiempo real con la voz de la IA.
- **Integración con Side Panel (Panel Lateral):** Disfruta de una interfaz Glassmorphism elegante y permanente que no se cierra al hacer clic en tus pestañas.
- **Píldora Flotante de Lectura Rápida:** Selecciona cualquier párrafo en cualquier página web y pulsa *"Leer con Kokoro"* para escucharlo de inmediato.
- **Captura de Artículos en 1 Clic:** Extrae automáticamente el cuerpo de texto de noticias y blogs eliminando anuncios y menús.
- **Exportación a WAV:** Descarga el audio completo generado para escucharlo sin conexión en cualquier reproductor.
- **Voces Neuronales Multilingües:**
  - 🇪🇸 **Español:** Dora, Alex, Enrique.
  - 🇺🇸/🇬🇧 **Inglés:** Sky, Bella, Nicole, Sarah, Adam, Michael, Emma, George.

---

## 🛠️ Instalación en Google Chrome (Modo Desarrollador)

1. Abre Google Chrome y navega a:
   ```
   chrome://extensions/
   ```
2. Activa el interruptor **"Modo de desarrollador"** (Developer mode) en la esquina superior derecha.
3. Haz clic en el botón **"Cargar descomprimida"** (Load unpacked).
4. Selecciona la carpeta de este proyecto:
   ```
   /Volumes/MisAppsV/Extension_TextoAVoz
   ```
5. ¡Listo! El icono de **Kokoro AI** aparecerá en tu barra de extensiones.

---

## 🎧 Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| `Alt + Shift + S` (o `Option + Shift + S` en Mac) | Leer selección actual o abrir panel de lectura |
| `Alt + Shift + X` (o `Option + Shift + X` en Mac) | Detener reproducción inmediatamente |

---

## 🏛️ Arquitectura del Sistema (Manifest V3)

En Manifest V3, los Service Workers carecen de acceso a `navigator.gpu` y a la API de Web Audio. Por ello, la extensión implementa el patrón **Offscreen Document**:

```
[Content Script / Página Web] ──(Selección de texto)──> [Background Service Worker]
                                                                  │
                                                      (Gestión de ciclo de vida)
                                                                  ▼
[Side Panel UI / Karaoke] <───(Progreso y eventos)─── [Offscreen WebGPU Engine]
                                                                  │
                                                       (Kokoro-82M ONNX + Web Audio)
                                                                  ▼
                                                      [Salida Acústica Local]
```

- **`src/background/service-worker.js`**: Enrutador de mensajes, atajos de teclado, menús contextuales y control del panel lateral.
- **`src/offscreen/`**: Contexto con acceso a WebGPU y Web Audio API. Ejecuta la inferencia neuronal y la reproducción en streaming sin pausas entre fragmentos.
- **`src/sidepanel/`**: Interfaz de control Glassmorphism, selector de voces, sliders de velocidad y visualizador Karaoke.
- **`src/content/`**: Píldora interactiva para selecciones de texto y extractor de artículos.
- **`src/shared/`**: Encoders WAV, segmentación de frases y gestión de almacenamiento persistente (`chrome.storage`).

---

## 🔒 Privacidad y Seguridad

- **Cero Telemetría:** No recopilamos analíticas, identificadores ni datos de uso.
- **Cero Tráfico Saliente de Texto:** La inferencia neuronal es 100% matemática y local en tus núcleos de GPU.

---

## 👤 Autor

Creado por **0utKast** para la comunidad de código abierto y lectura privada offline.  
Repositorio oficial: [https://github.com/0utKast/Extension_TextoAVoz](https://github.com/0utKast/Extension_TextoAVoz)
