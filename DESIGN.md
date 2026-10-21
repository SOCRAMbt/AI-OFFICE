# AI-OFFICE — Dirección de diseño

Este documento es la fuente de verdad de las decisiones visuales del proyecto. Sobrevive a regeneraciones: si algo cambia, se actualiza acá primero.

**Tesis**: la documentación técnica que se lee como folleto es ruido. La que se lee como *informe de incidente bien escrito* se consulta. AI-OFFICE vende en la primera línea lo mismo que promete en la última: un sistema que no se detiene solo.

---

## Identidad

- **brand**: Una oficina de agentes para OpenCode donde el trabajo no se detiene cuando el modelo dice «terminé».
- **voice**: preciso · seco · sin entusiasmo artificial. Nunca «revolucionario», «magia», «poder total», «game-changer».
- **anti-adjetivos**: elegante, seamless, potenciado, orientado a KPIs.
- **audiencia**: developers que ya se cansaron de pedirle al modelo lo mismo tres veces.
- **outcome**: el lector entiende en 30 segundos que el problema no es el modelo, es la falta de estructura.

---

## Paleta

Sin gradientes. Sin azul→violeta. Sin purple-to-blue. La UI del proyecto es terminal: fondo oscuro, texto claro, un acento.

| Rol | Hex | Uso |
|---|---|---|
| `bg` | `#0B0D10` | Fondo de terminal y landing |
| `surface` | `#14181D` | Cards, bloques de código |
| `border` | `#232A32` | Hairlines, separadores |
| `text` | `#E6EAF0` | Texto principal |
| `muted` | `#8B97A6` | Texto secundario, metadata |
| `accent` | `#4ADE80` | PASS, éxito, links primarios — verde signals, no decorativo |
| `warn` | `#FBBF24` | N/A, advertencias, presupuesto |
| `danger` | `#F87171` | FAIL, findings críticos, violations |

**Regla 60-30-10**: 60% superficie oscura, 30% texto y bordes, 10% acento. El acento **solo** marca estado (PASS/FAIL/N/A) y acciones. Nunca decorativo.

**Ratios de color**: 3 siblings, 3 estados — no 5 siblings con 4 tintes.

---

## Tipografía

| Rol | Familia | Uso |
|---|---|---|
| Display | system sans, weight 700, `letter-spacing: -0.02em` | H1, H2 |
| Body | system sans, 400, `line-height: 1.6`, `max-width: 68ch` | Párrafos |
| Code | `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` | Todo lo técnico |

**Prohibido**: una sola familia con pesos 400-600 y `tracking-tight` global. Si todo es Inter 600, no hay jerarquía tipográfica.

**Trackeo por rol, no global**: display `-0.02em`, body `0`, caps `0.12em` (solo para labels small, nunca en H1).

**Rampas de peso**: 700 para display, 600 para labels y tabla headers, 400 para body. Tres pesos, no cinco.

**Números tabulares** en toda tabla de métricas — las columnas de budget alinean.

---

## Layout

Editorial, no landing.

- **Silueta**: barra de código arriba, luego problema (tabla 2 col), luego arquitectura (diagrama ASCII), luego mecanismo (4 hooks), luego referencia. Asimétrico: las tablas y el diagrama ocupan ancho variable; el texto largo va a `max-width: 68ch`.
- **Sin hero centrado.** El H1 va a la izquierda, con el tagline abajo. Centrado con badge de status arriba es el patrón de landing de IA que el proyecto existe para desmontar.
- **Sin bento.** No hay grid de 4-6 tiles con la misma silueta. Las secciones son bloques de una idea.
- **Separación por `---` y subtítulos H2 numerados opcionalmente**, no por cards.
- **Padding vertical variable**: más aire antes de las secciones densas (tablas) que entre secciones cortas.

---

## Componentes

