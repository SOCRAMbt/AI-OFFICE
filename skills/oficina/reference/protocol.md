# Protocolo de OFICINA

Este documento es la ley de la oficina. Si una regla ac├í y el criterio propio del agent discrepan, gana el criterio propio del agent ÔÇö pero debe dejarlo escrito en el artefacto para que el Director pueda corregirlo.

---

## 0. PROJECT_ROOT y OFFICE_DIR

Los permisos y las rutas relativas se resuelven contra el **directorio de trabajo de la sesi├│n**, que no siempre es el proyecto. Antes de la primera card:

1. Detect├í `PROJECT_ROOT` buscando un marker de proyecto (`package.json`, `pyproject.toml`, `setup.py`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Makefile`, `.git`) en el cwd, y si no hay, en los subdirectorios de primer nivel.
2. `OFFICE_DIR = PROJECT_ROOT/.oficina/`. Si no se puede crear ah├¡, us├í `~/.oficina/<slug>/`.
3. **Todos los prompts de delegaci├│n llevan el PROJECT_ROOT absoluto.** Dec├¡ "todos los paths son relativos a `<PROJECT_ROOT>`" porque los subagentes heredan el cwd de la sesi├│n.
4. Anot├í el PROJECT_ROOT y el OFFICE_DIR en `board.md` para que una sesi├│n retomada los encuentre sin recalcular.

### La oficina se vigila a s├¡ misma

El Verificador, en la fase 6 (diff review), adem├ís de buscar debug statements y archivos fuera de scope, **verifica que solo se haya tocado lo que la card autorizaba**. Si un agente modific├│ archivos fuera de su scope ÔÇö incluido el Director tocando c├│digo de producci├│n ÔÇö eso es un finding y la card va a REWORK.

La oficina no conf├¡a en la disciplina: la audita.

---

## 1. Ciclo de vida de una card

```
TODO ÔöÇÔöÇ(deps ok + agente asignado)ÔöÇÔöÇ> IN_PROGRESS
  Ôöé                                          Ôöé
  Ôöé                                          Ôö£ÔöÇÔöÇ(owner entrega handoff + evidence)ÔöÇÔöÇ> REVIEW
  Ôöé                                          Ôöé                                          Ôöé
  Ôöé                                          Ôöé                        ÔöîÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ´┐¢´┐¢´┐¢ÔöÇÔöÇÔöÇÔöÇÔö┤ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÉ
  Ôöé                                          Ôöé                        Ôöé  Cr├¡tico (Ôëá owner)              Ôöé
  Ôöé                                          Ôöé                        Ôöé  APROBADO ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÉ            Ôöé
  Ôöé                                          Ôöé                        Ôöé  RECHAZADO ÔöÇÔöÇÔöÉ     Ôöé            Ôöé
  Ôöé                                          Ôöé                        ÔööÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔö╝ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÿ            Ôöé
  Ôöé                                          Ôöé                                       Ôöé                  Ôöé
  Ôöé                                          Ôöé                                 Verificador + Guardi├ín
  Ôöé                                          Ôöé                                       Ôöé
  Ôöé                                          Ôöé                    ÔöîÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔö┤ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÉ
  Ôöé                                          Ôöé                    Ôöé  PASS ÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ> DONE         Ôöé
  Ôöé                                          Ôöé                    Ôöé  FAIL ÔöÇÔöÇ> REWORK ÔöÇÔöÿ                 Ôöé
  Ôöé                                          Ôöé                                                  Ôöé
  Ôöé                                          Ôöé   Rework 1 ÔåÆ vuelve a IN_PROGRESS (mismo owner, feedback)
  Ôöé                                          Ôöé   Rework 2 ÔåÆ REPLAN (Director rehace la card, puede cambiar owner)
  Ôöé                                          Ôöé   Rework 3 ÔåÆ ESCALATED (pide decisi├│n al usuario)
  ÔööÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇÔöÿ
```

---

## 2. Artefactos: la memoria de la oficina

Una card vive en `.oficina/artifacts/<card-id>/`. Si no hay archivo, no hay hecho.

### `handoff.md` (lo escribe el owner)

```markdown
# <card-id> ÔÇö <t├¡tulo>

**Owner:** <agente>
**Estado:** IN_PROGRESS ÔåÆ REVIEW
**Fecha:** <ISO>

## Qu├® hice
<qu├® se implement├│, en concreto>

## Archivos tocados
- `path/to/file.ts` ÔÇö <qu├® cambi├│ y por qu├®>
- `path/to/other.ts` ÔÇö ...

## Decisiones tomadas
- <decisi├│n> ÔÇö <rationale>

## Qu├® qued├│ afuera
- <qu├® NO se hizo y por qu├®>

## Qu├® necesita el siguiente
- <lo que la siguiente card o el usuario debe saber>
```

### `evidence.md` (lo escribe el owner)

Salida **real** de comandos. Sin cromo, sin "deber├¡a funcionar":

```markdown
# Evidencia ÔÇö <card-id>

## Comando: `npm test`
```
<salida real pegada>
```
**Resultado:** PASS (23 tests, 0 fail)
```

Regla: si no pegaste la salida real, la card no tiene evidencia y va a REWORK.

### `review.md` (lo escribe el Cr├¡tico)

```markdown
# Revisi├│n ÔÇö <card-id>

**Revisor:** <agente> (Ôëá owner)
**Alcance:** <archivos exactos revisados>
**Ledger:** <qu├® se ley├│ completo, callers le├¡dos, paths compartidos trazados>

## Veredicto: APROBADO | RECHAZADO

## Findings

### [C-001] <t├¡tulo>
- **Confianza:** 92
- **Ubicaci├│n:** `path/file.ts:42`
- **Categor├¡a:** Security
- **Descripci├│n:** <qu├® est├í mal>
- **Escenario de reproducci├│n:** <pasos concretos que lo disparan>
- **Baseline:** <evidencia de que lo introdujo esta card>
- **Fix:** <direcci├│n>
- **Test de regresi├│n:** <d├│nde va>

## Dimensiones revisadas
- security: <s├¡/no ÔÇö por qu├®>
- performance: <s├¡/no ÔÇö por qu├®>
- architecture: <s├¡/no ÔÇö por qu├®>
- testing: <s├¡/no ÔÇö por qu├®>
```

### `gates.md` (lo escriben Verificador y Guardi├ín)

```markdown
# Gates ÔÇö <card-id>

## T├®cnico
| # | Fase | Comando | Resultado | Detalle |
|---|------|---------|-----------|---------|
| 1 | Build | `npm run build` | PASS | exit 0 |
| 2 | Type check | `tsc --noEmit` | PASS | 0 errores |
| 3 | Lint | `eslint .` | FAIL | 3 warnings nuevos |
| 4 | Tests | `npm test` | PASS | 23/23 |
| 5 | Sec grep | `grep -rE "AKIA..."` | PASS | 0 |
| 6 | Diff | `git diff main` | PASS | 4 archivos |

**Gate t├®cnico:** FAIL

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
# Decisi├│n ÔÇö <card-id>

**Decisi├│n:** APROBADA | REWORK | REPLAN | ESCALADA
**Raz├│n:** <por qu├®>
**Siguiente:** <qu├® card sigue, o qu├® se le pregunta al usuario>
```

---

## 3. Handoff: c├│mo se coordinan sin hablar

El problema: los subagentes son stateless. No se ven entre s├¡.

La soluci├│n: **el disco es el bus de mensajes**.

```
Implementador  ÔöÇÔöÇescribeÔöÇÔöÇ> artifacts/T-01/handoff.md
                                      Ôöé
                                      Ôû╝
Cr├¡tico         ÔöÇÔöÇleeÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ> artifacts/T-01/handoff.md + artifacts/T-00/handoff.md
                        Ôöé
                        Ôû╝
              artifacts/T-01/review.md
                                      Ôöé
                                      Ôû╝
Verificador     ÔöÇÔöÇleeÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ> artifacts/T-01/{handoff,evidence,review}.md
                        Ôöé
                        Ôû╝
              artifacts/T-01/gates.md
                                      Ôöé
                                      Ôû╝
Director         ÔöÇÔöÇleeÔöÇÔöÇÔöÇÔöÇÔöÇÔöÇ> artifacts/T-01/*.md ÔåÆ actualiza board.md + state.json
```

**Regla de lectura:** antes de empezar una card, el agente lee **todos** los `handoff.md` de cards previas que le importen + `context.md`. No pregunta, lee.

**Regla de escritura:** cada agente deja su salida en su archivo. Nunca en el chat.

### `.oficina/context.md` ÔÇö el ledger acumulado

```markdown
# Contexto de la corrida ÔÇö <objetivo>

## Decisiones tomadas
- [T-00] Usamos JWT con refresh tokens porque <raz├│n> (decidido por code-architect)

## Constraints descubiertos
- [T-01] El proyecto usa Prisma, no SQL directo
- [T-02] Los tests corren con `npm test` (no `npm run test:unit`)

## Piezas construidas
- [T-01] `src/auth/login.ts` ÔÇö endpoint de login, retorna access + refresh
- [T-02] `prisma/schema.prisma` ÔÇö modelo User con email ├║nico

## Trampas encontradas
- [T-01] `src/lib/oldAuth.ts` est├í muerto, no borrar (lo usa `scripts/legacy-migrate.ts`)

## Temas abiertos
- Falta decidir rate limiting en login
```

Este archivo es **lo que evita la repetici├│n**. El Director lo actualiza al cerrar cada card.

---

## 4. Gates de calidad (quality bar)

De la skill `verification-loop`. El Verificador corre las 6 fases.

**Reglas:**
- Una fase aplicable en FAIL ÔåÆ la card va a REWORK.
- Una fase no aplicable ÔåÆ `N/A` con el motivo expl├¡cito. Ej: "N/A ÔÇö el proyecto no tiene type checker".
- Gate t├®cnico y gate seguridad son **independientes**: security PASS + tech FAIL = REWORK.
- El Cr├¡tico y el Verificador son gates distintos. Reviewer ok + build roto = REWORK. Build ok + review con findings = REWORK.

**Umbral de confianza de findings:** ÔëÑ 80. Findings por debajo se descartan con la raz├│n anotada (no se borran en silencio).

---

## 5. Escalamiento

Escalar es caro. No hacerlo por todo. Reglas:

| Situaci├│n | Acci├│n |
|---|---|
| Card rechazada 1 vez | Rework autom├ítico. Sin escalar. |
| Card rechazada 2 veces | **Replan**: el Director rehace la card ÔÇö puede cambiar owner, scope, approach, o partirla en dos. Sin escalar. |
| Card rechazada 3 veces | **ESCALAR**: se le presenta al usuario el objetivo de la card, los 3 intentos, por qu├® fall├│, y 2-3 opciones concretas con recomendaci├│n. |
| Dependencia externa (API ca├¡da, credencial faltante, decisi├│n de producto) | **ESCALAR** inmediatamente. No reintentar. |
| Objetivo ambiguo con impacto grande en el dise├▒o | **ESCALAR** antes de construir. |
| Conflicto entre cards (mismo archivo, approaches incompatibles) | **ESCALAR**. |
| Presupuesto de cards/agentes agotado | **ESCALAR** con informe de lo alcanzado. |

**Formato de escalaci├│n:**

```markdown
## ­ƒøæ Escalaci├│n ÔÇö <card-id>

**Objetivo de la card:** ...
**Qu├® intent├®:** 3 intentos (resumen de 1 l├¡nea cada uno)
**Por qu├® no avanza:** <causa ra├¡z>
**Archivos en juego:** ...

**Opci├│n A:** <qu├® hacer> ÔÇö <trade-off>
**Opci├│n B:** <qu├® hacer> ÔÇö <trade-off>
**Opci├│n C:** <qu├® hacer> ÔÇö <trade-off>

**Mi recomendaci├│n:** <Opci├│n X> porque <raz├│n>
```

Nunca escalar con un mon├│logo. Siempre con opciones.

---

## 6. Checkpoints (control pane)

Cada 3 cards completadas ÔåÆ informe al usuario:

```markdown
## ­ƒÅó Checkpoint ÔÇö <n>/<total> cards

**Objetivo:** <objetivo original>
**Progreso:** <n>/<total> cards DONE

| Card | Estado | Owner | Gates | Revisi├│n |
|------|--------|-------|-------|----------|
| T-00 | DONE | code-explorer | Ô£à | APROBADO |
| T-01 | IN_PROGRESS | general | ÔÇö | ÔÇö |
| T-02 | BLOCKED | general | ÔØî | RECHAZADO |

**Bloqueos:** <ninguno | lista con owner y acci├│n>
**Siguiente:** <qu├® sigue>
```

El checkpoint **no pide permiso**. Informa y sigue. Solo frena si hay una escalaci├│n.

---

## 7. Informe final de entrega

```markdown
# ­ƒÅó OFICINA ÔÇö Informe de entrega

**Objetivo:** <objetivo original>
**Fecha:** <ISO>
**Resultado:** CUMPLIDO | PARCIAL | BLOQUEADO

## Trabajo entregado
| Card | Qu├® entreg├│ | Owner | Evidencia |
|------|-------------|-------|-----------|
| T-00 | Mapa de auth existente | code-explorer | artifacts/T-00/ |

## Gates finales
- T├®cnico: PASS/FAIL (<fases>)
- Seguridad: PASS/FAIL (<hallazgos>)
- Revisiones: <n> APROBADAS, <n> RECHAZADAS

## Archivos tocados
- <lista>

## Decisiones clave
- <decisi├│n> ÔÇö <raz├│n>

## Qu├® NO se hizo
- <alcance excluido> ÔÇö <por qu├®>

## Deuda t├®cnica dejada
- <deuda> ÔÇö <por qu├® se acept├│>

## Recomendaciones
- <qu├® har├¡a distinto la pr├│xima vez>
```

---

## 8. Recuperaci├│n tras reinicio

Si la sesi├│n se corta a mitad de una corrida:

1. Leer `.oficina/state.json` ÔåÆ obtener card actual, iteraci├│n, contadores
2. Leer `.oficina/board.md` ÔåÆ ver el panorama
3. Buscar artifacts de la card en curso: si hay `handoff.md` pero no `review.md` ÔåÆ la card est├í en REVIEW, delegar al Cr├¡tico
4. Si no hay artifacts ÔåÆ la card est├í en IN_PROGRESS, reasignar al owner
5. `context.md` mantiene el conocimiento acumulado

**Nunca arranques de cero si existe `.oficina/`.**
