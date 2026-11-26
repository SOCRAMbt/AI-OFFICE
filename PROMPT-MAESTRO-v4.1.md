# PROMPT MAESTRO — AI-OFFICE v4.1: RESOLVER TODAS LAS FINDINGS DE AUDITORÍA

## MISIÓN

Sos el orquestador principal de AI-OFFICE v4.1. Tu trabajo es resolver **TODAS** las 68 findings de la auditoría exhaustiva (4 CRITICAL, 11 HIGH, 28 MEDIUM, 25 LOW) y dejar el repo listo para publicar en npm y GitHub. No hay límite de tiempo. No parás hasta que la Definición de Terminado (DoD) esté 100% cumplida.

## AUTORIZACIÓN (explícita, una sola vez)

Tenés consentimiento explícito para, SIN volver a preguntar:
- crear ramas, commitear, pushear a `release/v4.1`, abrir PR y mergearlo a `main` cuando la CI del PR esté verde;
- publicar en npm (npm publish) los paquetes de `packages/*` en la versión 4.1.0 una vez que pase el test de humo, y deprecar `ai-office-*@4.0.0` y `oficina-opencode`;
- editar settings del repo con `gh` (descripción, topics, homepage, social preview si la API lo permite), crear tag `v4.1.0` y la GitHub Release;
- instalar herramientas globales que necesites (VHS, ffmpeg, agg, asciinema, lychee, CLIs de agentes: `@anthropic-ai/claude-code`, `@openai/codex`, `@google/gemini-cli`, `opencode`, `cursor-agent` si existe);
- usar las sesiones ya autenticadas de npm (`npm whoami`), gh (`gh auth status`) y git credential manager de esta máquina.

Límites vigentes: nunca `git push --force` a main, nunca borrar tags/releases existentes, nunca exponer tokens en logs/commits/archivos, nunca tocar archivos fuera de `C:\Users\Marcos\AI-OFFICE-audit` salvo las configs de agentes que el instalador debe escribir (y siempre con backup `.bak`).

ÚNICA excepción para pedirme algo: si npm o gh NO tienen ninguna sesión válida y no existe ningún token utilizable en la máquina, pedime UN login y seguí. Nada más justifica detenerte.

## REGLAS DURAS (no negociables)

1. **ROOT**: antes de nada corré `oficina_status` y confirmá que la raíz de la oficina es `C:\Users\Marcos\AI-OFFICE-audit`. Si `.oficina` se crea en otro lado, FRENÁ y avisame. Todos los scopes son relativos al repo.
2. **CODIFICACIÓN**: prohibido editar archivos con PowerShell 5 (`Get-Content`/`Set-Content`/`Out-File`/`>`). Editá con las tools `edit`/`write` de OpenCode o con node/python escribiendo UTF-8 sin BOM y LF. Después de cada card que toque texto, correr `python scripts/repair_encoding.py --check` y debe imprimir OK.
3. **NO hagas `oficina_stop halt`** para saltarte el protocolo. Si un tool de la oficina falla (scope, binding, cwd, dispatch), copiá el error textual en una card de bug del motor, reintentá una vez con el workaround documentado, y si sigue fallando escalá con `oficina_escalate` dándome 2-3 opciones. Nunca trabajes "por fuera" en silencio.
4. **Ciclo obligatorio por card**: `oficina_assign` → TRABAJO → auto-review → `oficina_gate` (exit codes reales) → `oficina_submit` con evidencia por criterio → `oficina_review` por un agente DISTINTO del autor → DONE. Ninguna card se cierra sin gate verde y evidencia en `.oficina/artifacts/<card>/evidence/`.
5. **Trabajá en rama `release/v4.1`** y commits chicos (uno por card, Conventional Commits). Al final abrí un PR a main. NO publiques en npm, NO hagas push --force, NO borres tags/releases y NO cambies settings de GitHub sin pedirme confirmación explícita.
6. **Honestidad**: nada en README/docs puede afirmar algo que no esté probado. Si una integración no quedó probada en real, se marca 🧪 beta o 🔜, nunca ✅.
7. **TodoWrite**: mantené una todo list viva sincronizada con las cards y actualizala al cerrar cada una.

## HERRAMIENTAS QUE TENÉS QUE USAR

### Oficina
- `oficina_plan`, `oficina_dispatch`, `oficina_assign`, `oficina_gate`, `oficina_submit`, `oficina_review`, `oficina_evidence`, `oficina_next`, `oficina_bus`, `oficina_escalate`, `oficina_status`