- **Radio**: `4px` en bloques de código y badges, `0` en tablas y separadores. Dos escalas, no `rounded-2xl` en todo.
- **Elevación**: `border-hairline`. Sin `shadow-lg`, sin `drop-shadow`, sin glow. Un proyecto de terminal no flota.
- **Badges**: shields.io, con solo los que tienen dato real (npm, license, node, tests, coverage, types). Sin fila de logos de clientes.
- **Tablas**: hairline horizontal, header en 600, `text-align: right` en columnas numéricas, `tabular-nums`.
- **Diagramas**: ASCII en code block. Deben ser específicos — mostrar `bus/<canal>/<seq>-<msgid>.json` y no `<< >>`.
- **Código**: siempre con el lenguaje correcto. Nunca un bloque sin highlighting.
- **Iconos**: dentro de texto o ninguno. Cero emoji como icono de feature. Los emoji en prosa sí, en listas de features no.

---

## Copy

- **Headline**: nombra el mecanismo, no el beneficio. «Una oficina de agentes donde el trabajo no se detiene» falla el logo-tap test (un competidor podría llamarse igual). «AI-OFFICE: orquestación ejecutable para OpenCode» pasa el test porque el mecanismo es específico.
- **Sin frases cliché**: Transform · Unlock · Seamlessly · Effortlessly · Supercharge · Revolutionary · Game-changing.
- **Sin em-dash confetti**: máximo 1 por párrafo, y solo si vale.
- **Los números son reales o no van**: 148 tests · 87.8% coverage · 4.656 líneas · 21 archivos. Nada de «+50 agentes» sin contexto.
- **Cero fluff en el primer párrafo**: el H1 y el tagline dicen qué es. La venta empieza en la tabla del problema.

---

## Movimiento e interacción

Aplica a la landing HTML y a cualquier demo. El README es markdown: no hay motion, y eso está bien.

Si se agrega una landing:

- **Job por animación**: 1 entrada, 1 hover, 1 press. Nada más.
- **Duración**: `220ms` estándar, `400ms` entrada de hero, `80ms` cambio de estado.
- **Easing**: `cubic-bezier(0.16, 1, 0.3, 1)` para entrar (expo-out), `cubic-bezier(0.3, 0, 0.8, 0.15)` para salir (60% de la entrada).
- **Sin `transition: all`**: siempre `transition-[transform,opacity,border-color]`.
- **Sin `fadeInUp + stagger 0.1s` en cada sección**: máximo una entrada animada; el resto aparece sin animación.
- **Hover**: `border-color` **o** `translateY(-2px)`. Nunca los dos, nunca solo opacity.
- **Press**: `scale(0.97)` en 90 ms.
- **`prefers-reduced-motion: reduce`**: `opacity: 1 !important; transform: none !important` — aditivo, no `animation: none` brutal.
- **Sin parallax**, sin scroll-jacking, sin marquee.

---

## Prohibiciones (hard)

1. Gradiente `blue → purple`, o cualquier purple-to-blue.
2. Una sola familia tipográfica con pesos 400-600.
3. Centrado con badge de status + H1 grande + doble CTA.
4. `rounded-2xl` + `shadow-lg` + `backdrop-blur` en todo.
5. `grid-cols-3 gap-6` con cards idénticas.
6. Emoji como icono de feature.
7. Eyebrow pill (`uppercase tracking-widest text-xs` sobre el H1).
8. Fila de 3 stat cards con números redondos sin data verificable.
9. `transition: all 0.3s ease`.
10. `fadeInUp` uniforme con stagger lineal en cada sección.
11. Logo orb con gradiente.
12. `#FFFFFF` / `#000000` puros.
13. Grados, skeuomorfismo, emoji en títulos.
14. Métricas inventadas o redondeadas sin contexto.

---

## Prueba de silueta

Antes de dar por terminado un README o una landing:

- **10% thumbnail**: ¿se ve como un README de proyecto o como una landing de IA?
- **Logo-tap**: tapá el logo. ¿el headline sigue sirviendo para un competidor? Si sí, reescribir.
- **Hue shift 15°**: ¿sigue viéndose como clon? Si sí, cambiar estructura, no color.
- **Contraste**: texto principal ≥ 4.5:1 sobre `bg`; muted ≥ 3:1 para metadata.
- **Sin numbers huérfanos**: cada cifra del README tiene que ser verificable con un comando del repo.

---

## Referencias

- `docs/ARCHITECTURE.md` — la arquitectura en detalle, para el que quiera el porqué.
- `skills/oficina/reference/mesh.md` — el protocolo de la malla.
- `tests/` — la prueba de que los números del README son ciertos.
