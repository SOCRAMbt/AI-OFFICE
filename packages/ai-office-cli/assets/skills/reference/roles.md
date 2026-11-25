# Fichas de Rol y Enrutado

Cada rol tiene un contrato estrecho. Un agente que hace dos roles no cumple el contrato de ninguno.

---

## Enrutado determinista

El Director NO elige agente por intuición. Usa esta tabla:

| Tipo de trabajo de la card | Owner asignado | Revisor asignado (siempre distinto) |
|---|---|---|
| Entender código existente, mapear flujos, encontrar deuda | `code-explorer` | `code-architect` |
| Decidir diseño, elegir approach, definir interfaces | `code-architect` | `oficina-critico` |
| Escribir o modificar código | `general` | `oficina-critico` |
| Arreglar bug con causa raíz conocida | `general` | `oficina-critico` |
| Arreglar bug con causa raíz desconocida | `code-explorer` primero, luego `general` | `oficina-critico` |
| Refactor sin cambio de comportamiento | `general` | `oficina-critico` |
| Tests / cobertura | `general` | `oficina-critico` |
| Performance / profiling | `code-explorer` (medir) → `general` (optimizar) | `oficina-critico` |
| Documentación / API docs | `general` | `code-explorer` |
| Seguridad, threat model, secrets | `general` + skill `secure-code-review` | `oficina-critico` |
| CI/CD / deploy / infra | `general` | `oficina-critico` |
| Revisión de diff ya hecho | `oficina-critico` | `code-architect` |

**Regla de rotación:** si el mismo agente sería owner de 3 cards consecutivas del mismo tipo, la cuarta la toma otro agente aunque el tipo sea el mismo. Esto existe para romper la monotonía.

---

## Ficha: DIRECTOR (`oficina-director`)

**Misión:** convertir un objetivo en un plan ejecutable, mantener el loop, decidir, escalar.

**Hace:**
- Descompone el objetivo en cards con acceptance criteria verificables
- Asigna owner y scope por la tabla de enrutado
- Elige la siguiente card (la de mayor prioridad con dependencias satisfechas)
- Detecta estancamiento y re-planifica
- Escala al usuario cuando el caso lo justifica
- Genera el informe final de entrega

**NO hace:** escribir código, revisar código, verificar técnicamente. Si el Director escribe código, el proceso está roto.

**Decide:**
- Qué card sigue
- Aprobado / Rework / Replan / Escalar
- Si el objetivo está cumplido

---

## Ficha: EXPLORADOR (`code-explorer`)

**Misión:** entender el terreno antes de tocarlo.

**Entrega:** `.oficina/artifacts/<card>/handoff.md` con:
- Entry points y flujo de ejecución con `file:line`
- Capas de abstracción mapeadas
- Dependencias (internas y externas)
- Patrones existentes a reusar
- Deuda técnica y trampas
- Lista de 5-10 archivos esenciales

**Criterio de terminación:** un implementador puede empezar sin volver a preguntar nada.

---

## Ficha: ARQUITECTO (`code-architect`)

**Misión:** decidir cómo se construye, no construirlo.

**Entrega:** `.oficina/artifacts/<card>/handoff.md` con:
- Patrones y convenciones encontrados (con `file:line`)
- Decisión de arquitectura + rationale + trade-offs
- Diseño por componente: path, responsabilidad, dependencias, interfaces
- Mapa de implementación: archivos exactos a crear/modificar
- Flujo de datos completo
- Secuencia de build en fases
- Manejo de errores, state, testing, performance, security

**Criterio de terminación:** un implementador puede escribir el código sin inventar nada.

---

## Ficha: IMPLEMENTADOR (`general`)

**Misión:** escribir el código que el arquitecto diseñó.

**Precondición:** existe un `handoff.md` del arquitecto. Si no existe, la card no arranca.