### Agency Agents (OBLIGATORIO)
Roles sugeridos por área (consultá `oficina_brief` antes de planear):
- **Seguridad**: Security Engineer, Application Security Engineer
- **CI/CD**: DevOps Automator, Backend Architect
- **Packaging**: Senior Developer, MCP Builder
- **Documentación**: Technical Writer, UI Designer
- **Arquitectura**: Software Architect, Code Architect
- **Testing**: Test Automation Engineer, API Tester

### Skills (buscar con `npx skills find`)
- Antes de T-07 (MCP): `npx skills find mcp`
- Antes de T-08 (instalador): `npx skills find claude code plugin`, `npx skills find npm packaging`
- Antes de T-12 (README): `npx skills find readme`, `npx skills find beautiful readme`
- Antes de T-13 (assets): `npx skills find image generation`, `npx skills find banner`
- Antes de T-04 (CI): `npx skills find github actions`, `npx skills find turborepo`

### Docs oficiales (leelas antes de escribir instaladores)
- Claude Code MCP: https://code.claude.com/docs/en/mcp-quickstart
- Claude Code plugins: https://code.claude.com/docs/en/plugins-reference
- Codex MCP (config.toml [mcp_servers]): https://www.tembo.io/blog/codex-cli-mcp y https://developers.openai.com/codex/mcp
- Gemini CLI config: https://geminicli.com/docs/reference/configuration/
- Gemini CLI extensions: https://google-gemini.github.io/gemini-cli/docs/extensions/
- Cursor MCP: https://docs.cursor.com/context/model-context-protocol
- MCP TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk

### Subagentes
- Dispatch con máximo 4 agentes en paralelo. Las cards sin dependencias entre sí van en paralelo; las que dependen (ej. instaladores dependen del servidor MCP) esperan.
- Cada subagente recibe: objetivo concreto, archivos que puede tocar, comandos de verificación y formato de entrega (diff + salida literal de los gates).

### Revisión independiente
- Cada tarea la revisa un subagente DISTINTO del que la implementó, que vuelve a correr los gates por su cuenta y busca atajos (stubs, TODOs, datos hardcodeados, tests desactivados, `as any`, `skip`). Si encuentra uno, la tarea vuelve a trabajo.

## PLAN DE EJECUCIÓN (creá estas cards con `oficina_plan`)

### FASE 0 — Preflight (secuencial)
**T-00 Preflight y línea base**
- Confirmar raíz de la oficina = repo. `git status` limpio, rama `release/v4.1` creada.
- Correr y guardar salida de: `npm ci`, `npx turbo run build`, `npm run typecheck`, `npm run lint`, `npm test`, `python scripts/repair_encoding.py --check`.
- Bajar el log de la última CI (`gh run view --log-failed` si gh está logueado) y listar cada error.
- **Acceptance:** archivo `evidence/baseline.md` con todas las salidas y lista de fallas.

### FASE 1 — Base sana (paralelizable)
**T-01 Codificación**
- `python scripts/repair_encoding.py README.es.md docs/ARCHITECTURE.md docs/QUE-ES.md skills/oficina/SKILL.md skills/oficina/reference/protocol.md skills/oficina/reference/mesh.md packages/ai-office-core/src/gates.ts packages/ai-office-core/src/factory.ts packages/ai-office-host-codex/test.ts`
- `src/v2.ts`: `git checkout 5a520ab -- src/v2.ts` y re-aplicar SOLO el cambio de imports `@ai-office/*` → `ai-office-*`.
- Revisar a mano SKILL.md línea ~214 y los "?" que reemplazan "→".
- Agregar `.gitattributes` (`* text=auto eol=lf`), `.editorconfig` (utf-8, lf) y un job de CI + script `npm run check:encoding` que falle con BOM, U+FFFD o mojibake (`ó í ® ┐¢ ó é \u00e2\u20ac`).
- **Acceptance:** `python scripts/repair_encoding.py --check` -> OK; `git grep` -> vacio.

