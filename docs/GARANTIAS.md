# Garantías

Qué promete AI-OFFICE, **qué mecanismo lo hace cumplir** y **dónde termina
la garantía**.

La regla de este documento: si algo no se puede verificar con un test o con
un mecanismo de código, no se promete. Un README que vende más de lo que el
código hace es peor que un README modesto: hace que el usuario confíe en
una protección que no existe.

---

## 1. El scope es una restricción

### Qué se garantiza

| Vector de escape | Cómo se frena | Test |
|---|---|---|
| `..` en la ruta | Se resuelve a absoluta y se verifica la contención | `sandbox.test.ts` |
| Path absoluto fuera del proyecto | Ídem | `sandbox.test.ts` |
| Symlink que apunta afuera | Se resuelve el symlink y **se revalida** la contención | `sandbox.test.ts` |
| Symlink roto | Se deniega (no se sabe a dónde apunta) | `sandbox.test.ts` |
| `mayTouch: ["**"]` como comodín | `**` significa "el proyecto", nunca "el filesystem" | `sandbox.test.ts` |
| Path sensível (`.env`, `.npmrc`, `.git/**`, claves) | Nunca escribible, pase lo que pase el scope | `sandbox.test.ts` |
| Diff multi-archivo | Se chequean **todos** los archivos del diff | `scopeGuard.test.ts` |
| Tool de shell escribiendo afuera | El comando se analiza antes de ejecutarse | `sandbox.test.ts` |
| Subagente delegado | Hereda el scope por la cadena de padres de sesión | `scopeGuard.test.ts` |
| Path con byte NUL | Se rechaza | `sandbox.test.ts` |

### Las tres capas

1. **`tool.execute.before`** — el guard propio. Cubre toda tool que el motor
   reporte, incluidas las de shell.
2. **`permission.ask`** — el framework. Deniega a nivel del motor.
3. **`tool.execute.after`** — el tripwire. Detecta lo que se coló.

### Lo que NO se garantiza

- **Un shell con interpreter embebido puede escribir fuera.** `python -c`,
  `node -e`, heredocs y `eval` esconden paths que ningún análisis previo
  puede extraer con certeza. Cuando el comando no se puede interpretar, se
  deja pasar y **el tripwire lo detecta después**.
- **El tripwire no revierte.** Detecta y reporta; no deshace. Y vigila el
  proyecto, no el filesystem entero.
- **Una escritura fuera del proyecto ya formada no se revierte.** El
  contención previene; no limpia.

---

## 2. Las invariantes se evalúan donde corresponde

Ocho invariantes duros, en código, no en el prompt:

| Invariante | Dónde se evalúa |
|---|---|
| `reviewer-neq-owner` | Toda revisión |
| `gate-required-before-done` | Al cerrar la card |
| `evidence-required-before-done` | Al cerrar la card |
| `max-review-rejections` | Al revisar |
| `max-help-chain-hops` | Al enrutar ayuda |
| `max-cards` | Al planear |
| `max-agent-calls` | Al reclamar |
| `max-spawns-total` | Al arrancar un subagente |

> **Bug corregido en esta versión**: `closeCard` evaluaba los invariantes
> con la card en `review`, no en `done`. Como los dos invariantes de cierre
> solo tienen sentido en `done`, **nunca disparaban**. Ahora se validan
> contra el estado al que la card llegaría.

El `evidence-required-before-done` es **fail-closed**: si la evidencia no se
evaluó, la card no se cierra. "No lo sé" no es "sí".

---

## 3. El cierre exige evidencia, no solo checks verdes

Pirámide de verificación:

| Nivel | Qué es | Cómo se comprueba |
|---|---|---|
| 1 — Estático | Tipos, lint, secretos, dependencias | Los gates técnicos |
| 2 — Comportamiento | Unitarias, integración, regresión | El gate `test` + evidencia de artefacto |
| 3 — Requisitos | Cada criterio de aceptación con su evidencia | El grafo de evidencia |
| 4 — Auditoría | Revisión independiente, riesgos | Evidencia de auditoría (revisor ≠ owner) |

Una card se cierra solo si **los gates pasan Y cada requisito obligatorio
tiene evidencia suficiente**.

### El grafo requisito → evidencia

Cada criterio de aceptación es un requisito. Cada evidencia (artefacto,
test, gate, inspección, auditoría) se vincula a un requisito con un nivel.
El grafo responde: *¿qué falta para poder cerrar?*

