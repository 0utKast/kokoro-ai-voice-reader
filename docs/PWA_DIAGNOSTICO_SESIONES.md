# Diagnóstico Técnico y Plan de Continuación: PWA Móvil Kokoro AI

**Fecha:** 6 de Octubre de 2026  
**Rama:** `main` (9 commits por delante de `origin/main`)  
**Estado:** Servidor funcional en `scripts/pwa-server.js` (puertos 8443 HTTPS y 8080 HTTP).

---

## 1. Logros Consolidados y Verificados

1. **Arquitectura PWA Móvil Completa (`pwa/`)**:
   - WebGPU nativo on-device con ONNX Runtime Web.
   - Carga absoluta de módulos dinámicos `.mjs` configurada en `env.wasmPaths`.
   - Cabeceras de seguridad `COOP: same-origin`, `COEP: credentialless` y `Service-Worker-Allowed: /`.
   - Compatibilidad total con libros gigantes (*Juego de Tronos*, más de 400.000 palabras / 2 MB de texto).

2. **Resolución de la Pantalla en Negro en Móviles**:
   - **Causa raíz identificada**: Asignar 2 millones de caracteres directamente al `<textarea>` de la página saturaba el compositor de texturas GPU de Android Chrome, provocando un colapso gráfico (*pantalla en negro*).
   - **Solución implementada**: El documento completo se almacena en la variable de memoria JavaScript `currentFullDocumentText`. En el DOM `<textarea>` solo se inyecta una previsualización ligera (1.500 caracteres) y una ficha técnica. El peso del DOM pasó de 250 MB de memoria gráfica a apenas 3 KB.

3. **Enrutamiento y Certificados**:
   - Conexión segura obligatoria para WebGPU (`https://192.168.1.225:8443/pwa/`).
   - Servidor HTTP en `8080` configurado para redirigir automáticamente (301) las peticiones móviles al puerto seguro `8443`.
   - Botón directo **🔄 Reiniciar** en la barra de herramientas para purgar la caché y el almacenamiento local sin necesidad de parámetros de URL.

---

## 2. Diagnóstico Detallado del Problema Reportado

### Síntomas observados por el usuario:
> *"Ahora vuelve a no funcionar el botón play al detener, no se detiene, además al pulsar varias veces de nuevo aparece la página de error."*

### Análisis de causa raíz:

1. **Bucle de inferencia `model.stream` desincronizado de la pausa**:
   - En `pwa/app.js`, al pulsar Pausa se llama a `audioCtx.suspend()`, pero el bucle asíncrono `for await (const chunk of model.stream(...))` **NO se detenía**.
   - El modelo seguía generando frases en la GPU al 100% de potencia y encolando cientos de nodos de audio (`ctx.createBufferSource()`) hacia un `AudioContext` congelado.
   - En Android, la capa de audio HAL (`AudioTrack`) colapsa si se le programan decenas de buffers en un contexto suspendido.

2. **Saturación y pérdida del dispositivo WebGPU por pulsaciones rápidas**:
   - Al pulsar varias veces seguidas sobre Reproducir / Detener, se invocaba `startPlayback()` repetidamente.
   - Cada llamada abría una nueva sesión de inferencia en WebGPU mientras la anterior todavía no había liberado sus tensores y memoria de texturas en la GPU del móvil.
   - Esto provocó un **GPU Device Lost / Out Of Memory**, haciendo que el proceso de la pestaña de Chrome colapsase y mostrase la pantalla de error genérica (*"¡Oh, no! Se ha producido un error al mostrar esta página web"*).

---

## 3. Plan de Acción Inmediato para la Próxima Sesión

1. **Control de espera (Gate) en el bucle de generación**:
   ```javascript
   for await (const chunk of model.stream(splitter, ...)) {
     if (abortGeneration || activeSessionId !== sessionId) break;
     
     // Pausar la inferencia en GPU si el usuario ha pulsado pausa
     while (isPaused && !abortGeneration && activeSessionId === sessionId) {
       await new Promise(r => setTimeout(r, 100));
     }
     ...
   }
   ```

2. **Reproductor secuencial bajo demanda (Cola de 1-2 chunks)**:
   - En lugar de programar todas las frases a futuro en `AudioContext.currentTime`, reproducir únicamente la frase actual y encadenar la siguiente al terminar (`onended`).
   - Esto hace que pausar sea instantáneo (silenciar/pausar la frase actual) y reanudar sea inmediato sin saturar el driver de audio de Android.

3. **Bloqueo atómico de sesión de reproducción**:
   - Evitar que una nueva sesión de generación empiece antes de que la anterior haya confirmado su detención (`await stopAudioPlayback()`), protegiendo la GPU contra fugas de memoria.
