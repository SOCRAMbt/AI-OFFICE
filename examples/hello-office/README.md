# hello-office

Un proyecto de juguete para probar AI-OFFICE en 5 minutos: una lista de tareas de consola, sin dependencias.

| Archivo | Qué hace |
|---|---|
| `todo.js` | La lógica: `load`, `save`, `add`, `format`. |
| `cli.js` | El comando: `node cli.js add "texto"` y `node cli.js list`. |
| `todo.test.js` | 4 tests con `node:test` (viene con Node, no hay nada que instalar). |

Hoy el CLI solo sabe **agregar** y **listar**. El objetivo de la oficina es completarlo.

## Requisitos

- Node 22 o más nuevo.
- AI-OFFICE instalado en OpenCode, con `subagent_depth: 3` (ver [Instalación](../../README.md#instalacion) en el README principal).

## Paso a paso

**1. Copiá el ejemplo fuera de este repo** (la oficina escribe en `.oficina/` dentro del proyecto):

```bash
cp -r examples/hello-office ~/hello-office
cd ~/hello-office
```

**2. Comprobá que el proyecto anda antes de empezar:**

```bash
npm test
```

Tiene que terminar con `pass 4` y `fail 0`.

**3. (Opcional) Inicializá la oficina a mano.** `/oficina` lo hace solo, pero así ves el primer paso:

```bash
oficina init "Agregar el comando done y list --pending"
oficina status
```

Salida esperada (el `Run ID` y las rutas cambian en tu máquina):

```text
✅ Oficina inicializada

  Directorio: /home/vos/hello-office/.oficina
  Proyecto:   /home/vos/hello-office
  Run ID:     run-1a2b3c4d

🏢 OFICINA — Agregar el comando done y list --pending

Estado:    planning
Progreso:  0/0 cards DONE
Cards:     0 total
```

**4. Abrí OpenCode en `~/hello-office`** y escribí el objetivo:

```text
/oficina Agregar el comando `done <id>`, que marca una tarea como hecha, y la opción `list --pending`, que muestra solo las pendientes. Con tests en todo.test.js.
```

Qué pasa: el Comandante descompone el objetivo en cards, el dispatch arma el equipo y los agentes trabajan en paralelo. La salida de los agentes cambia en cada corrida, por eso no se copia acá.

**5. Mirá cómo va**, en otra terminal, desde `~/hello-office`:

```bash
oficina status    # cards pendientes y agentes
oficina board     # tablero Kanban
```

## Cómo sabés que terminó bien

La corrida termina cuando las gates lo dicen, no cuando el modelo dice «listo». Para este ejemplo:

- `oficina status` muestra todas las cards en DONE (`Progreso: N/N cards DONE`).
- `npm test` pasa, con más de 4 tests (los nuevos cubren `done` y `list --pending`).
- Esto funciona a mano:

  ```bash
  node cli.js add "comprar pan"
  node cli.js done 1
  node cli.js list --pending   # no muestra la tarea 1
  node cli.js list             # la muestra como "1. [x] comprar pan"
  ```

`cli.js` guarda las tareas en `todos.json`, en la carpeta donde lo corrés. Borralo cuando termines de probar.