```
T-00 · Implementar login
  [✓] endpoint de login                          nivel 2  artefacto
  [ ] sin errores de validación                  nivel 0  — FALTA
  [!] cubierto por revisión independiente        nivel 4  auditoría
```

**Niveles y tope por tipo**: un artefacto llega a nivel 2; un test, a 2; un
gate, a 1 (o 2 si es la fase `test`); una inspección, a 3; una auditoría
(revisor ≠ owner), a 4. `evidenceFromAudit` **lanza** si owner y reviewer
son el mismo: una auto-revisión con cara de auditoría es peor que no tener
auditoría.

---

## 4. La concurrencia se sostiene

| Garantía | Mecanismo | Test |
|---|---|---|
| Un lease por task | Ciclo leer-evaluar-escribir bajo un lock de directorio | `concurrency.test.ts` |
| Seq único por canal | Asignación y escritura bajo el lock del canal | `concurrency.test.ts` |
| Idempotencia real | Check y escritura bajo el mismo lock | `concurrency.test.ts` |
| Un id nunca escapa del directorio | `safeId` + `safeJoin` | `ids`, `concurrency.test.ts` |
| Un JSON a medio escribir no se lee | `writeAtomic` (tmp + rename) | — |
| Un JSON vacío no se pone en cuarentena | `readJson` distingue "en curso" de "corrupto" | — |

### El bug de Windows

`fs.mkdir` sobre un directorio que otro proceso está borrando da **EPERM**,
no `EEXIST`. Sin manejar ese caso, dos emisores concurrentes se rompían en
Windows. Está cubierto y hay un test de carrera de 40 rondas.

---

## 5. Una caída no destruye la corrida

`reconcile()` compara **estado vs artefactos vs filesystem** y reporta:

| Situación | Qué hace |
|---|---|
| Card en `review` sin `handoff.md` | El agente murió entregando. Se avisa. |
| Card en `done` sin `gates.md` | Se cerró sin gate. **Crítico.** |
| Card en progreso sin owner | Nadie la va a terminar. **Crítico.** |
| Lease de una card que no existe | Se libera. |
| Lease de una card terminada | Se libera. |
| Agente `working` sobre una card `done` | Se libera el agente. |
| Artefacto de una card inexistente | Se reporta. |
| Card bloqueada por dependencia irresoluble | Se reporta. |

**Lo que no hace**: completar cards, inventar evidencia ni "arreglar" el
estado. Un sistema que se auto-repara inventando evidencia es peor que uno
que dice "esto está roto".

---

## 6. El costo se controla

- El costo real viene del motor (`AssistantMessage.cost`), no se estima.
- Se contabiliza por card, por agente y por fase (implementación, review,
  reparación).
- Presupuestos por corrida, por card y por fase.
- Estimación previa a una corrida grande.
- Detección de trabajo redundante (releer el mismo contexto, repetir el
  mismo comando).
- Freno de emergencia: `oficina_stop` detiene la corrida; el
  auto-continuación y el despacho se negan mientras esté detenida.

---

## 7. Lo que NO se promete

- **No es un sandbox.** Un plugin de OpenCode no puede contener el
  filesystem entero. El guard es una política de aplicación, y su límite
  está en la sección 1.
- **No garantiza que el objetivo del usuario se cumpla.** Garantiza que
  **cada criterio de aceptación declarado** tenga evidencia. Si el criterio
  estaba mal escrito, la evidencia lo va a reflejar.
- **No mide la calidad de la evidencia.** Un `handoff.md` que dice "listo"
  es evidencia de nivel 2. Que sea verdad o no depende de la revisión.
- **No reemplaza al reviewer.** El invariante `reviewer-neq-owner` impide
  que el owner se apruebe a sí mismo, pero no evalúa el juicio de quien
  revisa.
- **El benchmark mide selección, no resultado.** Dice que el sistema elige
  bien al rol. No dice que el agente haga bien el trabajo.

---

## Cómo se verifica todo esto

```bash
npm test              # 410 tests: adversariales, de carrera y de recuperación
npm run typecheck     # strict + noUncheckedIndexedAccess
npm run coverage      # cobertura por línea
npm run docs:check    # la documentación coincide con el código
npm run bench:selection  # el matcher le gana a las alternativas simples
npm run diagnose <dir>   # radiografia de una corrida: cards, roles, gates, evidencia
```
