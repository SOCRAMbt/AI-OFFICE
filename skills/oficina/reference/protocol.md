# Protocolo de OFICINA

Este documento es la ley de la oficina. Si una regla acá y el criterio propio del agent discrepan, gana el criterio propio del agent — pero debe dejarlo escrito en el artefacto para que el Director pueda corregirlo.

---

## 0. PROJECT_ROOT y OFFICE_DIR

Los permisos y las rutas relativas se resuelven contra el **directorio de trabajo de la sesión**, que no siempre es el proyecto. Antes de la primera card:

1. Detectá `PROJECT_ROOT` buscando un marker de proyecto (`package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Makefile`, `.git`) en el cwd, y si no hay, en los subdirectorios de primer nivel.
2. `OFFICE_DIR = PROJECT_ROOT/.oficina/`. Si no se puede crear ahí, usá `~/.oficina/<slug>/`.
3. **Todos los prompts de delegación llevan el PROJECT_ROOT absoluto.** Decí "todos los paths son relativos a `<PROJECT_ROOT>`" porque los subagentes heredan el cwd de la sesión.
4. Anotá el PROJECT_ROOT y el OFFICE_DIR en `board.md` para que una sesión retomada los encuentre sin recalcular.

### La oficina se vigila a sí misma

El Verificador, en la fase 6 (diff review), además de buscar debug statements y archivos fuera de scope, **verifica que solo se haya tocado lo que la card autorizaba**. Si un agente modificó archivos fuera de su scope — incluido el Director tocando código de producción — eso es un finding y la card va a REWORK.

La oficina no confía en la disciplina: la audita.

---

## 1. Ciclo de vida de una card

```
TODO ──(deps ok + agente asignado)──> IN_PROGRESS
  │                                          │
  │                                          ├──(owner entrega handoff + evidence)──> REVIEW
  │                                          │                                          │
  │                                          │                        ┌─────────────────���────┴──────────┐
  │                                          │                        │  Crítico (≠ owner)              │
  │                                          │                        │  APROBADO ─────────┐            │
  │                                          │                        │  RECHAZADO ──┐     │            │
  │                                          │                        └──────────────┼─────┘            │
  │                                          │                                       │                  │
  │                                          │                                 Verificador + Guardián
  │                                          │                                       │
  │                                          │                    ┌──────────────────┴───────────────┐
  │                                          │                    │  PASS ────────────> DONE         │
  │                                          │                    │  FAIL ──> REWORK ─┘                 │
  │                                          │                                                  │
  │                                          │   Rework 1 → vuelve a IN_PROGRESS (mismo owner, feedback)
  │                                          │   Rework 2 → REPLAN (Director rehace la card, puede cambiar owner)
  │                                          │   Rework 3 → ESCALATED (pide decisión al usuario)
  └──────────────────────────────────────────┘
```

---

## 2. Artefactos: la memoria de la oficina

Una card vive en `.oficina/artifacts/<card-id>/`. Si no hay archivo, no hay hecho.

### `handoff.md` (lo escribe el owner)

```markdown
# <card-id> — <título>

**Owner:** <agente>
**Estado:** IN_PROGRESS → REVIEW
**Fecha:** <ISO>

## Qué hice
<qué se implementó, en concreto>

## Archivos tocados
- `path/to/file.ts` — <qué cambió y por qué>
- `path/to/other.ts` — ...

## Decisiones tomadas
- <decisión> — <rationale>

## Qué quedó afuera
- <qué NO se hizo y por qué>

## Qué necesita el siguiente
- <lo que la siguiente card o el usuario debe saber>
```

### `evidence.md` (lo escribe el owner)

Salida **real** de comandos. Sin cromo, sin "debería funcionar":

```markdown
# Evidencia — <card-id>

## Comando: `npm test`
```
<salida real pegada>
```
**Resultado:** PASS (23 tests, 0 fail)
```

Regla: si no pegaste la salida real, la card no tiene evidencia y va a REWORK.

### `review.md` (lo escribe el Crítico)

