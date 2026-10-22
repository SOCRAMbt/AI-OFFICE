# ¿Qué es AI-OFFICE?

<!-- BEGIN GENERATED: facts -->
| | |
|---|---|
| **Paquete** | `oficina-opencode` v3.0.5 |
| **Tools** | 16 |
| **Hooks** | 7 |
| **API de plugin** | `@opencode/plugin@2.1.2` |
| **Node** | >=20 |
| **Catálogo** | 258 agentes resolubles en 18 divisiones |
| **Divisiones** | academic, design, engineering, finance, game-development, gis, healthcare, marketing, paid-media, product, project-management, research, sales, spatial-computing, specialized, strategy, support, testing |
| **Límites** | 20 cards · 40 llamadas · 20 spawns · 10 agentes |
| **Cobertura mínima** | 60% |
<!-- END GENERATED: facts -->


> Una oficina de agentes de IA para OpenCode. Le das un objetivo, y el equipo lo trabaja, lo revisa, lo verifica y no para hasta terminarlo.

Este documento explica el sistema sin jerga. Si querés saber **cómo está construido por dentro**, está [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Si querés **usarlo**, está el [README](../README.md).

---

## 1. En una línea

AI-OFFICE convierte un asistente de IA en **un equipo de trabajo con jefe, especialistas, control de calidad y comunicación interna** — que trabaja de forma autónoma y se audita a sí misma.

---

## 2. El problema que resuelve

Todos los que trabajan con agentes de IA Known estos cinco momentos:

### «Repíteme lo que ya dijimos»

El agente funciona bien mientras la conversación sea corta. En cuanto el trabajo se extiende, empieza a olvidar: qué decidiste, qué encontraste, qué quedó a medias. Y ahí es cuando tenés que recordarle.

### «No avanza solo»

Le pedís algo, te dice «listo, terminado» — y se quedó en la mitad. No porque sea perezoso, sino porque **nadie lo obliga a seguir**. En una sesión larga, el modelo interpreta que su turno terminó y para.

### «Hice todo yo»

El asistente tiene la capacidad de delegar en subagentes, pero casi nunca lo hace. Termina resolviendo todo en un solo hilo, con un solo contexto, y con el cuello de botella de que vos sos el único que puede desbloquearlo.

### «Cada uno por su lado»

Cuando sí hay varios subagentes, trabajan como islands. Uno no sabe qué está haciendo el otro. No se piden ayuda. No se detectan los choques. Terminan tocando los mismos archivos con criterios distintos.

### «Repetimos las mismas rules»

Acá está el detalle importante: cuando algo falla, el error no es «el modelo no es inteligente». Es que **el sistema no tiene estructura**. Nada obliga a que:
- se planifique antes de actuar
- el trabajo se reparta
- alguien verifique lo que otro hizo
- se detecte el estancamiento

Una skill de instrucciones ayuda. Un sistema con reglas escritas en código, no: porque **no dependen de que el modelo tenga ganas de seguirlas**.

---

## 3. La analogía

La forma más rápida de entender AI-OFFICE es pensarlo como **una oficina con estructura**.

```
              ┌─────────────────────────────────────┐
              │        TÚ — el que encarga          │
              │   "necesito que pase esto"           │
              └──────────────────┬──────────────────┘
                                 │
                                 ▼
              ┌─────────────────────────────────────┐
              │   COMANDANTE — el jefe de proyecto  │
              │   Desarma el encargo en tareas      │
              └──────────────────┬──────────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                        ▼
   ┌─────────┐            ┌─────────┐            ┌─────────┐
   │Explorador│           │Implementador│          │Crítico  │
   │"qué hay  │            │"hacelo"   │            │"está bien│
   │ acá"     │            │           │            │ o no?"   │
   └────┬────┘            └─────┬─────┘            └────┬────┘
        │                       │                      │
        └───────────────────────┴──────────┬───────────┘
                                           ▼
                              ┌────────────────────────┐
                              │  CONTROL DE CALIDAD    │
                              │  ¿Compila? ¿Pasa los   │
                              │  tests? ¿Filtra datos? │
                              └────────────────────────┘
```

Lo que cambia contra trabajar con un asistente suelto:

| En una oficina real | Con un asistente suelto |
|---|---|
| El jefe reparte el trabajo | Todo le toca al mismo |
| El que entrega deja el trabajo hecho y anotado | Queda en el chat, se pierde |
| Otro lo revisa antes de que salga | Se auto-aprueba |
| Nadie entrega sin pasar el control de calidad | Se da por terminado cuando parece |
| Alguien pide ayuda a un colega | Cada uno se las arregla |
| Cuando alguien termina, va a ayudar a otro | Quedan esperando |
| La oficina sigue abierta hasta que el trabajo está hecho | La sesión se cierra |

---

## 4. Cómo trabaja un encargo, de punta a punta

### Paso 1 — El encargo

Vos escribís una sola línea:

> `/oficina Agregar autenticación JWT con refresh rotation`

Eso es todo. No das instrucciones paso a paso. No repetís contexto. No armás una lista de tareas.

### Paso 2 — El Comandante lo desarma

El Comandante (el jefe de proyecto) convierte tu encargo en **tareas concretas**, cada una con:

- **Qué tiene que producir** — un entregable claro, no «arreglar cosas»
- **Cómo se sabe que está bien** — criterios verificables («el endpoint responde 401 sin token», no «el código está bien»)
- **Qué control tiene que pasar** — el criterio de calidad
- **Quién lo hace** — se reparte automáticamente según las capacidades
- **Qué archivos puede tocar** — su territorio, para que dos personas no se pisen

Y hay un detalle importante: **el Comandante ordena las tareas por causa, no por apariencia**. Si arreglar B rompe la validación de A, B va primero. Sin eso, el trabajo da vueltas.

### Paso 3 — Los especialistas hacen su parte

Cada tarea la toma un agente con el perfil adecuado. El sistema busca en el **catálogo real de agency-agents** (80+ agentes organizados por división) el que mejor encaja con lo que la tarea necesita. Si nadie encaja bien, **fabrica el rol** en vez de poner a alguien a hacer un trabajo para el que no sirve.

Cada agente, al terminar, deja dos cosas en disco:

- **El handoff** — qué hizo, qué archivos tocó, qué decidió, qué quedó afuera
- **La evidencia** — la salida *real* de los comandos que corrió, pegada literal

### Paso 4 — Alguien lo revisa, y no es el mismo

El trabajo vuelve a **otro** agente, que lo revisa buscando bugs, problemas de seguridad, falta de tests, código fuera de scope. Tiene que dejar un veredicto: aprobado o rechazado, con el motivo.

El motor **impide** que alguien revise su propio trabajo. Es una regla del sistema, no una sugerencia.

### Paso 5 — El control de calidad

Se ejecutan seis controles reales, y se lee el código de salida de cada uno:

1. ¿Compila?
2. ¿Los tipos están bien?
3. ¿Pasa el linter?
4. ¿Pasan los tests?
5. ¿Quedó algún dato sensible en el código?
6. ¿Se tocó algo que no se debía?

**Una fase aplicable que falla = la tarea vuelve al trabajo.** No se promedia, no se pasa, no se ignora.

### Paso 6 — Si algo falla, el sistema reacciona

| Qué pasó | Qué hace el sistema |
|---|---|
| Primer rechazo | Vuelve al mismo agente, con el motivo exacto que hay que corregir |
| Segundo rechazo | El Comandante rehace la tarea y **cambia de agente** — si dos intentos fallaron, el problema probablemente no es el código |
| Tercer rechazo | Te lo pregunta a vos, con 2 o 3 opciones concretas y una recomendación |

Nunca te llega un «no pude, algo falló». Te llega: qué intentó, por qué no avanzó, y qué podés hacer.

### Paso 7 — Y sigue hasta terminar

Este es el punto que resuelve tu frustration principal.

Cuando el modelo termina su turno y la sesión queda quieta, **el sistema revisa si la tarea se terminó**. Si quedó trabajo pendiente, **se retoma solo**. No te pide permiso. No te espera.

El modelo no puede decir «listo, terminé» y dar por cerrada la oficina mientras queden tareas sin terminar. **El estado lo dice, no la confianza.**

---

## 5. Quién decide qué

No hay un jefe único. Hay **tres coordinadores con terrenos separados**, para que uno no sea cuello de botella:

### El Comandante — el alcance

Decide **qué está dentro de tu encargo y qué no**. Qué va primero. Qué es scope creep y qué es deuda que se acepta.

Si algo se sale de lo que pediste, lo frena y te lo dice.

### El Arquitecto — lo técnico

Decide **qué patrón se usa** y resuelve los conflictos de diseño entre tareas. Si dos personas resolvieron el mismo problema de dos formas distintas, él decide cuál vale.

Es el único que puede decir «esto contradice lo que hizo la otra tarea».

### El Integrador — el flujo

Decide **quién tiene cada tarea, si pasó el control de calidad, y si el presupuesto aguanta**. Detecta bloqueos, detecte que dos personas tomaron lo mismo, y detecta a los agentes que se quedaron colgados.

Es el único que puede decir «esa tarea ya la tiene otro» o «no te paso el control de calidad».

### Y las preguntas no te interrumpen a vos

Cuando un agente tiene una duda, **no te pregunta a vos**. Le pregunta al coordinador que corresponde. Ese le contesta. Solo llega hasta vos cuando hay algo que de verdad necesita tu criterio: una decisión de producto, un conflicto que ningún coordinador puede resolver, o el presupuesto agotado.

---

## 6. Los agentes se hablan entre ellos

Esta es la parte que más cambia el resultado, y la que menos se ve.

Los subagentes de OpenCode son **procesos aislados**: no comparten memoria, no se ven entre sí. Por eso, en la práctica, cuando delegás, cada agente trabaja a ciegas.

AI-OFFICE les da **un canal de comunicación propio**, que es un tablón de avisos en disco:

- Un agente escribe: «necesito que alguien convierte este componente a streaming SSR, tengo el contexto del componente pero no el del servidor».
- Ese mensaje **queda disponible** para los demás.
- Los que pueden ayudar, **lo evalúan y responden**. Y acá está lo bueno: **no aceptan por cortesía**. Antes de decir que sí, se hacen seis preguntas: ¿entiendo la tarea? ¿está en mi alcance? ¿puedo hacerlo ahora sin romper lo mío? ¿tengo el contexto? ¿vale la pena? ¿tengo presupuesto?
- Si no pueden, **dicen a quién conviene preguntarle** en lugar de quedarse mudos.

Y hay dos protecciones:

- **No se enreda**: una cadena de ayuda tiene máximo dos saltos. Si se alarga, la resuelve el Integrador.
- **No se vuelven predecibles**: si dos agentes ya se ayudaron dos veces, el tercero pedido se lo derivan a otro. Se rompe la monotonía.

### Y cuando alguien termina, va a ayudar

Cuando un agente termina su tarea, no queda esperando. Entra en un **pool de disponibles** y puede:

1. Atender un pedido que lo apunta específicamente
2. Atender un pedido general (el primero que puede, toma el trabajo)
3. **Ir a buscar trabajo él mismo** si hay tareas sin dueño que le quedan bien

El punto 3 es el que cambia la naturaleza del sistema: deja de ser «N tareas corriendo en paralelo» y pasa a ser «N personas acomodándose solas según la carga».

---

## 7. Las cinco cosas que no puede hacer mal

Estas reglas están escritas en código, no en el prompt. El modelo no puede saltárselas.

| Regla | Qué previene |
|---|---|
| **Ninguna tarea se da por terminada sin el control de calidad en verde** | «Listo, terminado» sin que funcione |
| **Nadie revisa su propio trabajo** | Auto-aprobación |
| **Los archivos de cada agente están delimitados** | Que dos agentes se pisen el mismo archivo |
| **Máximo 3 rechazos antes de preguntarte** | Que el sistema gire en loop quemando presupuesto |
| **Hay un tope de tareas y de invocaciones** | Que la corrida se dispare sola |

Y hay una más, que es la que hace que todo lo demás sea confiable:

> **El control de calidad revisa los cambios de todos, incluido el del Director.** Si alguien toca algo fuera de su territorio, se detecta.

El sistema no confía en la disciplina: **la audita**.

---

## 8. Qué vas a ver en pantalla

No es un firehose de texto. Es un ritmo:

**Al arrancar** — el plan de tareas en 5-8 líneas. Ves el objetivo, cuántas tareas, qué se hace primero.

**Cada 3 tareas** — un parte:

```
OFICINA — Agregar autenticación JWT
Progreso: 3/6 tareas

  T-00  [✓]  Mapear el sistema de auth actual
  T-01  [✓]  Diseñar el esquema de tokens
  T-02  [→]  Implementar el login
  T-03  [ ]  Tests de regresión
  T-04  [ ]  Verificación de seguridad
  T-05  [ ]  Revisión final

Agentes: 3 trabajando · 2 disponibles
Presupuesto: 3/20 tareas · 11/40 invocaciones
```

**Cuando algo se bloquea** — no un error genérico. Una causa, tres intentos, y opciones con recomendación.

**Al terminar** — el informe de entrega: qué se hizo, qué se probó, qué archivos se tocaron, qué decisiones se tomaron, **qué NO se hizo y por qué**, qué deuda quedó, y qué harías distinto la próxima vez.

Y si querés mirar por debajo, todo está en `.oficina/`: el tablero, el historial, los mensajes entre agentes, los artefactos de cada tarea, y los logs de cada control con la salida real.

---

## 9. Lo que NO hace (con honestidad)

- **No adivina tu objetivo.** Si el encargo es ambiguo en un punto que cambia qué construye, te lo pregunta. En el resto, hace las inferencias razonables y las anota.
- **No es un chatbot de empresa.** No trae tus datos, no se conecta a tus APIs, no se integra con tu CRM. Es un motor de orquestación: vos lo apuntás a tu código.
- **No reemplaza la revisión humana.** Automatiza la parte mecánica de la verificación (compila, pasa los tests, filtra secretos, revisa el diff). La decisión de si el producto está bien sigue siendo tuya.
- **No es gratis.** Corre agentes de verdad, consume tokens. El presupuesto por defecto es 20 tareas y 40 invocaciones por corrida, y te avisa antes de agotarse.
- **Necesita que configures una cosa**: `subagent_depth: 3` en la config de OpenCode. Sin eso, un subagente no puede delegar y la malla no arranca.
- **El bus vive en tu disco.** Es una decisión de diseño (auditabilidad, portabilidad, cero dependencias), pero implica que el estado de la corrida es visible para cualquier proceso con acceso a esa carpeta.

---

## 10. Cómo probarlo

### La prueba rápida (5 minutos)

```bash
npm install -g oficina-opencode
oficina install --target ~/.config/opencode
```

Y en `~/.config/opencode/opencode.json`:

```json
{ "experimental": { "subagent_depth": 3 } }
```

Después, en un proyecto tuyo:

```text
/oficina Agregar un endpoint de health check que devuelva el estado de la DB
```

Mirá cómo el plan aparece, cómo se reparten las tareas, cómo alguien pide ayuda, y cómo el control de calidad frena lo que no está listo.

### La prueba honesta

Elegí un encargo real pero **acotado** (un bug, una función, un endpoint). Y prestá atención a tres cosas:

1. ¿Se repartió solo, o tuviste que pedir que delegue?
2. ¿Los controles de calidad encontraron algo que vos no habías visto?
3. ¿Terminó sin que tuvieras que recordarle lo que ya sabía?

Si las tres respuestas son buenas, la oficina funciona.

---

## 11. En resumen

**AI-OFFICE es un equipo de agentes de IA con la disciplina de una oficina real.**

- Vos das **un objetivo**, no una lista de instrucciones.
- El sistema **descompone, reparte, coordina y verifica** solo.
- Los agentes **se hablan entre sí** y se piden ayuda.
- El trabajo **se revisa entre pares**, nunca se auto-aprueba.
- **Pasa controles de calidad reales** antes de darse por terminado.
- **No para hasta terminar**, y si no puede, te lo pregunta con opciones.
- **Todo queda registrado** en disco, auditable y portable.

Es la diferencia entre un asistente que responde y una oficina que entrega.

---

**¿Querés ver los detalles técnicos?** → [`docs/ARCHITECTURE.md`](ARCHITECTURE.md)
**¿Querés ver cómo se usa?** → [`README.md`](../README.md)
**¿Querés ver el protocolo completo?** → [`skills/oficina/`](../skills/oficina/)
