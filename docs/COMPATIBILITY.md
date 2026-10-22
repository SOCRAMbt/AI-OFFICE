# Compatibilidad

Qué versiones de OpenCode y del API de plugin soporta AI-OFFICE, y **qué se
verificó de cada una**.

La regla de este proyecto: lo que no está probado, no está soportado. Un
número de versión escrito a mano sin prueba de por medio es una promesa que
nadie verificó.

---

## ⚠️ El cambio de API de plugins es el punto que hay que entender

**OpenCode v1 y v2 tienen APIs de plugins incompatibles.** No es que cambiara
una firma: cambió la forma.

| | OpenCode v1 | OpenCode v2 |
|---|---|---|
| Export default | una **función** que devuelve hooks | un **objeto** `{ id, setup(ctx) }` |
| Registrar tools | `hooks.tool = { nombre: tool({...}) }` | `ctx.tool.transform(editor => editor.add({...}))` |
| Forma de los args | schema **zod** | **JSON Schema** plano |
| Interceptar tools | hook `tool.execute.before` | `ctx.tool.hook("execute.before")` |
| Denegar una acción | hook `permission.ask` | `ctx.permission.hook("evaluate")` → `effect = "deny"` |
| Inyectar al system prompt | `experimental.chat.system.transform` | `ctx.session.hook("context")` |
| Eventos | hook `event` | `ctx.event.subscribe({ signal })` |
| Auto-continuación | `client.session.promptAsync` | `ctx.session.synthetic({...})` |

Un plugin v1 bajo v2 falla con:

```
PluginModule.LoadError: Plugin must export a default definition with an id
and an effect or setup function.
```

Y al revés, un plugin v2 bajo v1 no carga.

### Cómo lo resuelve AI-OFFICE

El **motor** (`core/`, `tools/`) no depende de ninguna de las dos APIs:

- Las tools se definen en una **forma neutra** (`{ description, args, execute }`).
- `src/v2.ts` las traduce a v2 (zod → JSON Schema con `z.toJSONSchema`).
- `src/v1.ts` las traduce a v1 (el helper `tool()` del plugin v1).

El texto del system prompt también es compartido: vive en
`core/systemPrompt.ts` y cada entry lo inyecta donde su API lo permite. Si
viviera dentro de cada hook, las dos copias se desincronizarían.

| Entry | Versión de OpenCode |
|---|---|
| `oficina-opencode` (`.`) | **v2** — la principal |
| `oficina-opencode/v1` | v1 (legacy) |

## Versiones

| Componente | Versión | Cómo se verificó |
|---|---|---|
| `@opencode/plugin` | `^2.1.2` | Compilación con `strict` + `noUncheckedIndexedAccess` contra los tipos reales. Un hook que no exista en el tipo **no compila**. |
| `@opencode-ai/plugin` | `^1.15.11` *(peer opcional)* | Solo lo necesita el entry `./v1`. |
| OpenCode CLI | `2.1.1` | Probado con el servicio real: el plugin carga, registra las 16 tools y responde. |
| Node.js | `>=20` | CI corre la matriz `[20, 22]` en `ubuntu-latest` y `windows-latest`. |
| TypeScript | `>=5.8` | `tsc --noEmit` en modo `strict`. |

## Hooks que usa el plugin v2

| Hook | Para qué | Si el host no lo soporta |
|---|---|---|
| `ctx.tool.transform` | Registra las 16 tools | **Sin tools, la oficina no existe.** |
| `ctx.tool.hook("execute.before")` | Guard de scope + armado del tripwire | El scope pasa a ser una instrucción. |
| `ctx.tool.hook("execute.after")` | Tripwire: detecta escrituras coladas | No hay detección. |
| `ctx.permission.hook("evaluate")` | Segunda capa: `deny` real | Queda solo el guard propio. |
| `ctx.session.hook("context")` | El estado viaja con cada llamada | El agente repregunta lo que ya sabe. |
| `ctx.session.hook("compaction")` | El estado sobrevive a la compactación | La compactación pierde el contexto. |
| `ctx.event.subscribe` | Auto-continuación (`session.idle`) y costo (`session.usage.recorded`) | Sin auto-continuación ni contabilidad de costo. |

## Pruebas de integración por versión

El CI corre la matriz completa:

```
os:   [ubuntu-latest, windows-latest]
node: [20, 22]
```

En cada combinación: `npm run typecheck`, `npm run test`, `npm run build`,
`npm pack --dry-run`. Y en un job aparte, el smoke del CLI sobre el `dist/`
real.

Los tests del plugin v2 (`tests/pluginV2.test.ts`) mockean el contexto de v2
y comprueban que las tools se registran con JSON Schema, que los hooks se
instalan y que las tools responden.

## OpenCode

| Versión de OpenCode | Soporte |
|---|---|
| **v2.x** (>= 2.1) | **Sí.** Es la que se prueba en desarrollo y en el servicio real. |
| v1 (>= 1.18.29) | Legacy, via `oficina-opencode/v1`. Los hooks v1 funcionan; los de v2 no. |
| v1 anteriores a 1.18.29 | No. La forma de objeto no estaba soportada. |

## Requisitos del usuario, no del plugin

| Requisito | Por qué |
|---|---|
| Node >= 20 | `fs.promises`, `structuredClone`, ESM estable. |
| Un repo de `agency-agents` (opcional) | Sin él, la fábrica de roles funciona igual, pero los agentes salen de la plantilla genérica en vez del catálogo curado. |
| npm CLI >= 11.15 (opcional) | Solo para `npm stage publish`, el flujo de publicación por etapas de npm. La oficina no lo usa: publica directo. |

---

## Un detalle que obliga a resolver el paquete en runtime

El loader de plugins de OpenCode v2 **no resuelve bare specifiers** desde
`~/.config/opencode/plugins/`. Un `export { default } from "oficina-opencode"`
falla con:

```
Cannot find package 'oficina-opencode' imported from
C:\Users\...\ .config\opencode\plugins\oficina.js
```

Node sí lo resolvería (subiendo por los `node_modules`). Bun, que es el
runtime de OpenCode, no.

Por eso `oficina install` escribe un entry (`dist/pluginEntry.js`) que
**busca el paquete en runtime** — en el `node_modules` de la config, en la
cache de npm de OpenCode, o subiendo desde el propio archivo — y lo importa
por ruta absoluta. Se resuelve en runtime y no al instalar, así que
reinstalar el paquete en otro lugar no rompe el entry.

## Cómo se mantiene esta tabla

Las cifras de versiones salen del `package.json` real y se verifican en el
CI. El bloque de hechos de `README.md` y `docs/QUE-ES.md` se genera con
`npm run docs:sync` y el CI **falla** si se desincroniza:

```bash
npm run docs:check   # sale con 1 si la doc no coincide con el código
```