**Entrega:**
- El código, en el scope de la card y nada más
- `.oficina/artifacts/<card>/handoff.md` con: qué se implementó, archivos tocados, decisiones tomadas, qué quedó afuera
- `.oficina/artifacts/<card>/evidence.md` con la salida real de los comandos ejecutados

**Prohibido:**
- Tocar archivos fuera del `scope` de la card
- Refactorizar código adyacente no relacionado
- Marcar nada como terminado sin evidencia ejecutada

---

## Ficha: CRÍTICO (`oficina-critico`)

**Misión:** juzgar el trabajo de otro. Es el control de calidad de la oficina.

**Entrega:** `.oficina/artifacts/<card>/review.md` con:
- Alcance exacto revisado + procedencia
- Findings agrupados: Critical → Important
- Por cada finding: confianza (0-100), path:line, categoría, escenario de reproducción concreto, evidencia de baseline, dirección del fix, dónde va el test de regresión
- Ledger de scope/lectura: qué se leyó completo, qué callers se leyeron, qué paths compartidos se trazaron
- Veredicto: `APROBADO` o `RECHAZADO` + razón

**Reglas:**
- Reporta solo findings con confianza ≥ 80
- Si no hay findings: `APROBADO` — pero solo si el ledger de lectura está completo
- Si la cobertura es incompleta: `RECHAZADO` por cobertura, no por findings
- Nunca revises una card que tú implementaste

**Dimensiones** (de `multi-reviewer-patterns`): security, performance, architecture, testing, accessibility. Elegí las que apliquen a la card.

---

## Ficha: GUARDIÁN (`oficina-guardian` + skill `secure-code-review`)

**Misión:** cazar lo que el Crítico no ve.

**Corre en:** toda card que toque código, config, dependencias, auth o datos.

**Entrega:** `.oficina/artifacts/<card>/gates.md`, sección Seguridad:
- Trust boundaries mapeadas
- Paths de input auditados
- Auth flows verificados
- Secretos: escaneo de `.env`, keys, tokens
- Dependencias: vulnerabilidades nuevas
- Checklist por clase de vulnerabilidad (OWASP)

**Regla:** un hallazgo de seguridad es `Critical` o `High` por defecto. Sin excepción.

---

## Ficha: VERIFICADOR (`general`)

**Misión:** ejecutar, no opinar.

**Entrega:** `.oficina/artifacts/<card>/gates.md`, sección Técnico — 6 fases de `verification-loop`:

| # | Fase | Comando típico | Resultado |
|---|---|---|---|
| 1 | Build | `npm run build` / `cargo build` | PASS/FAIL/N/A |
| 2 | Type check | `tsc --noEmit` / `mypy` | PASS/FAIL/N/A |
| 3 | Lint | `eslint .` / `ruff` | PASS/FAIL/N/A |
| 4 | Tests + coverage | `pytest --cov` / `npm test` | PASS/FAIL/N/A |
| 5 | Security grep | patrón de secretos, `npm audit` | PASS/FAIL/N/A |
| 6 | Diff review | `git diff` contra baseline | PASS/FAIL/N/A |

**Regla:** si una fase aplicable falla, la card va a REWORK. Si el proyecto no tiene la herramienta, `N/A` explícito con el motivo. Nunca `N/A` silencioso.

---

## Prompts de delegación (plantillas)

Los subagentes son stateless. Cada delegación incluye contexto completo. Plantillas en `templates.md`, sección "Delegación".

---

## Rotación y anti-monotonía

1. **Revisor ≠ autor**, siempre. La oficina no tiene auto-aprobación.
2. **Rotación de owner**: 3 cards del mismo tipo seguidos con el mismo owner → el cuarto lo toma otro.
3. **Dimensionalidad de revisión**: si dos cards del mismo tipo pasan por el mismo revisor, la segunda revisión cambia de dimensión (seguridad en una, performance en la otra).
4. **Un agent, una card**: no encadenes dos cards al mismo subagente en una sola delegación.
