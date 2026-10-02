# Guion del Videotutorial: Kokoro AI Voice Reader
## Demostración Práctica, Opciones de Uso y Caso de Estudio WebGPU / WGSL

> **Duración estimada:** 8 - 10 minutos  
> **Propósito doble:**  
> 1. Tutorial oficial de uso, características y opciones de la extensión (publicada en la Chrome Web Store).  
> 2. Caso de estudio real y demostración del poder de cómputo de WebGPU y shaders en `uve doble G S L` para el curso avanzado.

---

### [00:00 - 01:15] Bloque 1: Introducción y la Gran Revolución Silenciosa

**[EN PANTALLA]:**
*Primer plano del narrador o cabecera del canal. A continuación, captura de la ficha oficial de la extensión en la Chrome Web Store.*

**[LOCUCIÓN]:**
Muy buenas a todos. Hoy tengo una noticia muy especial que compartir con vosotros: ya está oficialmente publicada y disponible para todo el mundo en la Chrome Web Store nuestra extensión **Kokoro AI Voice Reader**. 

Y antes de nada, una aclaración importante para los que compartáis enlaces o la recomendéis: el enlace oficial de la tienda que tenéis abajo en la descripción es permanente y definitivo. No cambiará jamás, independientemente de que vayamos publicando nuevas versiones o mejoras.

Pero este vídeo no es únicamente un videotutorial para enseñaros a sacarle el máximo partido a cada una de sus funciones. Es también, y muy especialmente, la prueba de fuego de algo sobre lo que estamos profundizando en nuestro curso: el descomunal poder de **WebGPU** y el lenguaje de sombreado **uve doble G S L**.

Durante años nos dijeron que para ejecutar inteligencia artificial de vanguardia en local necesitábamos gigabytes de librerías, entornos en Python, Cuda o aplicaciones complejas en C Plus Plus. Hoy vais a ver con vuestros propios ojos cómo un modelo neuronal de última generación lee artículos, libros y documentos PDF de cientos de páginas con voces ultra-naturales, en riguroso tiempo real y con cero lag, ejecutándose al cien por cien dentro de una simple pestaña del navegador.

---

### [01:15 - 02:45] Bloque 2: Las Tripas Técnicas: ¿Cómo funciona WebGPU y uve doble G S L aquí?

**[EN PANTALLA]:**
*Apertura del panel lateral de la extensión en Chrome. Primer plano del distintivo superior derecho que parpadea y muestra: "WebGPU Activo". Sobreimpresión de esquema de compilación a Metal / DirectX 12 / Vulkan.*

**[LOCUCIÓN]:**
Fijaos en la parte superior del panel lateral. Este pequeño distintivo que veis aquí, **"WebGPU Activo"**, no es un adorno: es la confirmación de que el motor ha tomado el control directo de la tarjeta gráfica de vuestro ordenador.

WebGPU no es una simple evolución de WebGL. Es una API de bajísimo nivel desarrollada por el consorcio uve doble 3 C junto a ingenieros de Apple, Google, Mozilla y Microsoft. Su misión es comunicar el navegador directamente con las APIs nativas del sistema operativo: Metal en macOS, DirectX 12 en Windows y Vulkan en Linux.

En nuestro curso de WebGPU y uve doble G S L estudiamos a fondo cómo escribir *compute shaders*. Pues bien, la extensión utiliza ONNX Runtime Web compilado contra WebGPU. Cada cálculo matricial, cada capa del transformador y cada paso del sintetizador neuronal del modelo Kokoro-82M se traduce en hilos masivamente paralelos que se ejecutan en los núcleos de vuestra GPU mediante shaders en uve doble G S L.

¿Qué ventajas prácticas tiene esto frente al software tradicional?
1. **Arranque instantáneo:** Cero tiempo de carga. No hay que esperar a que un intérprete de Python cargue gigabytes en RAM.
2. **Latencia cero en streaming:** La GPU sintetiza la primera frase en unos cien milisegundos y arranca la reproducción de audio de inmediato con la Web Audio API. Mientras tú escuchas la primera frase, la GPU ya ha terminado en segundo plano de calcular las siguientes diez.
3. **Privacidad matemática absoluta:** Todo ocurre en la memoria VRAM de tu ordenador. Ni una sola palabra de lo que lees, ni un solo PDF que abras, viaja jamás a ningún servidor externo.

---

### [02:45 - 04:30] Bloque 3: Instalación y Primer Contacto con la Interfaz

**[EN PANTALLA]:**
*Instalación desde la Chrome Web Store en un clic. Clic en el icono de la extensión en la barra de herramientas. El panel lateral se despliega elegantemente a la derecha de la ventana.*

**[LOCUCIÓN]:**
Instalarla es tan fácil como pulsar **"Añadir a Chrome"** en el enlace de la Chrome Web Store. La descarga pesa menos de cincuenta megabytes, porque todo el motor está empaquetado de forma ultraligera.

Al hacer clic en el icono de la extensión en la barra de herramientas, se abre automáticamente el **Panel Lateral** (*Side Panel*). 

Esta decisión de diseño es fundamental: a diferencia de las extensiones con ventana emergente tradicional que se cierran en cuanto haces clic en la página, el Panel Lateral de Chrome es permanente. Puedes seguir navegando, cambiando de pestaña o leyendo mientras el reproductor y los controles permanecen siempre a la vista y accesibles a tu derecha.

En la parte inferior encontramos los controles principales:
- **Selector de Voz Neuronal:** Incluye voces en español nativo de máxima calidad como *Dora*, *Alex* y *Santa*, además de una amplia selección de voces en inglés americano y británico con diferentes timbres y estilos narrativos.
- **Control de Velocidad:** Un deslizador continuo que permite regular la cadencia desde cero punto setenta y cinco hasta uno punto setenta y cinco con fidelidad total, adaptándose a si queréis un estudio reposado o una lectura rápida.