```markdown
# Revisión — <card-id>

**Revisor:** <agente> (≠ owner)
**Alcance:** <archivos exactos revisados>
**Ledger:** <qué se leyó completo, callers leídos, paths compartidos trazados>

## Veredicto: APROBADO | RECHAZADO

## Findings

### [C-001] <título>
- **Confianza:** 92
- **Ubicación:** `path/file.ts:42`
- **Categoría:** Security
- **Descripción:** <qué está mal>
- **Escenario de reproducción:** <pasos concretos que lo disparan>
- **Baseline:** <evidencia de que lo introdujo esta card>
- **Fix:** <dirección>
- **Test de regresión:** <dónde va>

## Dimensiones revisadas
- security: <sí/no — por qué>
- performance: <sí/no — por qué>
- architecture: <sí/no — por qué>
- testing: <sí/no — por qué>
```

### `gates.md` (lo escriben Verificador y Guardián)

```markdown
# Gates — <card-id>

## Técnico
| # | Fase | Comando | Resultado | Detalle |
|---|------|---------|-----------|---------|
| 1 | Build | `npm run build` | PASS | exit 0 |
| 2 | Type check | `tsc --noEmit` | PASS | 0 errores |
| 3 | Lint | `eslint .` | FAIL | 3 warnings nuevos |
| 4 | Tests | `npm test` | PASS | 23/23 |
| 5 | Sec grep | `grep -rE "AKIA..."` | PASS | 0 |
| 6 | Diff | `git diff main` | PASS | 4 archivos |

**Gate técnico:** FAIL

## Seguridad
- Trust boundaries: <mapeadas>
- Input paths auditados: <lista>
- Secretos: <resultado del escaneo>
- Dependencias: <resultado>
- Findings de seguridad: <lista o "ninguno">

**Gate seguridad:** PASS
```

### `decision.md` (lo escribe el Director)

```markdown
# Decisión — <card-id>

**Decisión:** APROBADA | REWORK | REPLAN | ESCALADA
**Razón:** <por qué>
**Siguiente:** <qué card sigue, o qué se le pregunta al usuario>
```

---

## 3. Handoff: cómo se coordinan sin hablar

El problema: los subagentes son stateless. No se ven entre sí.

La solución: **el disco es el bus de mensajes**.

```
Implementador  ──escribe──> artifacts/T-01/handoff.md
                                      │
                                      ▼
Crítico         ──lee──────> artifacts/T-01/handoff.md + artifacts/T-00/handoff.md
                        │
                        ▼
              artifacts/T-01/review.md
                                      │
                                      ▼
Verificador     ──lee──────> artifacts/T-01/{handoff,evidence,review}.md
                        │
                        ▼
              artifacts/T-01/gates.md
                                      │
                                      ▼
Director         ──lee──────> artifacts/T-01/*.md → actualiza board.md + state.json
```

**Regla de lectura:** antes de empezar una card, el agente lee **todos** los `handoff.md` de cards previas que le importen + `context.md`. No pregunta, lee.

**Regla de escritura:** cada agente deja su salida en su archivo. Nunca en el chat.

### `.oficina/context.md` — el ledger acumulado

```markdown
# Contexto de la corrida — <objetivo>

## Decisiones tomadas
- [T-00] Usamos JWT con refresh tokens porque <razón> (decidido por code-architect)

## Constraints descubiertos
- [T-01] El proyecto usa Prisma, no SQL directo
- [T-02] Los tests corren con `npm test` (no `npm run test:unit`)

## Piezas construidas
- [T-01] `src/auth/login.ts` — endpoint de login, retorna access + refresh
- [T-02] `prisma/schema.prisma` — modelo User con email único

## Trampas encontradas
- [T-01] `src/lib/oldAuth.ts` está muerto, no borrar (lo usa `scripts/legacy-migrate.ts`)

## Temas abiertos
- Falta decidir rate limiting en login
```

Este archivo es **lo que evita la repetición**. El Director lo actualiza al cerrar cada card.

---

## 4. Gates de calidad (quality bar)

De la skill `verification-loop`. El Verificador corre las 6 fases.

**Reglas:**
- Una fase aplicable en FAIL → la card va a REWORK.
- Una fase no aplicable → `N/A` con el motivo explícito. Ej: "N/A — el proyecto no tiene type checker".
- Gate técnico y gate seguridad son **independientes**: security PASS + tech FAIL = REWORK.
- El Crítico y el Verificador son gates distintos. Reviewer ok + build roto = REWORK. Build ok + review con findings = REWORK.

