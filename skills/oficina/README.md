# 🏢 OFICINA — Oficina de Agents

Un objetivo entra por la puerta. La oficina lo ejecuta, se auto-verifica, y entrega evidencia.

## Qué es

Un sistema de orquestación de agentes **nativo de OpenCode**. Combina:

- **agency-agents** → los especialistas (`code-explorer`, `code-architect`) y el patrón de subagentes
- **AgentTeams** → la disciplina de coordinación: cards con owner, scope, acceptance, gate, Kanban, merge gates
- **Skills nuevas** → `multi-reviewer-patterns` (dimensiones + dedup + severidad), `verification-loop` (6 fases), `deep-agents-orchestration` (subagentes stateless), `secure-code-review` (trust boundaries)

## El problema que resuelve

| Falla común | Mecanismo de OFICINA |
|---|---|
| Tenés que dar todas las instrucciones | El **Director** descompone solo |
| El agent "no cumple" | Cada card tiene **acceptance criteria** + **gate ejecutable** |
| Los subagentes se desaprovechan | Tabla de **enrutado determinista** rol→agente |
| Hay que repetir el contexto | **Ledger de contexto** en disco (`.oficina/context.md`) |
| No se coordinan entre sí | **Handoff por artefactos** — el disco es el bus de mensajes |
| Son monotonos | **Revisor distinto del autor** + rotación de owner y de dimensión |
| Nadie los orquesta | El **Director** corre el loop, detecta estancamiento, escala |

## Uso

```bash
# Desde la raíz de tu proyecto
/oficina Agregar autenticación JWT con refresh tokens
```

El comando carga la skill `oficina` y arranca el ciclo. No pide permiso: informa y sigue.

### Comandos de control (durante la corrida)

| Quiero | Digo |
|---|---|
| Ver el estado | `/oficina status` |
| Cambiar de rumbo | `/oficina cambiar a <nuevo objetivo>` |
| Pausar | `/oficina pausar` |
| Detener | `/oficina stop` |

## Los 7 roles

| Rol | Agente | Puede aprobar? |
|---|---|---|
| Director | `oficina-director` | No revisa técnico |
| Explorador | `code-explorer` | No |
| Arquitecto | `code-architect` | No |
| Implementador | `general` | No |
| **Crítico** | `oficina-critico` | Sí (revisión de card) |
| **Guardián** | `oficina-guardian` | Sí (gate seguridad) |
| **Verificador** | `oficina-verificador` | Sí (gate técnico) |

**Nadie se auto-aprueba.** El Crítico de una card es siempre distinto de su owner.

## El ciclo

```
OBJETIVO → PLAN (Director)
              ↓
         STANDUP (elegir card)
              ↓
         TRABAJO (owner → handoff.md + evidence.md)
              ↓
         AUTO-REVIEW (oficina-critico → review.md)
              ↓
         GATES (oficina-verificador + oficina-guardian → gates.md)
              ↓
     ┌────────┴────────┐
   DONE            REWORK → REPLAN → ESCALADA
```

## Garantías

1. **Ninguna card DONE sin `gates.md` en PASS** (técnico Y seguridad).
2. **Ningún trabajo se auto-aprueba.**
3. **Nada se pierde**: 35+ artefactos por corrida, todo en `.oficina/`.
4. **La oficina se audita a sí misma**: el Verificador marca en el diff review cualquier archivo tocado fuera de scope.
5. **Escala con opciones**, nunca con monólogo. 3 rechazos de la misma card = escalación.

## Estructura de una corrida

```
<proyecto>/.oficina/
├── board.md          # Kanban legible por humanos
├── state.json        # estado legible por máquinas (retoma tras reinicio)
├── context.md        # ledger de conocimiento acumulado
└── artifacts/
    └── T-00/
        ├── handoff.md    # qué hizo el owner
        ├── evidence.md   # salida real de los comandos
        ├── review.md     # veredicto del crítico
        ├── gates.md      # PASS/FAIL técnico y seguridad
        ├── decision.md   # decisión del director
        └── delegation.md # prompt de delegación (para relanzar)
```

## Requisitos

- OpenCode con `experimental.subagent_depth: 3` (ya configurado en `~/.config/opencode/opencode.json`) — sin esto los subagentes no pueden delegar.
- Correr `/oficina` **desde la raíz del proyecto**.

## Costos

Presupuesto por corrida: **20 cards, 40 invocaciones de subagente**. Una corrida típica de un bug acotado consume 5 cards / 22 agentes. Si se agota, la oficina entrega informe parcial honesto y pregunta.

## Archivos

| Ruta | Qué es |
|---|---|
| `~/.config/opencode/skills/oficina/SKILL.md` | La skill (protocolo) |
| `~/.config/opencode/skills/oficina/reference/roles.md` | Fichas de rol + tabla de enrutado |
| `~/.config/opencode/skills/oficina/reference/protocol.md` | Handoff, gates, escalamiento, checkpoints |
| `~/.config/opencode/skills/oficina/reference/templates.md` | Templates + prompts de delegación |
| `~/.config/opencode/agents/oficina-director.md` | El Director |
| `~/.config/opencode/agents/oficina-critico.md` | El Crítico |
| `~/.config/opencode/agents/oficina-guardian.md` | El Guardián (gate seguridad) |
| `~/.config/opencode/agents/oficina-verificador.md` | El Verificador (gate técnico) |
| `~/.config/opencode/commands/oficina.md` | El comando `/oficina` |