---

### [04:30 - 06:15] Bloque 4: Modos de Lectura: Artículos Web, PDFs y Modo Karaoke

**[EN PANTALLA]:**
*Demostración 1: Navegando por un artículo o documentación web. El usuario selecciona un párrafo o sección con el ratón y pulsa "Capturar Selección" en el panel (o clic derecho / atajo). El texto limpio aparece al instante en el editor y arranca la voz.*
*Demostración 2: El modo Karaoke ilumina en azul/cian cada frase mientras suena el audio.*

**[LOCUCIÓN]:**
Vamos a ponerla a prueba en situaciones reales.

Imaginad que estáis en un artículo de un blog, un periódico digital o una página de documentación técnica. La mejor forma de leerla, y la más limpia, es el control directo: simplemente seleccionáis con el ratón el párrafo o la sección exacta que queréis escuchar. Al pulsar el botón de **"Capturar Selección"** en el panel lateral, el texto se traslada de inmediato al editor, limpio, sin anuncios y sin elementos extraños.

Al pulsar **Play**, ocurre la magia:
El editor de texto da paso automáticamente a nuestro **Modo Karaoke Sincronizado**. Cada frase que el modelo neuronal va pronunciando se resalta en pantalla con un desplazamiento suave. Si estás estudiando, repasando un temario o aprendiendo un idioma, la sincronización entre el ojo y el oído es perfecta.

Y si lo que tenéis entre manos es un libro o un documento PDF completo, basta con arrastrarlo directamente sobre el panel lateral o pulsar **"Cargar PDF / TXT"**. La extensión procesa el documento, reconstruye los saltos de línea para que la entonación no se corte a mitad de frase y comienza la lectura de inmediato.

---

### [06:15 - 07:30] Bloque 5: Generación y Descarga de Audiolibros en MP3

**[EN PANTALLA]:**
*La barra de estado muestra la barra de progreso de síntesis avanzando mucho más rápido que la reproducción acústica. Al llegar al 100%, el botón "Descargar MP3" se ilumina en verde.*

**[LOCUCIÓN]:**
Aquí es donde el rendimiento de WebGPU y uve doble G S L deja en evidencia a cualquier sistema convencional.

Fijaos en la barra inferior de síntesis: mientras la voz va reproduciendo tranquilamente las primeras frases a velocidad normal, la GPU procesa los tensores a una velocidad entre tres y cuatro veces superior al tiempo real. 

En segundo plano, un codificador optimizado en JavaScript empaqueta los fragmentos de audio en un archivo **MP3** ligero y de alta fidelidad. Al terminar la sintetización, el botón **"Descargar MP3"** se activa. Con un solo clic, podéis guardar el documento o el libro completo convertido en un audiolibro listo para llevar en el móvil, en el coche o en cualquier reproductor sin conexión.

---

### [07:30 - 08:45] Bloque 6: Novedades de la Versión 1.1.3: Control de Intrusividad y Atajos

**[EN PANTALLA]:**
*Zoom a la zona de ajustes del panel lateral, mostrando el nuevo interruptor "Globo flotante al subrayar texto". Se muestra apagado y luego encendido para ilustrar su funcionamiento.*

**[LOCUCIÓN]:**
En la versión 1.1.3 que tenéis disponible en la tienda hemos incorporado una mejora muy importante pensada para el confort del usuario: el control de la selección rápida.

Muchos lectores nos comentabais que al seleccionar texto para copiar o tomar notas en una web, que aparezca de golpe un globo emergente puede resultar intrusivo. Por eso, en los ajustes del panel hemos añadido un nuevo interruptor: **"Globo flotante al subrayar texto"**.

Por defecto viene **desactivado**, garantizando que tu navegación sea cien por cien limpia y sin elementos flotantes que te tapen la pantalla.

Si lo activas, cuando subrayes cualquier párrafo en una página web aparecerá un elegante botón flotante de *"Leer con Kokoro"*, que ahora cuenta con protecciones inteligentes: se desactiva automáticamente si estás rellenando formularios, escribiendo en un área de texto o dentro de campos de entrada para no tapar el cursor jamás.

Y recordad que, tengáis activado el globo o no, siempre disponéis de dos métodos ultrarrápidos para escuchar cualquier fragmento:
1. Hacer clic derecho sobre el texto seleccionado y elegir **"Leer selección con Kokoro AI"**.
2. O pulsar el atajo de teclado nativo: **Alt + Shift + S** (en Mac, **Opción + Shift + S**).

---

### [08:45 - 09:30] Bloque 7: Conclusiones y Cierre

**[EN PANTALLA]:**
*Plano del narrador. En pantalla aparecen los enlaces destacados a la Chrome Web Store y al repositorio de GitHub.*

**[LOCUCIÓN]:**
Como veis, esta extensión no solo es una herramienta extraordinariamente útil para el día a día, para estudiantes, lectores o profesionales que necesitan digerir grandes volúmenes de texto con la máxima comodidad. 

Es, sobre todo, una ventana al futuro inmediato del desarrollo de software: el navegador web se ha convertido en una plataforma de cómputo de primer nivel gracias a la llegada de WebGPU y los shaders en uve doble G S L.

Tenéis el enlace directo para instalarla gratis desde la Chrome Web Store en la descripción del vídeo. Si sois desarrolladores o estáis siguiendo nuestro curso de WebGPU, también tenéis el enlace al repositorio de GitHub con todo el código fuente abierto para auditarlo y trastear con él.

Probadla, dejadme vuestras impresiones y preguntas en los comentarios, y nos vemos en la próxima lección del curso. ¡Hasta luego!
