# Compatibilidad

Qué versiones de OpenCode y del API de plugin soporta AI-OFFICE, y **qué se
verificó de cada una**.

La regla de este proyecto: lo que no está probado, no está soportado. Un
número de versión escrito a mano sin prueba de por medio es una promesa que
nadie verificó.

---

## Versiones

| Componente | Versión | Cómo se verificó |
|---|---|---|
| `@opencode-ai/plugin` | `1.15.11` | Compilación con `strict` + `noUncheckedIndexedAccess` contra los tipos reales del paquete. Un hook que no exista en el tipo **no compila**. |
| Node.js | `>=20` | CI corre la matriz `[20, 22]` en `ubuntu-latest` y `windows-latest`. |
| TypeScript | `>=5.6` | `tsc --noEmit` en modo `strict`. |

La API de plugin es la que manda: el plugin importa sus tipos, así que
**la compatibilidad se verifica en tiempo de compilación**, no por
inspección visual.

## Hooks que usa el plugin

| Hook | Para qué | Si el host no lo soporta |
|---|---|---|
| `event` (`session.idle`) | Auto-reanudación de la corrida | La corrida sigue, pero no se reanuda sola. |
| `event` (`message.updated`) | Contabilidad de costo | No hay registro de costo. La oficina sigue funcionando. |
| `tool.execute.before` | Guard de scope | **Sin protección**: el scope pasa a ser una instrucción, no una restricción. |
| `tool.execute.after` | Tripwire | No hay detección de escrituras coladas. |
| `permission.ask` | Segunda capa de enforcement | Queda solo la primera capa. |
| `experimental.chat.system.transform` | El estado viaja con cada llamada | El agente tiene que preguntar el estado. |
| `experimental.session.compacting` | El estado sobrevive a la compactación | La compactación pierde el contexto de la oficina. |
| `experimental.compaction.autocontinue` | Freno de emergencia | El freno frena el trabajo, pero la auto-continuación post-compactación sigue. |

## Mínimo verificable

La parte del plugin que **no degrada bien** es el guard de scope. Por eso
el proyecto declara un mínimo:

- **`@opencode-ai/plugin` >= 1.15.11**: a partir de esta versión existen
  `tool.execute.before`, `tool.execute.after` y `permission.ask` con las
  firmas que usa el plugin.

Si se instala con una versión anterior, el typecheck falla en la
instalación del consumidor y eso es intencional: es mejor un error de
compilación que una instalación que parece protegida y no lo está.

## Pruebas de integración por versión

El CI corre la matriz completa:

```
os:   [ubuntu-latest, windows-latest]
node: [20, 22]
```

En cada combinación se corre:

1. `npm run typecheck` — la API de plugin compila.
2. `npm run test` — la suite completa (los tests del plugin usan un host
   simulado con la misma forma que el real).
3. `npm run build` — el `dist/` se genera.
4. `npm pack --dry-run` — el paquete se puede armar.

Y en un job aparte, el smoke del CLI sobre el `dist/` real.

## OpenCode

| Versión de OpenCode | Soporte |
|---|---|
| La que trae el host actual | Sí. Es la que se prueba en desarrollo. |
| Versiones anteriores | No declaradas. El plugin usa `session.prompt` con partes `subtask`, `session.promptAsync`, `session.get` y `client.app.log`. |

El plugin **no fija** una versión de OpenCode: se instala como plugin y usa
el API que el host expone. Lo que sí fija es la versión del **API de
plugin**, que es lo que usa directamente.

## Requisitos del usuario, no del plugin

| Requisito | Por qué |
|---|---|
| Node >= 20 | `fs.promises`, `structuredClone`, ESM estable. |
| Un repo de `agency-agents` (opcional) | Sin él, la fábrica de roles funciona igual, pero los agentes salen de la plantilla genérica en vez del catálogo curado. |
| npm CLI >= 11.15 (opcional) | Solo para `npm stage publish`, el flujo de publicación por etapas de npm. La oficina no lo usa: publica directo. |

---

## Cómo se mantiene esta tabla

Las cifras de versiones salen del `package.json` real y se verifican en el
CI. El bloque de hechos de `README.md` y `docs/QUE-ES.md` se genera con
`npm run docs:sync` y el CI **falla** si se desincroniza:

```bash
npm run docs:check   # sale con 1 si la doc no coincide con el código
```
