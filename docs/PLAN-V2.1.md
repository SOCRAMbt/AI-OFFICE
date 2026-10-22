# Plan de cierre — AI-OFFICE v2.1

Fecha: 2026-10-22 · Base: `oficina-opencode@2.0.1` · Commit base: `5232fe3`

## Contexto

El review externoidentified 5 prioridades. Contra el snapshot viejo (decía 201 tests,
pesos 40/35/20/5, 4 commits) algunas cosas **ya están resueltas**:

| Punto del review | Estado real |
|---|---|
| Pesos 40/35/20/5 | YA RESUELTO — ahora 35/28/18/10/5 + recall/focus de misión |
| "201 tests" | YA RESUELTO — 213 tests, 14 archivos |
| "4 commits" | YA RESUELTO — 6 commits |
| README clone con URL vieja | YA RESUELTO — 13 referencias corregidas, 2.0.1 publicado |

El resto **es real y verificado contra el código**:

| # | Hallazgo verificado | Dónde |
|---|---|---|
| 1 | `path.relative` sin realpath → **escape por symlink** | `scopeGuard.ts:95-98` |
| 2 | `mayTouch: ["**"]` autoriza **cualquier** path, incluso `../../etc/passwd` | `scopeGuard.ts:53` |
| 3 | Solo cubre `edit/write/patch/multiedit/apply_patch` — **no** `bash` ni `task` | `scopeGuard.ts:23` |
| 4 | `extractPath` de `patch` solo lee el **primer** archivo del diff | `scopeGuard.ts:67-74` |
| 5 | Sin protección de archivos sensibles (`.npmrc`, `.git/**`, `*.pem`) | — |
| 6 | Subagente delegado **no hereda scope**: sin binding de sesión, el guard sale temprano | `scopeGuard.ts:88-90` |
| 7 | `LeaseStore.acquire` es **TOCTOU**: read → check → write. Doble claim posible | `leases.ts:42-57` |
| 8 | `Bus.nextSeq` es TOCTOU → **seq duplicados** entre emisores concurrentes | `bus.ts:88-99` |
| 9 | Idempotencia del bus es check-then-write → **mensajes duplicados** | `bus.ts:108-111` |
| 10 | `cardId`/`agentId`/`messageId` sin sanitizar → **path traversal** al escribir | `paths.ts:153-165`, `bus.ts:211` |
| 11 | `spawnsUsed` nunca se incrementa → invariante `max-spawns-total` **nunca dispara** | `retry.ts:83` sin callers |
| 12 | `transitionRun` importado y **nunca llamado**; el status se muta directo | `office.ts:28` |
| 13 | `state.pendingGates` nunca se puebla; `state.iteration` nunca se incrementa | `types.ts:352` |
| 14 | `savePlan` no valida `maxCards` → se pueden planear 50 cards con límite 20 | `office.ts:467` |
| 15 | `LeaseStore.heartbeat` existe y **nadie lo llama** → los leases expiran duro | `leases.ts:62` |
| 16 | No hay grafo de requisitos→evidencia | — |
| 17 | No hay control de costo, tokens, tiempo ni parada de emergencia | — |
| 18 | No hay benchmark de selección de agentes | — |
| 19 | Cifras de la documentación hardcodeadas, sin fuente única | `README.md` |
| 20 | Sin matriz de compatibilidad de versiones | — |

## Hallazgo nuevo (no estaba en el review)

La API del plugin tiene **3 hooks sin usar** que resuelven partes del problema mejor
de lo que había planeado:

- `permission.ask` → **denegar a nivel framework**, no solo en nuestro hook.
- `tool.execute.after` → **tripwire**: detectar escrituras que pasaron el hook.
- `chat.message` / `chat.params` → **nombre del agente y modelo por sesión**
  (clave para P5 y para resolver el scope de subagentes).
- `event` con `message.updated` → `AssistantMessage.cost` + `tokens{input,output,reasoning,cache}`
  + `modelID` + `providerID` + latencia. **El costo ya viene del motor.**
- `experimental.compaction.autocontinue` → **freno de emergencia** (desactivar el auto-continuar).

## Diseño

### P1 — Scope guard real (3 capas)

| Capa | Mecanismo | Cubre |
|---|---|---|
| 1. Framework | `permission.ask` → `deny` | todas las tools, **incluidas las de subagentes** |
| 2. Propio | `tool.execute.before` → `sandbox.check` | resolución real, symlinks, sensibles, shell |
| 3. Detección | `tool.execute.after` → tripwire | lo que se coló (writes por shell) |

