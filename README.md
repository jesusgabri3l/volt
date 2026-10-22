# VOLT — Precisión en cada detalle

Landing page interactiva en 3D de **VOLT**, un teclado mecánico conceptual. Es un proyecto de portafolio: el producto es ficticio y no está a la venta.

El teclado es una escena 3D en tiempo real que acompaña todo el recorrido. Al hacer scroll se desarma pieza por pieza, se vuelve a armar y se puede personalizar. Se puede girar arrastrándolo y sus teclas responden al teclado físico y a los clics.

## Qué incluye

- **Narrativa por scroll.** Una sola línea de tiempo, determinista y reversible, mueve la cámara, separa los componentes (keycaps, switches, placa, PCB, chasis), enfoca la pieza descrita y vuelve a armar el teclado. Los saltos entre secciones cortan directo al estado nuevo en lugar de reproducir toda la animación.
- **Interacción.** El teclado se gira arrastrándolo, con inercia. Las teclas se hunden al escribir o al hacer clic, y la retroiluminación responde a cada pulsación.
- **Personalización en tiempo real.** Chasis, keycaps y color de la retroiluminación cambian los materiales del modelo sin recargar la escena. La elección se guarda en `sessionStorage` y sobrevive a una recarga en la misma pestaña.
- **Responsive.** En móvil la cámara se aleja según la proporción de la pantalla, y la composición y los controles se adaptan. La línea de tiempo se sincroniza con la posición real de cada sección, así que funciona también en pantallas bajas o en horizontal.
- **Respaldo sin 3D.** Si WebGL no está disponible o el modelo no carga, se muestra un poster estático. Todo el contenido es HTML, así que sigue disponible.

## Stack

- [Astro](https://astro.build) 7: estructura semántica y contenido estático, sin hidratar componentes.
- [three.js](https://threejs.org): escena 3D, cargada bajo demanda después del primer render.
- TypeScript y CSS nativo con tokens de diseño. Sin frameworks de UI ni librerías de animación.
- Modelo hecho en Blender y exportado a glTF (GLB comprimido con meshopt). La iluminación usa un HDRI horneado del estudio en Cycles.

## Estructura

```
src/
  components/
    layout/        Navbar, indicador de sección, footer
    product/       ProductScene: reserva el canvas, carga la escena y maneja los fallos
    sections/      Hero, Componentes, Personalizar, Comprar
  scripts/
    scene/
      product-scene.ts   Único módulo que habla con three.js: render, calidad, interacción
      timeline.ts        La narrativa como datos: cámara, desarmado y foco según el progreso
      underglow.ts       Retroiluminación por tecla y luz sobre el piso
      contact-shadow.ts  Sombra de contacto suave
      orbit-control.ts   Arrastre con inercia
      key-presses.ts     Teclas que se hunden
    customization.ts     Opciones de color compartidas por los controles y la escena
    scroll-progress.ts   Progreso del scroll medido sobre el layout real
public/
  assets/models/volt-keyboard.glb   Modelo (1.9 MB, meshopt)
  assets/studio/studio-env.hdr      Entorno de iluminación (395 KB)
  og.jpg, favicon.svg
```

## Rendimiento

El render se adapta al movimiento. Mientras algo se mueve (scroll, arrastre, teclas) se dibuja a resolución nativa con MSAA 4×, sin oclusión ambiental. Cuando la escena queda quieta, se activa la oclusión ambiental (GTAO) y se acumulan 16 frames con desplazamientos de subpíxel (secuencia de Halton) en un promedio: supersampling progresivo que deja nítidas las letras y los bordes vistos en ángulos rasantes, sin costo durante el movimiento. Cualquier cambio de vista, de color o de tamaño reinicia el promedio. Después de esas 16 muestras no se dibuja nada.

Otras decisiones:

- three.js y el modelo se cargan después del primer render. El HTML y la tipografía no esperan a la escena.
- Los shaders se compilan en paralelo (`compileAsync`) y el arranque se divide en tareas cortas.
- Un último paso de nitidez adaptativa (al estilo de AMD CAS) realza bordes y letras sin halos, igual en movimiento que en reposo, por menos de 1 ms por frame.
- Sin antialiasing redundante: el canvas no usa MSAA porque el buffer del pipeline ya lo hace. Según cálculo, esto ahorra del orden de cientos de MB de memoria de video a resolución de escritorio, algo importante en GPUs integradas.
- En móvil y pantallas táctiles nunca se usa oclusión ambiental.
- Con `prefers-reduced-motion`, cada sección muestra directamente su estado, sin animar la cámara.

### Mediciones

Tomadas el 2026-10-22 en una laptop con GPU integrada Intel, a 1920×911 en Chrome. "Frame" es el tiempo de un frame esperando a que la GPU termine.

| | Antes | Ahora |
|---|---|---|
| Frame durante el scroll | 36–40 ms (unos 18 FPS) | unos 8–11 ms (p90 de 14 ms), con margen para 60 FPS |
| Frame en reposo (oclusión ambiental + una muestra acumulada) | 36 ms en cada frame | unos 24 ms, 16 frames al detenerse (unos 0.4 s) y luego nada |
| Frame en el perfil móvil (390×844) | — | unos 5 ms |
| Arranque de la escena: tarea larga máxima | — | 138 ms (221 ms de bloqueo en total) |

Lighthouse 12 (build de producción, laboratorio):

| | Rendimiento | Accesibilidad | Buenas prácticas | SEO | LCP | CLS |
|---|---|---|---|---|---|---|
| Móvil | 70 | 100 | 100 | 100 | 1.4 s | 0 |
| Escritorio | 71 | 100 | 100 | 100 | 0.3 s | 0 |

La puntuación de rendimiento la limita el *Total Blocking Time*. Lighthouse corre en un Chrome sin GPU, así que WebGL se emula en la CPU (SwiftShader) y cada llamada gráfica cuenta como bloqueo del hilo principal. En un navegador con GPU el arranque bloquea unos 221 ms en total, como se mide arriba. El contenido aparece rápido (LCP de 1.4 s en móvil simulado) y no hay saltos de layout.

## Accesibilidad y compatibilidad

- Encabezados y landmarks semánticos, `lang="es"`, textos alternativos y nombres accesibles en todos los controles.
- Navegación completa con teclado y foco visible. Los controles de personalización son radios nativos.
- Contraste revisado sobre el fondo, y texto de al menos 12 px.
- Probado en Chrome y Firefox de escritorio, y en Safari y Chrome en iPhone.

## Desarrollo

Requiere Node 22.23.4 o superior (ver `.nvmrc`).

```sh
npm install
npm run dev       # http://localhost:4321
npm run build     # genera dist/
npm run preview   # sirve el build de producción
```

Para verlo desde el teléfono en la misma red: `npx astro dev --host`.

En desarrollo, `window.__voltScene` expone herramientas de ajuste en la consola:
- `frameCost(progreso, enReposo)` mide el costo de un frame.
- `capture()` devuelve el frame actual como imagen; sirve para regenerar el poster (`src/assets/images/hero-poster.webp`) y la imagen para redes (`public/og.jpg`).

Para que la imagen para compartir funcione, el build publicado necesita la URL absoluta del sitio en la variable de entorno `SITE_URL`.

## Autor

Jesús Ahumada — [LinkedIn](https://www.linkedin.com/in/jesus-ahumada) · [GitHub](https://github.com/jesusgabri3l)
