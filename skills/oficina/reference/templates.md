# Templates de OFICINA

Todos los templates van en `.oficina/` del proyecto donde se está trabajando.

---

## `board.md`

```markdown
# 🏢 OFICINA — <objetivo>

**Creado:** <ISO>
**Estado:** EN CURSO | ENTREGADO | BLOQUEADO | ESCALADO
**Presupuesto:** <n>/20 cards, <n>/40 agents

## Tablero

### TODO
- [ ] **T-00** — <título>  · owner: <agente> · gate: <qué lo aprueba> · scope: <archivos>

### IN_PROGRESS
- [ ] **T-01** — <título>  · owner: <agente> · iter: <n>

### REVIEW
- [ ] **T-02** — <título>  · owner: <agente> · artifacts: <dir>

### DONE
- [x] **T-03** — <título>  · owner: <agente> · gates: ✅ · review: APROBADO

### BLOCKED
- [ ] **T-04** — <título>  · razón: <qué falta> · owner: <quién lo resuelve>

### ESCALATED
- [ ] **T-05** — <título>  · opciones: <A|B|C> · recomendación: <X>

## Dependencias
```
T-00 → T-01 → T-02
      T-01 → T-03
```

## Checkpoints
- [x] Checkpoint 1 (<n>/<total>) — <fecha> — <resumen>
```

---

## `state.json`

```json
{
  "objective": "<objetivo original del usuario>",
  "created": "<ISO>",
  "updated": "<ISO>",
  "status": "in_progress",
  "iteration": 0,
  "current_card": "T-01",
  "budget": {
    "max_cards": 20,
    "cards_used": 2,
    "max_agent_calls": 40,
    "agent_calls_used": 5
  },
  "cards": [
    {
      "id": "T-00",
      "title": "Mapear sistema de auth existente",
      "type": "exploration",
      "state": "done",
      "owner": "code-explorer",
      "reviewer": "code-architect",
      "scope": ["src/auth/**", "src/middleware/**"],
      "acceptance": [
        "Entry points con file:line mapeados",
        "Dependencias externas listadas",
        "Lista de archivos esenciales de 5-10"
      ],
      "gate": "handoff.md existe y lista entry points + archivos esenciales",
      "depends_on": [],
      "attempts": 1,
      "rejections": [],
      "artifacts": ".oficina/artifacts/T-00",
      "result": "APROBADO"
    }
  ],
  "escalations": [],
  "checkpoints": []
}
```

---

## `context.md`

```markdown
# Contexto de la corrida — <objetivo>

## Decisiones tomadas
- [T-00] <decisión> — <razón> (decidido por <rol>)

## Constraints descubiertos
- [T-00] <constraint>

## Piezas construidas
- [T-01] `<path>` — <qué es>

## Trampas encontradas
- [T-01] <trampa> — <por qué no tocarla>

## Temas abiertos
- <tema sin resolver>
```

---

## Delegación: prompts completos

Los subagentes son stateless. Cada delegación se arma con contexto completo.

### Explorador

```
Trabajás en el proyecto <path>. Objetivo de la corrida: <objetivo>.

TU CARD: <card-id> — <título>
SCOPE: <archivos/patrones a mirar>

Escribí en `.oficina/artifacts/<card-id>/handoff.md`:

- Entry points con `file:line`
- Flujo de ejecución paso a paso
- Capas de abstracción (presentación → lógica → datos)
- Dependencias internas y externas
- Patrones y convenciones existentes a reusar
- Deuda técnica y trampas
- Lista de 5-10 archivos esenciales (o explicación de por qué hay menos)

Criterio de terminación: un implementador puede arrancar sin volver a preguntar nada.
No escribas código. No modifiques archivos del proyecto.
```

### Arquitecto

```
Trabajás en el proyecto <path>. Objetivo de la corrida: <objetivo>.

CONTEXTO DE TAREAS PREVIAS (leelo antes):
- <path a artifacts/*/handoff.md>

TU CARD: <card-id> — <título>

Escribí en `.oficina/artifacts/<card-id>/handoff.md`:

- Patrones y convenciones encontrados (con `file:line`)
- Decisión de arquitectura + rationale + trade-offs (una sola opción, no un menú)
- Diseño por componente: path, responsabilidad, dependencias, interfaces
- Mapa de implementación: archivos exactos a crear/modificar
- Flujo de datos completo
- Secuencia de build en fases
- Manejo de errores, state, testing, performance, security

Criterio de terminación: un implementador puede escribir el código sin inventar nada.
No escribas código de implementación.
```