**T-02 Deduplicar el core y limpiar restos v3**
- `packages/ai-office-core/src` tiene el motor DOS veces (`src/*.ts` y `src/core/*.ts`; `office.ts`, `officeFactory.ts` y `docsync.ts` divergen). Quedarse con UNA copia (la más nueva, revisando el diff de los 3 que divergen), actualizar imports y exports.
- Borrar de la raíz lo que no pertenece a ningún paquete (`src/v1.ts`, `src/v2.ts` → mover al paquete host-opencode si se usan; `dashboard/`, `agents/`, `commands/`, `skills/`, `traits/` → mover a `packages/ai-office-cli/assets/` o donde corresponda).
- Sacar `docs/api` (generado) de git y agregarlo a `.gitignore`. Quitar `"nul"` de `.gitignore`. Borrar `packages/ai-office-host-codex/test.ts` suelto.
- **Acceptance:** `knip` sin errores; build/typecheck verdes; `git ls-files docs/api | wc -l` = 0.

**T-03 CI verde**
- Jobs por paquete: `npx turbo run build --filter=<pkg>...` (con los tres puntos) en vez de `npm run build` dentro del paquete.
- Corregir errores de tipos de `OpenCodeAdapter` ('def' is of type 'unknown').
- Corregir todos los `no-unused-vars` (`catalog.ts` fs/targetStems/targetRaw, `atomic.ts` caller, `cli.ts` readJson, cli index.ts existsSync/configDir).
- `knip.json` con entradas reales.
- Quitar `@typescript-eslint/parser` suelto (ya viene en `typescript-eslint`). Unificar TypeScript en una sola versión.
- Matriz Node 22 y 24; `actions/checkout@v5` y `setup-node@v5`.
- **Acceptance:** la CI del último commit de la rama en VERDE en GitHub (`gh run list --branch release/v4.1 --limit 1` → success). Guardar la salida.

### FASE 2 — Motor y CLI (depende de FASE 1)
**T-04 Fix de raíz del proyecto en el motor**
- Bug: `officeOf(ctx)` en `packages/ai-office-core/src/tools/index.ts` y el entry v1/v2 usan `ctx.directory`/`input.directory`; si OpenCode se abre en el home, `projectRoot=home`, el scope guard resuelve globs contra el home y los gates corren en el home.
- Crear `packages/ai-office-core/src/projectRoot.ts` con `resolveProjectRoot({explicit, worktree, directory})`: explícito → worktree git → ancestro con `.git`/`package.json`/`pyproject`/`go.mod`/`Cargo.toml`/`.oficina`; fail-closed si es el home o la raíz del disco con mensaje claro.
- `oficina_plan` acepta `root?`; se persiste `state.projectRoot`; `officeOf` usa el root persistido; los entries prefieren `input.worktree`.
- Gates y submit corren en `state.projectRoot` y muestran `cwd:` en su salida. Errores de scope muestran ruta absoluta y root.
- **Acceptance:** tests nuevos: (a) sesión en carpeta padre → root = repo o error claro, nunca home; (b) gate reporta `cwd == projectRoot`.

**T-05 Validación de plan + scope request + takeover + modo solo**
- `savePlan` rechaza cards cuyo `mayTouch` no matchea ningún archivo bajo root (salvo type creación) y gates con `npm run X` inexistente.
- Tool nueva `oficina_scope_request {cardId, agentId, add[], reason}`: aprobación del comandante, registrada en bus y `evidence/scope-changes.md`; archivos sensibles siguen inamovibles.
- `oficina_assign {takeover:true}`: si el owner no tiene sesión viva o su lease venció, reasigna owner+sesión, evento TAKEOVER, mantiene owner ≠ reviewer.
- Modo solo: si dispatch no logra spawnear, ofrece `--solo` (sesión principal = owner; reviewer = subagente único o el usuario). Gates y evidencia siguen obligatorios.
- Mensaje de error de submit con binding inválido debe decir exactamente cómo resolverlo.
- **Acceptance:** tests de regresión para cada caso.

**T-06 CLI unificada con los comandos de v3**
- La CLI v4 (`packages/ai-office-cli`) solo tiene install/run/detect/config y perdió init/status/resume/audit/reset/catalog/stats/demo/report (están en `packages/ai-office-core/src/cli.ts`). Integrarlos como subcomandos de `ai-office`, con alias de binario `oficina`.
- Comando nuevo `ai-office doctor`: muestra root detectada, git, versión plugin vs motor, scripts de gates existentes, escritura dentro/fuera de scope, spawn de subagente de prueba, agentes detectados y si su config contiene ai-office.
- **Acceptance:** tests/cli.test.ts del core pasan contra el binario nuevo; `ai-office --help` lista todo; `ai-office doctor` corre en el repo.

