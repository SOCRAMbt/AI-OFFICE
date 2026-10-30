/**
 * Hoja de entorno: el contexto que un agente necesita para no tropezar con
 * su propio runtime.
 *
 * ## Por qué existe
 *
 * En la corrida de 2026-02, los agentes despachados quemaron turnos en
 * errores evitables:
 *
 * 1. `SyntaxError: Imports and exports aren't available` — usaron el tool
 *    `execute` (Code Mode) como si fuera Node normal: `import`, `export`,
 *    `require`. Ese runtime es un sandbox: solo hay `tools.*`, `fetch` y
 *    `search`.
 * 2. `El token '&&' no es un separador válido` — sintaxis bash en PowerShell
 *    (Windows): `&&`, `||`, `mkdir -p`, `ls /c/Users/...`. PowerShell viejo
 *    no parsea `&&`, y `/c/...` se interpreta como carpeta `C:\c\`.
 *
 * La causa raíz no es incompetencia del modelo: es que el prompt de despacho
 * no le dice **dónde está parado**. Esta hoja se inyecta en el prompt de cada
 * agente (y en su archivo materializado) para que la primera vez ya sepa:
 *
 * - Qué shell corre (PowerShell en Windows) y qué sintaxis NO usar.
 * - Qué reglas tiene el sandbox de Code Mode.
 * - Qué hacer cuando un comando falla por sintaxis: traducir, no repetir.
 */

/** Reglas de entorno, renderizadas como texto para el prompt del agente. */
export function renderEnvironmentSheet(): string {
  return [
    "# Tu entorno de ejecución (leelo antes de ejecutar NADA)",
    "",
    "Estas reglas no son sugerencias: si las violás, el comando falla y quemás",
    "un turno en un error que era gratis evitar.",
    "",
    "## Shell: PowerShell en Windows",
    "",
    "- Tus comandos de shell corren en **PowerShell**, no en bash.",
    "",
    "**NO uses (falla o hace algo distinto a lo que creés):**",
    "",
    "- `cmd1 && cmd2` y `cmd1 || cmd2` — PowerShell clásico no tiene estos",
    "  separadores. Usá comandos separados, o `if ($LASTEXITCODE ...)`.",
    "- `mkdir -p x/y` — `-p` no existe. `mkdir x/y` ya crea los padres.",
    "- `ls /c/Users/...` — el path `/c/...` se interpreta como carpeta `C:\\c\\`.",
    "  En Windows las rutas son `C:\\Users\\...` (o `/` adelante está bien,",
    "  pero `C:` siempre primero).",
    "- `grep`, `sed`, `awk`, `head`, `tail`, `wc` — no vienen con el sistema.",
    "  Usá `Select-String`, `Get-Content`, `Measure-Object`.",
    "- `2>&1` pegado a un comando nativo puede romper el stream. Si lo",
    "  necesitás, separalo del stderr real.",
    "",
    "**Preferí los tools dedicados antes que shell:** `read`, `glob`, `grep`,",
    "`edit`, `write` hacen lo mismo con menos errores. Shell solo para lo que",
    "un tool no puede: compilar, correr tests, instalar deps.",
    "",
    "## Code Mode (`execute`): es un sandbox, no Node",
    "",
    "- **NO hay `import`, `export` ni `require`.** `SyntaxError` garantizado.",
    "- Solo tenés: `fetch` (HTTP), `search` (catálogo) y `tools.<namespace>.",
    "  <tool>({...})` con paths y firmas **exactas** del catálogo. No inventés",
    "  nombres de tools ni los normalices: `tools.oficina_dispatch({...})` se",
    "  escribe así, con corchetes si el path lo pide.",
    "- No hay `setTimeout`/`sleep`. No los llames.",
    "- Si el catálogo no lista un tool, ese tool no existe en el sandbox.",
    "",
    "## Cuando un comando falle por sintaxis",
    "",
    "**NO reintentés lo mismo.** Un retry idéntico produce el error idéntico.",
    "El protocolo es:",
    "",
    "1. Leé el error: ¿es de sintaxis de shell o del sandbox?",
    "2. Traducí: bash → PowerShell nativo; Node → `tools.*`.",
    "3. Reintentá **una** vez con la sintaxis correcta.",
    "4. Si vuelve a fallar, anotalo en tu handoff y cambiá de vía",
    "   (otro tool, otro comando, o HELP por el bus).",
    "",
    "Un error de sintaxis no es una card terminada a medias: es un turno",
    "perdido. Traducí antes de repetir.",
  ].join("\n")
}
