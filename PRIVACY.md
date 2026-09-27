# Política de Privacidad — Kokoro AI Voice Reader

> **Última actualización:** 27 de septiembre de 2026  
> **Desarrollador:** 0utKast  
> **Repositorio oficial:** [https://github.com/0utKast/kokoro-ai-voice-reader](https://github.com/0utKast/kokoro-ai-voice-reader)

---

## 1. Principio Fundamental: Cero Recopilación de Datos

La extensión **Kokoro AI Voice Reader** ha sido diseñada bajo el principio de **privacidad absoluta por diseño (*Privacy by Design*)**. 

- **No recopilamos, transmitimos, almacenamos ni vendemos ningún dato personal o identificativo.**
- **No utilizamos herramientas de analítica, rastreo (*tracking*), telemetría ni cookies.**
- **Todo el procesamiento es 100% local:** La síntesis de voz, la lectura de documentos PDF y la conversión a MP3 ocurren íntegramente dentro de tu navegador mediante aceleración por hardware WebGPU en tu propia tarjeta gráfica. Ningún texto o documento viaja jamás a servidores externos o a la nube.

---

## 2. Uso Justificado de los Permisos del Navegador

La extensión solicita exclusivamente los permisos estrictamente necesarios para su funcionamiento en Google Chrome (Manifest V3):

1. **`sidePanel` (Panel Lateral):**  
   Permite ofrecer una interfaz gráfica permanente integrada en el lateral de Chrome donde el usuario controla la reproducción, ajusta la velocidad y visualiza el texto sincronizado en modo Karaoke sin interrumpir su navegación.
2. **`offscreen` (Documentos Offscreen):**  
   Permite crear un contexto en segundo plano con acceso directo a las APIs de WebGPU y Web Audio para ejecutar la inferencia del modelo neuronal Kokoro-82M y la codificación de audio en tiempo real.
3. **`storage` (Almacenamiento Local):**  
   Guarda exclusivamente en la memoria local de tu navegador (`chrome.storage.local`) tus preferencias de interfaz: la voz neuronal seleccionada, la velocidad de reproducción y el volumen. Estos datos nunca salen de tu dispositivo.
4. **`activeTab` y `scripting`:**  
   Permite capturar el texto seleccionado por el usuario o el contenido limpio de un artículo cuando el usuario pulsa explícitamente el botón «Capturar Selección / PDF». No se monitoriza ni se registra tu historial de navegación.
5. **`contextMenus`:**  
   Añade una opción en el menú contextual del botón derecho del ratón para permitir la lectura rápida de cualquier fragmento de texto seleccionado.

---

## 3. Seguridad de los Documentos y Textos

Los libros, archivos PDF, notas o fragmentos de páginas web que introduzcas en el reproductor se procesan de forma efímera en la memoria RAM y VRAM de tu ordenador. Al cerrar la pestaña o limpiar el texto, los datos son eliminados.

---

## 4. Código Abierto y Auditoría

Kokoro AI Voice Reader es un proyecto de código abierto y transparente. Cualquier usuario puede auditar y revisar el código fuente completo en nuestro repositorio oficial de GitHub:  
👉 [https://github.com/0utKast/kokoro-ai-voice-reader](https://github.com/0utKast/kokoro-ai-voice-reader)

---

## 5. Contacto y Soporte

Si tienes dudas sobre esta política o deseas realizar consultas sobre el proyecto, puedes ponerte en contacto a través de la sección de Issues de GitHub:  
👉 [https://github.com/0utKast/kokoro-ai-voice-reader/issues](https://github.com/0utKast/kokoro-ai-voice-reader/issues)