### FASE 3 — Integraciones reales (depende de T-04..T-06)
**T-07 Servidor MCP `ai-office-mcp`**
- Paquete nuevo `packages/ai-office-mcp` con bin `ai-office-mcp`, usando `@modelcontextprotocol/sdk` (stdio). Expone las tools del core (oficina_*) con JSON Schema, resolviendo root con `resolveProjectRoot` (cwd del cliente / env / argumento `--root`).
- Expone también prompts MCP (`office`, `office-lite`) y recursos (estado de la mesa, report card).
- **Acceptance:** test de integración que lanza el server por stdio, hace initialize + tools/list + una llamada `oficina_status`; se guarda la salida.

**T-08 Instalador real (reemplaza installPlatform)**
- Eliminar el "modo test" por prefijo de ruta (rompe macOS /Users). Solo existe `--dry-run`.
- Siempre MERGE de configs existentes, con backup `.bak` y opción `uninstall`.
- Destinos correctos (verificá contra las docs oficiales listadas arriba):
  - OpenCode: plugin + skill + agentes + comandos en `~/.config/opencode` (como v3), import del paquete correcto de plugin (`@opencode-ai/plugin`; resolver la ambigüedad con `@opencode/plugin` y dejar UNO).
  - Claude Code: preferir `claude mcp add ai-office --scope user -- npx -y ai-office-mcp` si el binario `claude` existe; si no, merge en `~/.claude.json` (mcpServers). Además generar un plugin en `integrations/claude-code` con `.claude-plugin/plugin.json`, `skills/`, `agents/`, `commands/` y `.mcp.json`, más un `marketplace.json` en la raíz del repo para `claude plugin marketplace add SOCRAMbt/AI-OFFICE`.
  - Codex: `codex mcp add ai-office -- npx -y ai-office-mcp` si existe el binario; si no, merge TOML en `~/.codex/config.toml` (`[mcp_servers.ai-office]` command/args). Agregar sección en `AGENTS.md` del proyecto.
  - Cursor: merge en `~/.cursor/mcp.json` (o `.cursor/mcp.json` con `--project`) en `mcpServers.ai-office`; agregar regla en `.cursor/rules`.
  - Gemini CLI: extensión en `integrations/gemini` con `gemini-extension.json` (mcpServers + contextFileName GEMINI.md); instalar con `gemini extensions install` o merge en `~/.gemini/settings.json`.
  - Grok: si no hay CLI de agente verificable, quitar el adaptador y el paquete del monorepo (deprecarlo en npm más tarde) y documentarlo.
- **Acceptance:** tests unitarios por plataforma con HOME temporal que verifican archivo, formato (JSON/TOML) y merge sin pisar claves existentes; `ai-office install --dry-run --platform=<x>` muestra el diff.

**T-09 Adaptadores**
- Los adaptadores con SDK de API (Anthropic `claude-3-5-sonnet-20241022`, `gpt-4`, `gemini-1.5-pro`, `grok-beta`, `codex --json-rpc`) NO son integraciones: pasan a modo opcional "headless" con modelos configurables sin defaults retirados, o se eliminan. La integración principal es el MCP.
- `CursorAdapter` sin extensión real: eliminar o marcar experimental.
- **Acceptance:** ningún modelo retirado hardcodeado (`git grep -n "claude-3-5-sonnet-20241022\|gpt-4'\|gemini-1.5\|grok-beta\|--json-rpc"` vacío).

**T-10 Prueba real por agente**
- En esta máquina, para cada agente instalado (opencode, claude, codex, cursor, gemini): instalar con `ai-office install --platform=<x>` sobre el repo `examples/hello-office`, correr una tarea chica ("agregar validación al todo"), y guardar en evidence: comando, salida, captura o log, y resultado del gate.
- Los agentes que no estén instalados se marcan "no probado" — NO ✅.
- **Acceptance:** `docs/COMPATIBILITY.md` con una tabla real (agente, versión, fecha, resultado, evidencia).