`src/core/sandbox.ts` (nuevo):
- `resolveTarget(projectRoot, raw)` → verifica NUL, normaliza con `path.resolve`,
  **camina cada componente** con `lstat` para detectar symlinks, resuelve con
  `realpath` el ancestro existente más profundo, y **re-valida la contención**.
- `SENSITIVE_PATTERNS` → `.env*`, `.npmrc`, `.netrc`, `.git/**`, `*.pem|key|p12`,
  `id_rsa*`, `.ssh/**`, `.aws/**`, `.gnupg/**`, `credentials.json`, `service-account*.json`.
- `analyzeShellCommand(cmd)` → extrae paths de escritura (`>`, `>>`, `tee`, `cp`,
  `mv`, `rm`, `sed -i`, `dd`, `install`, `truncate`, `touch`, `python -c`, `node -e`).
- `checkScope(...)` → veredicto único con motivo legible.

Resolución de scope de subagentes: mapa `sessionID → agent` construido con
`chat.message` + `message.updated`, y `agent → card` desde el roster. El scope
**hereda por el árbol de padres** de la sesión.

### P2 — Requirement-to-Evidence Graph

`src/core/evidence.ts` (nuevo):
- Cada `acceptance[]` de una card es un **requisito** (nivel 1 = obligatorio).
- Cada requisito se enlaza a: artefactos, tests citados, gates, y veredicto manual.
- Niveles: 1 estático, 2 comportamiento, 3 validación de requisitos, 4 auditoría.
- Invariante nuevo: `evidence-required-before-done` — sin evidencia de todos los
  requisitos obligatorios, la card **no** pasa a `done`.
- Gate nuevo: fase `verify`.

### P3 — Documentación generada

- `src/core/docsync.ts` → única fuente de verdad: escanea el catálogo real y
  emite `{ agents, divisions, divisionsList, tools, hooks, tests }`.
- `scripts/sync-docs.ts` → regenera las cifras en README y docs; **falla** si hay drift.
- CI: paso que corre el script y falla si el diff no está vacío.
- `docs/COMPATIBILITY.md` → matriz OpenCode × `@opencode-ai/plugin` generada.

### P4 — Concurrencia y recuperación

`src/core/atomic.ts` (nuevo):
- `putOnce(path, content)` → `open(path, "wx")`: winner único, losers leen el existente.
- `allocateSeq(channelDir)` → asignacion atomica con `wx` + reintento incremental.
- `withLock(lockPath, fn)` → mutex por directorio (`mkdir` atómico).

Aplicado a: lease acquire (O_EXCL + takeover de expirado), seq del bus,
idempotencia del bus, y `safeId()` para todos los ids que se usan como nombre de archivo.

`src/core/recovery.ts` (nuevo): reconciliación al arrancar — estado vs artefactos
vs filesystem. Detecta: card en `review` sin artefactos, lease huérfano, artefacto
sin card, `done` sin gate.

### P5 — Costo y control

`src/core/cost.ts` (nuevo): ledger por corrida/card/agente/fase.
- Entrada: evento `message.updated` → `AssistantMessage.cost` + `tokens` + modelo.
- Presupuestos: por corrida (tokens/USD), por card, y separados por fase
  (implementación / review / reparación).
- Estimación previa a una corrida grande.
- Métricas: costo por requisito completado y verificado, tokens por card,
  lecturas repetidas del mismo path (trabajo redundante).
- Freno: `oficina_stop` + `experimental.compaction.autocontinue` desactivado +
  el hook de idle respeta el flag.

## Orden de ejecución

1. `types.ts` — contratos nuevos (todo lo demás depende de esto).
2. `sandbox.ts` + `scopeGuard.ts` + tests adversariales. **(P1)**
3. `atomic.ts` + `leases.ts` + `bus.ts` + `paths.ts` + tests de concurrencia. **(P4)**
4. `evidence.ts` + gate `verify` + invariante. **(P2)**
5. `cost.ts` + tools + hook de costo. **(P5)**
6. `recovery.ts` + hook de arranque. **(P4)**
7. `docsync.ts` + `scripts/sync-docs.ts` + CI + `COMPATIBILITY.md`. **(P3)**
8. Benchmark de selección.
9. Verificación total: typecheck, tests, cobertura, build, e2e, npm pack, publish.

## Criterio de terminado

- [ ] typecheck strict limpio
- [ ] todos los tests pasan (base: 213)
- [ ] cobertura ≥ 87% stmts
- [ ] build limpio
- [ ] e2e verde contra el paquete instalado
- [ ] `npm pack` sin warnings
- [ ] documentación generada coincide con el código (CI lo verifica)
- [ ] publicado en npm