### Implementador

```
Trabajás en el proyecto <path>. Objetivo de la corrida: <objetivo>.

DISEÑO (leelo primero, es tu spec):
`<path a artifacts/<card-id>/handoff.md>`

CONTEXTO RELEVANTE:
<paths a artifacts previos>

TU CARD: <card-id> — <título>
SCOPE ESTRICTO: <archivos que podés tocar>

Implementá siguiendo el diseño. Escribí:
- El código en el scope y nada más
- `.oficina/artifacts/<card-id>/handoff.md`: qué hiciste, archivos tocados, decisiones, qué quedó afuera
- `.oficina/artifacts/<card-id>/evidence.md`: salida REAL de los comandos que corriste (tests, build, lint), pegada literal

Reglas: no toques archivos fuera del scope, no refactorices código adyacente, no digas que algo está listo sin la salida real del comando.
```

### Crítico

```
Revisás trabajo ajeno. Objetivo de la corrida: <objetivo>.

CARD: <card-id> — <título>
AUTOR (NO lo revises si sos vos): <owner>
ARCHIVOS EN SCOPE: <lista>

Leé:
- `.oficina/artifacts/<card-id>/handoff.md`
- `.oficina/artifacts/<card-id>/evidence.md`
- Los archivos del código en scope

Escribí `.oficina/artifacts/<card-id>/review.md`:

- Ledger de scope/lectura: qué leíste completo, qué callers leíste, qué paths compartidos trazaste
- Findings agrupados Critical → Important, cada uno con: confianza 0-100, path:line, categoría, descripción, escenario de reproducción concreto, evidencia de baseline, dirección del fix, dónde va el test de regresión
- Solo findings con confianza ≥ 80. Los de abajo, descartalos con la razón anotada.
- Dimensiones revisadas: security, performance, architecture, testing, accessibility — decí cuáles y por qué

VEREDICTO: APROBADO o RECHAZADO.
Si no hay findings pero el ledger está incompleto → RECHAZADO por cobertura.
```

### Verificador (gate técnico)

```
Verificás una card. Objetivo de la corrida: <objetivo>.

CARD: <card-id> — <título>
ARCHIVOS: <scope>

Corré estas fases y pegá la salida real de cada una en `.oficina/artifacts/<card-id>/gates.md`, sección Técnico:

1. Build        → <comando o N/A + motivo>
2. Type check   → <comando o N/A + motivo>
3. Lint         → <comando o N/A + motivo>
4. Tests+coverage → <comando o N/A + motivo>
5. Security grep → <comando o N/A + motivo>
6. Diff review  → <comando o N/A + motivo>

Detectá el tooling del proyecto vos (package.json, pyproject.toml, Makefile, etc.) si no te lo doy.

Tabla: | # | Fase | Comando | Resultado | Detalle |
"Gate técnico: PASS" o "Gate técnico: FAIL".
Nunca pongas PASS en una fase que no corriste. Si no existe la herramienta: N/A con motivo explícito.
```

### Guardián (gate seguridad)

```
Auditás seguridad de una card. Objetivo de la corrida: <objetivo>.

CARD: <card-id> — <título>
ARCHIVOS: <scope>

Usá el checklist de la skill `secure-code-review`. Escribí `.oficina/artifacts/<card-id>/gates.md`, sección Seguridad:

- Trust boundaries mapeadas
- Paths de input auditados (con archivo:línea)
- Auth flows verificados
- Escaneo de secretos (env, keys, tokens) — incluí el comando que usaste
- Dependencias: vulns nuevas
- Findings por clase de vulnerabilidad (OWASP)

Regla: un hallazgo de seguridad explotable por usuarios externos es Critical o High. Sin excepción.
"Gate seguridad: PASS" o "Gate seguridad: FAIL".
```

---

## `artifacts/<card-id>/` — estructura

```
.oficina/
├── board.md
├── state.json
├── context.md
└── artifacts/
    ├── T-00/
    │   ├── handoff.md
    │   ├── evidence.md
    │   ├── review.md
    │   ├── gates.md
    │   └── decision.md
    └── T-01/
        └── ...
```

Crear la carpeta de la card antes de delegar.