### FASE 4 — Empaquetado y publicación (depende de FASE 3)
**T-11 Paquetes npm correctos**
- Raíz: `"private": true`. Quitar bin/main rotos de la raíz y dependencias de la raíz que no se usan (`semgrep` ya fue; revisar `@opencode/plugin` vs `@opencode-ai/plugin`).
- Los 9 paquetes: `files ["dist","README.md","LICENSE"]`, copiar LICENSE a cada paquete, license "MIT", repository {type, url: git+https://github.com/SOCRAMbt/AI-OFFICE.git, directory}, homepage, bugs, keywords (ai-agents, mcp, claude-code, codex, cursor, gemini-cli, opencode, multi-agent, quality-gates), engines node >=22, author real.
- Cada dependencia importada declarada (la CLI importa ai-office-host-opencode en el plugin generado).
- `dashboard/` y assets dentro del paquete que los usa (el tablero busca `dashboard/server.mjs`).
- Test de humo de empaquetado en CI: `npm pack` de cada paquete → instalar los `.tgz` en una carpeta vacía → `node -e "import('ai-office-core')"` por cada paquete → `npx ai-office --help` → `npx ai-office-mcp` responde initialize.
- Versión 4.1.0 con changesets y CHANGELOG.md completo (4.0.0 roto, 4.1.0 qué arregla).
- **Acceptance:** salida del test de humo; `npm pack --dry-run --json` de cada paquete guardado en evidence.
- **PUBLICACIÓN:** preparar los comandos `npm publish` y `npm deprecate ai-office-*@4.0.0 "roto, usar 4.1.0"` y `npm deprecate oficina-opencode "movido a ai-office-cli"` pero NO ejecutarlos: pedirme confirmación.

### FASE 5 — Presentación (depende de T-10 y T-11)
**T-12 README profesional (inglés) + README.es.md (traducción fiel)**
- Primera pantalla: banner, gancho "Your AI agent says 'done'. AI-OFFICE makes it prove it.", 4 badges vivos (npm, CI real de SOCRAMbt/AI-OFFICE, license, stars), selector English | Español, GIF demo, una línea de instalación `npx ai-office-cli install`.
- Tabla "Supported agents" con estado REAL de T-10 (✅ solo lo probado).
- Instalación por agente en bloques `<details>` con los comandos verificados en T-08/T-10.
- "How it works" con diagrama Mermaid, tabla "Single agent vs AI-OFFICE" con costo de tokens honesto, tabla de comandos (incluyendo doctor/demo/report), FAQ, Contributing.
- Sin la tabla interna en español, sin "11 locations…", sin enlaces a SOCRAMbt/oficina-opencode, sin docs en español enlazados desde el README inglés salvo en "Español".
- Actualizar paquetes/*/README.md, AGENTS.md, docs/migration-guide.md (breaking changes reales), skills/proof-of-done/SKILL.md (comando de instalación real), docs/llms.txt, docs/QUE-ES.md (258 vs 80+ consistente).
- **Acceptance:** script que extrae todos los bloques bash del README y verifica que cada comando/paquete existe; `lychee` o equivalente sin links rotos.

**T-13 Assets y landing**
- Grabar GIF nuevo (VHS o asciinema+agg), 20–30 s, <5 MB: install → /office → gate rojo → fix → gate verde → dashboard.
- Banner con variantes claro/oscuro (`<picture>`), social preview PNG 1280×640 en `docs/assets`.
- `docs/index.html` (Pages) actualizado a v4.1, en inglés, con la misma tabla de compatibilidad.
- **Acceptance:** archivos en `docs/assets`, tamaño del GIF, captura de la landing.

**T-14 Benchmark honesto**
- Borrar `benchmarks/proof-of-value/results-simulation.*` y `results-real.json` (corrida fallida con rutas `C:\Users\Marcos`). Dejar solo el harness y, si se puede, UNA corrida real reproducible (con comando, modelo, fecha, costo) — o nada.
- **Acceptance:** `git grep -n "Math.random\|simulat" benchmarks` sin resultados en datos publicados.

### FASE 6 — Cierre
**T-15 Verificación final independiente (la hace un agente que NO tocó código)**
- Clonar la rama en una carpeta temporal limpia y repetir: `npm ci`, build, typecheck, lint, test, check:encoding, test de humo de paquetes, `ai-office doctor`.
- Revisar que cada ✅ de README/COMPATIBILITY tenga evidencia.
- Lista de cosas que necesitan acción mía en GitHub (te las dejo hechas como texto listo para copiar): descripción del repo, topics (ai-agents, mcp, claude-code, codex, cursor, gemini-cli, opencode, agent-skills, multi-agent, quality-gates), social preview, release v4.1.0 con notas, tag.
- Abrir PR `release/v4.1` → `main` con resumen por card y enlaces a evidencia.
- **Acceptance:** CI del PR en verde (salida de gh), informe final.

## DEFINICIÓN DE TERMINADO (todo debe cumplirse, con salida literal pegada en el informe final)

1. `gh run list --branch main --limit 1 --json conclusion,headSha` → "success"
2. `python scripts/repair_encoding.py --check` → OK
3. `npx turbo run build typecheck lint test` → todo verde
4. `npx knip` → sin errores
5. `git grep -nE "@ai-office/|SOCRAMbt/oficina-opencode|claude-3-5-sonnet-20241022|--json-rpc|grok-beta|Math.random"` en código/datos publicados → vacío
6. `git grep -n "TODO\|FIXME\|stub\|placeholder" packages/*/src` → vacío o justificado línea por línea
7. `npm view ai-office-cli version`, `npm view ai-office-mcp version`, `npm view ai-office-core version` → 4.1.0; `npm view ai-office-core@4.0.0 deprecated` → mensaje
8. Desde carpeta vacía: `npx -y ai-office-cli --help` y `npx -y ai-office-mcp` (initialize + tools/list con oficina_*) → funcionan
9. `ai-office doctor` en el repo → todo verde
10. `docs/COMPATIBILITY.md` con evidencia por agente; README consistente con esa tabla
11. Todas las imágenes del README existen; lychee 0 links rotos
12. `gh release view v4.1.0` existe; `gh repo view --json description,repositoryTopics` actualizado
13. Cada tarea con revisión de un subagente distinto y evidencia en `.release/evidence/`

Si algún punto no se cumple, NO escribas el informe final: volvé al bucle.

## INFORME FINAL (solo cuando la DoD esté 12/12)

En español:
1. Tabla de tareas: implementador, revisor, evidencia.
2. Salida literal de los 12 puntos de la DoD.
3. Bugs que encontraste en el camino y cómo los resolviste.
4. Lo único que quedó manual (idealmente nada; como mucho la social preview).

Empezá ahora por T-00. No me respondas con un plan para aprobar: ejecutalo. y no pares de trabajar hasta hacer todo esto.

## NOTA SOBRE EL USO DE /oficina

El plugin instalado (`oficina-opencode 3.4.3`) tiene bugs de raíz/binding, por eso el orquestador son subagentes nativos. Cuando T-05 (motor) esté hecho y publicado, instalá la versión nueva y usá `/oficina` para la verificación final (T-16) como prueba real del producto. Usá el catálogo agency-agents (`oficina_brief` o el repo de agency-agents) para elegir los roles de los subagentes y pasales el prompt de rol.

---

## PASO 0 — ¿Plugin o fallback?

**[plugin]** Si tenés las tools `oficina_*` disponibles, usá el **motor duro**. Es lo que hace que los invariantes dejen de ser sugerencias: el guard de scope rechaza escrituras fuera del scope, el gate corre comandos de verdad, y una card no se cierra sin evidencia.

Comprobá si existe `oficina_plan`. Si existe:
1. `oficina_plan` con el objetivo descompuesto en cards.
2. `oficina_dispatch` → arma el equipo.
3. `oficina_mesa` (view) → mirá quién trabaja en qué.
4. Corré el ciclo con las tools: `oficina_assign` → trabajo → `oficina_submit` → `oficina_review` → `oficina_evidence` → `oficina_gate`.
5. `oficina_stop` si la corrida se descontrola.

## ARRANCÁ ASÍ — sin preguntar permiso

1. Leé `reference/protocol.md` y `reference/roles.md` de la skill `oficina`.
2. Resolvé PROJECT_ROOT siguiendo el Paso 0 del protocolo.
3. Descomponé el objetivo en cards con acceptance criteria verificables y gate explícito.
4. Delegá por la tabla de enrutado de `reference/roles.md`.
5. Corré el ciclo: TRABAJO → AUTO-REVIEW → GATES + EVIDENCIA → DONE.
6. Checkpoint al usuario cada 3 cards — informá y seguí, no pidás permiso.
7. Escalá solo con el formato de 2-3 opciones concretas + recomendación.

## LO QUE ESTA OFICINA GARANTIZA

- Ninguna card se marca DONE sin `gates.md` en PASS
- **[plugin]** Ninguna card se marca DONE sin evidencia para cada criterio de aceptación obligatorio
- Ningún trabajo se auto-aprueba
- Nada se pierde: todo está en `.oficina/artifacts/`
- El objetivo se trabaja hasta cumplirlo o hasta un bloqueo real

**Arrancá ya. Reportá el plan de cards en 5-8 líneas y seguí con la primera.**