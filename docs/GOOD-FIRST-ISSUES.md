# Good first issues — propuestas listas para abrir (v3.3.x)

Cinco tareas reales, acotadas y verificables, pensadas para gente nueva. Pueden abrirse con el label `good first issue` + `help wanted` desde cualquier cuenta con permisos de creación de issues (gh CLI o la UI). Están redactadas para que no dependan de contexto previo.

> **Aviso de alcance:** son tareas independientes, pequeñas y sin breaking changes. Nada de esto toca el motor de la oficina, el scope guard ni los gates.

---

## 1) README (EN) — resumen de 8 líneas para no-hispanohablantes

**Tipo:** docs · **Labels:** `good first issue` `documentation`

En el README principal, arriba del bloque generado, agregar un resumen en inglés de máximo 8 líneas: qué es, para quién, 1 comando de instalación, link al demo y licencia. El repo hoy habla español; la mayoría de usuarios OpenCode en el mundo leen inglés.

**Hecho cuando:** el bloque está en `README.md`, `npm run docs:check` pasa, y la tabla "Hechos" + CI quedan en verde.

## 2) `oficina stats` — comando CLI con métricas de la corrida

**Tipo:** feature pequeña · **Labels:** `good first issue` `enhancement`

Agregar `oficina stats` al CLI (`src/cli.ts`): lee `state.json` de `<PROJECT_ROOT>/.oficina/` y muestra en una tabla: runId, status, cards (todo/in_progress/review/done), iteración, y cuántos agentes siguen vivos (heartbeats). Sin tocar el motor.

**Hecho cuando:** `oficina stats` funciona en un `.oficina/` de ejemplo (`npm run dashboard:demo` produce uno), con tests en `tests/cli.test.ts` de al menos 3 casos.

## 3) Badge de "Tests" dinámico vía static real, o eliminarlo

**Tipo:** casa en orden · **Labels:** `good first issue` `documentation`

El badge `tests-574` en el README es estático y envejece mal. Opciones: (a) reemplazarlo por uno dinámico basado en un JSON generado por CI (pista: shields.io endpoint + un workflow que publice el número), o (b) quitarlo y dejar solo el de CI. Implementar (a) requiere CI; el maintainer prefiere (b) si (a) se complica.

**Hecho cuando:** el badge muestra el número real o no miente; `npm run docs:check` verde.

## 4) CONTRIBUTING.md — matriz "¿qué quieres hacer?"

**Tipo:** docs · **Labels:** `good first issue` `documentation`

Agregar al inicio de CONTRIBUTING.md una tabla de 6 filas del estilo "Quiero… → Archivo/pasos" para los caminos: "reportar un bug", "proponer una idea", "subir un PR", "solo quiero preguntar", "soy una IA en análisis", "encontré una vulnerabilidad" — cada uno con su link (templates de issue, SECURITY.md, etc.).

**Hecho cuando:** un recién llegado puede encontrar la puerta correcta en <30 segundos.

## 5) `examples/` — proyecto de ejemplo mínimo ejecutable

**Tipo:** DX · **Labels:** `good first issue` `enhancement` `help wanted`

Crear `examples/hello-office/`: un proyecto de juguete (por ejemplo un CLI de "lista de tareas" de 3 archivos) con un objetivo `/oficina` esperado, un README corto con el paso a paso y el output esperado de los primeros mensajes. Nada de dependencias pesadas; el objetivo es que un usuario nuevo replique la demo en 5 minutos.

**Hecho cuando:** `git clone` + los pasos del README terminan con los tests del proyecto ejemplo pasados por la oficina.

---

## Cómo abrirlos (copy-paste listo para gh CLI)

```bash
# Con gh autenticado (o pegando los títulos/cuerpos en la UI de GitHub con los labels):
gh issue create --repo SOCRAMbt/AI-OFFICE --label "good first issue,documentation" --title "README (EN): resumen de 8 líneas para no-hispanohablantes" --body-file <(head -n ...) …
```

Más simple desde la web: Issues → New issue → escribir el título y el cuerpo arriba con los labels indicados. Cinco issues, 10 minutos.