**Umbral de confianza de findings:** ≥ 80. Findings por debajo se descartan con la razón anotada (no se borran en silencio).

---

## 5. Escalamiento

Escalar es caro. No hacerlo por todo. Reglas:

| Situación | Acción |
|---|---|
| Card rechazada 1 vez | Rework automático. Sin escalar. |
| Card rechazada 2 veces | **Replan**: el Director rehace la card — puede cambiar owner, scope, approach, o partirla en dos. Sin escalar. |
| Card rechazada 3 veces | **ESCALAR**: se le presenta al usuario el objetivo de la card, los 3 intentos, por qué falló, y 2-3 opciones concretas con recomendación. |
| Dependencia externa (API caída, credencial faltante, decisión de producto) | **ESCALAR** inmediatamente. No reintentar. |
| Objetivo ambiguo con impacto grande en el diseño | **ESCALAR** antes de construir. |
| Conflicto entre cards (mismo archivo, approaches incompatibles) | **ESCALAR**. |
| Presupuesto de cards/agentes agotado | **ESCALAR** con informe de lo alcanzado. |

**Formato de escalación:**

```markdown
## 🛑 Escalación — <card-id>

**Objetivo de la card:** ...
**Qué intenté:** 3 intentos (resumen de 1 línea cada uno)
**Por qué no avanza:** <causa raíz>
**Archivos en juego:** ...

**Opción A:** <qué hacer> — <trade-off>
**Opción B:** <qué hacer> — <trade-off>
**Opción C:** <qué hacer> — <trade-off>

**Mi recomendación:** <Opción X> porque <razón>
```

Nunca escalar con un monólogo. Siempre con opciones.

---

## 6. Checkpoints (control pane)

Cada 3 cards completadas → informe al usuario:

```markdown
## 🏢 Checkpoint — <n>/<total> cards

**Objetivo:** <objetivo original>
**Progreso:** <n>/<total> cards DONE

| Card | Estado | Owner | Gates | Revisión |
|------|--------|-------|-------|----------|
| T-00 | DONE | code-explorer | ✅ | APROBADO |
| T-01 | IN_PROGRESS | general | — | — |
| T-02 | BLOCKED | general | ❌ | RECHAZADO |

**Bloqueos:** <ninguno | lista con owner y acción>
**Siguiente:** <qué sigue>
```

El checkpoint **no pide permiso**. Informa y sigue. Solo frena si hay una escalación.

---

## 7. Informe final de entrega

```markdown
# 🏢 OFICINA — Informe de entrega

**Objetivo:** <objetivo original>
**Fecha:** <ISO>
**Resultado:** CUMPLIDO | PARCIAL | BLOQUEADO

## Trabajo entregado
| Card | Qué entregó | Owner | Evidencia |
|------|-------------|-------|-----------|
| T-00 | Mapa de auth existente | code-explorer | artifacts/T-00/ |

## Gates finales
- Técnico: PASS/FAIL (<fases>)
- Seguridad: PASS/FAIL (<hallazgos>)
- Revisiones: <n> APROBADAS, <n> RECHAZADAS

## Archivos tocados
- <lista>

## Decisiones clave
- <decisión> — <razón>

## Qué NO se hizo
- <alcance excluido> — <por qué>

## Deuda técnica dejada
- <deuda> — <por qué se aceptó>

## Recomendaciones
- <qué haría distinto la próxima vez>
```

---

## 8. Recuperación tras reinicio

Si la sesión se corta a mitad de una corrida:

1. Leer `.oficina/state.json` → obtener card actual, iteración, contadores
2. Leer `.oficina/board.md` → ver el panorama
3. Buscar artifacts de la card en curso: si hay `handoff.md` pero no `review.md` → la card está en REVIEW, delegar al Crítico
4. Si no hay artifacts → la card está en IN_PROGRESS, reasignar al owner
5. `context.md` mantiene el conocimiento acumulado

**Nunca arranques de cero si existe `.oficina/`.**
