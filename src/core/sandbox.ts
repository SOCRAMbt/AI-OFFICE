/**
 * Sandbox: resolución y validación de rutas.
 *
 * ## Por qué existe
 *
 * El guard de scope comparaba strings:
 *
 *     const relative = path.relative(projectRoot, absolute)
 *     if (!matchesScope(relative, mayTouch)) throw ...
 *
 * Eso tiene tres agujeros, y los tres son reales:
 *
 * 1. **Symlinks.** `src/link.ts` -> `../../etc/secrets.ts`. El path relativo
 *    es `src/link.ts`, que matchea `src/**`. El guard autoriza. La
 *    escritura ocurre afuera. Verificar el path **después** de resolver los
 *    symlinks es la diferencia entre "está en el scope" y "termina en el
 *    scope".
 *
 * 2. **`..` con `mayTouch: ["**"]`.** `**` matcheaba cualquier string,
 *    incluido `../../etc/passwd`. El `**` tiene que significar "todo el
 *    proyecto", nunca "todo el filesystem".
 *
 * 3. **Paths absolutos.** `/etc/passwd` o `C:\Windows\...` tienen un
 *    relativo que empieza en `..`, y con `**` pasaban.
 *
 * ## La regla
 *
 * Ninguna ruta se autoriza por comparación de strings. Se resuelve primero
 * (absoluta → normalizada → symlinks resueltos → realpath) y recién ahí se
 * decide. Y la decisión es **fail-closed**: ante cualquier duda, se deniega.
 *
 * ## Qué NO promete
 *
 * Un sandbox a nivel de aplicación no puede⬇️ contener un `bash` que el modelo
 * redacta con un interpreter embebido. Eso sí se cubre, pero con otra
 * técnica: se analiza el comando antes de ejecutarlo y se instalan
 * *tripwires* después. Ver `analyzeShellCommand` y el modulo de deteccion.
 */

import fs from "node:fs/promises"
import path from "node:path"

/* ────────────────────────────────────────────────────────────────────────────
 * Normalización única de paths (Windows 8.3-safe)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Normaliza una ruta resolviendo el ancestro existente más profundo con
 * `fs.realpath` y re-enganchando la cola de componentes inexistentes.
 * Sigue symlinks (para verificación física).
 *
 * Esta es la función de normalización para verificación FÍSICA.
 * Tanto el `projectRoot` como el `target` pasan por aquí para `insidePhysically`.
 *
 * En Windows, `fs.realpath` SÍ expande nombres largos para rutas existentes.
 * Para rutas inexistentes, caminamos hacia arriba hasta encontrar un ancestro
 * que exista, lo resolvemos, y re-enganchamos la cola.
 * Además, en Windows, expande aliases 8.3 (RUNNER~1 -> runneradmin) caminando
 * desde la raíz del disco hacia abajo.
 *
 * Fail-closed: si no podemos resolver el ancestro, lanzamos error.
 */
export async function normalizePath(target: string): Promise<string> {
  let current = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      const real = await fs.realpath(current)
      // Re-enganchamos la cola (componentes que no existían)
      const resolved = tail.length > 0 ? path.join(real, ...tail) : real
      // En Windows, expandir aliases 8.3 en el resultado
      return IS_WINDOWS ? await expand83AliasesFromRoot(resolved) : resolved
    } catch (err) {
      // Si es un error distinto de ENOENT, propagamos (fail-closed)
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err
      }
      const parent = path.dirname(current)
      if (parent === current) {
        // Llegamos a la raíz del sistema y no existe: no podemos normalizar
        throw new Error(`Cannot normalize path: no existing ancestor for ${target}`)
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Normaliza una ruta para verificación LÉXICA (sin seguir symlinks).
 * Expande aliases 8.3 caminando desde la raíz del disco hacia abajo y
 * comparando con entradas reales del FS. NO llama a fs.realpath.
 * Usada para `insideLexically` y `lexicalRelative`.
 */
export async function normalizePathLexical(target: string): Promise<string> {
  // Primero, encontrar el ancestro existente más profundo (sin seguir symlinks)
  let current = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      // Use lstat to check existence WITHOUT following symlinks
      await fs.lstat(current)
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Cannot normalize path: no existing ancestor for ${target}`)
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }

  // Ahora `current` es el ancestro existente más profundo.
  // Expandir 8.3 aliases desde la raíz del disco hacia abajo.
  const basePath = tail.length > 0 ? path.join(current, ...tail) : current
  return IS_WINDOWS ? await expand83AliasesFromRoot(basePath) : basePath
}

/**
 * En Windows, expande aliases 8.3 (ej. RUNNER~1 -> runneradmin) caminando
 * desde la raíz del disco hacia abajo y comparando con entradas reales del FS.
 * Retorna la ruta con nombres largos.
 */
async function expand83AliasesFromRoot(absPath: string): Promise<string> {
  if (!IS_WINDOWS) return absPath

  try {
    const components = absPath.split(path.sep).filter(c => c.length > 0)
    if (components.length === 0) return absPath

    // Empezar desde la raíz del disco (ej. "C:")
    const drive = components[0]!
    let currentPath = drive + path.sep
    const expanded: string[] = [drive]

    for (let i = 1; i < components.length; i++) {
      const comp = components[i]!
      const compLower = comp.toLowerCase()

      // Verificar si este componente parece un alias 8.3 (~1, ~2, etc.)
      const is83Alias = /^[A-Z0-9]{1,6}~[0-9]+$/i.test(comp)

      if (!is83Alias) {
        // No es alias 8.3, usar tal cual
        expanded.push(comp)
        currentPath = path.join(currentPath, comp)
        continue
      }

      // Es un alias 8.3: buscar el nombre real en el directorio actual
      try {
        const entries = await fs.readdir(currentPath)
        // Buscar entrada que coincida case-insensitive
        const realName = entries.find(e => e.toLowerCase() === compLower)
        if (realName) {
          expanded.push(realName)
          currentPath = path.join(currentPath, realName)
        } else {
          // No encontrado: mantener el alias (fail-open para no romper)
          expanded.push(comp)
          currentPath = path.join(currentPath, comp)
        }
      } catch {
        // Error leyendo directorio: mantener alias
        expanded.push(comp)
        currentPath = path.join(currentPath, comp)
      }
    }

    return path.join(...expanded)
  } catch {
    // Cualquier error: devolver ruta original
    return absPath
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Glob a regex
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Glob mínimo a regex. Soporta `*`, `**` y `?`.
 *
 * El orden de los reemplazos importa: el `?` se convierte ANTES de insertar
 * los patrones de `**`, porque el grupo insertado contiene un `?` literal
 * que, si se convierte después, se rompe y deja de matchear.
 */
export function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    // `?` primero: los patrones insertados después contienen `?` literal.
    .replace(/\?/g, ".")
    .replace(/\*\*\//g, "\u0000")
    .replace(/\*\*/g, "\u0001")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, "(?:.*/)?")
    .replace(/\u0001/g, ".*")
  return new RegExp(`^${escaped}$`)
}

/** Normaliza un glob: sin `./` inicial, sin `/` inicial, con `/` como separador. */
export function normalizeGlob(glob: string): string {
  return glob.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
}

/**
 * ¿El path cae dentro de alguno de los globs?
 *
 * Ojo con `**`: matchea todo lo que se le pase. Por eso `checkScope` nunca
 * llama a esta función antes de verificar la contención en el proyecto.
 */
export function matchesScope(relativePath: string, globs: string[]): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "")
  return globs.some((glob) => {
    if (glob === "**" || glob === "***") return true
    const g = normalizeGlob(glob)
    if (g === "**") return true
    return globToRegex(g).test(normalized)
  })
}

/* ────────────────────────────────────────────────────────────────────────────
 * Contención
 * ──────────────────────────────────────────────────────────────────────────── */

const IS_WINDOWS = process.platform === "win32"

/** Normaliza para comparar: en Windows las rutas son case-insensitive. */
function comparable(p: string): string {
  const resolved = path.resolve(p)
  return IS_WINDOWS ? resolved.toLowerCase() : resolved
}

/**
 * ¿`target` está dentro de `root`?
 *
 * La comparación es sobre paths ya resueltos, y el separador final se exige
 * explícitamente: `/proj-evil` NO está dentro de `/proj`.
 */
export function isInsideRoot(root: string, target: string): boolean {
  const r = comparable(root)
  const t = comparable(target)
  if (t === r) return true
  return t.startsWith(r.endsWith(path.sep) ? r : r + path.sep)
}

/** Relativo con `/` como separador. */
export function toPosix(p: string): string {
  return p.replace(/\\/g, "/")
}

/* ────────────────────────────────────────────────────────────────────────────
 * Resolución real
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ResolvedTarget {
  /** Path absoluto normalizado lexicograficamente. */
  absolute: string
  /** Path real: symlinks resueltos, con la cola inexistente re-enganchada. */
  resolved: string
  /** Relativo al root, del path REAL. "" si es el root mismo. */
  relative: string
  /** Relativo al root, del path LEXICOGRAFICO. */
  lexicalRelative: string
  /** Symlinks encontrados en el camino, del mas externo al mas interno. */
  symlinks: string[]
  /** ¿El archivo (o su directorio padre) existe? */
  exists: boolean
  /** ¿El path lexical esta dentro del root? */
  insideLexically: boolean
  /** ¿El path real esta dentro del root? */
  insidePhysically: boolean
}

/**
 * `realpath` del ancestro existente mas profundo, con la cola re-enganchada.
 *
 * `fs.realpath` falla si el archivo no existe todavia. Pero un archivo nuevo
 * en un directorio symlinkeado tiene un padre real distinto: hay que
 * resolver el padre y re-enganchar el nombre.
 */
async function realpathBestEffort(target: string): Promise<{ resolved: string; exists: boolean }> {
  let current = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      const real = await fs.realpath(current)
      const resolved = tail.length > 0 ? path.join(real, ...tail) : real
      return { resolved, exists: tail.length === 0 }
    } catch {
      const parent = path.dirname(current)
      if (parent === current) {
        // Llegamos a la raiz del sistema y no existe: devolvemos el target.
        return { resolved: path.resolve(target), exists: false }
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

/**
 * Recorre los componentes del camino buscando symlinks.
 *
 * Un symlink que apunta fuera del root es un escape, se detecte o no el
 * archivo final.
 */
async function findSymlinks(
  root: string,
  absolute: string,
): Promise<{ symlinks: string[]; escapes: boolean }> {
  const symlinks: string[] = []
  let escapes = false

  const rel = path.relative(root, absolute)
  const parts = rel.split(path.sep).filter((p) => p.length > 0)

  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    let stat: Awaited<ReturnType<typeof fs.lstat>>
    try {
      stat = await fs.lstat(current)
    } catch {
      // El componente no existe todavia: no hay symlink que seguir.
      continue
    }
    if (!stat.isSymbolicLink()) continue

    symlinks.push(current)
    let target: string
    try {
      target = await fs.realpath(current)
    } catch {
      // Symlink roto: no se puede resolver. Se trata como escapatorio
      // conservador, porque un link roto puede apuntar a cualquier lado
      // en cuanto exista el destino.
      escapes = true
      continue
    }
    if (!isInsideRoot(root, target)) escapes = true
  }

  return { symlinks, escapes }
}

/**
 * Resuelve un path contra el root, deshaciendo symlinks.
 *
 * Devuelve toda la información que `checkScope` necesita para decidir, y
 * no decide: la decision vive en un solo lugar.
 * 
 * IMPORTANTE: 
 * - Root y target (absoluto o relativo) se normalizan con normalizePath LEXICAL
 *   para verificación LÉXICA (insideLexically, lexicalRelative). NO sigue symlinks.
 * - Root y target se normalizan con normalizePath para verificación FÍSICA 
 *   (insidePhysically, relative). SÍ sigue symlinks.
 * - Para detectar symlinks, usamos el path lexicográfico (path.join) sin 
 *   normalizar y se lo pasamos a findSymlinks.
 * 
 * Si se proporciona `preNormalizedRoot`, se usa directamente (evita normalizar dos veces).
 */
export async function resolveTarget(root: string, rawPath: string, preNormalizedRoot?: string): Promise<ResolvedTarget & { projectRoot: string }> {
  // Normalize the project root with normalizePath (or use pre-normalized)
  const projectRoot = preNormalizedRoot ?? await normalizePath(root)
  
  // Compute the absolute path LEXICALLY (without following symlinks) for symlink detection
  const isAbsoluteInput = path.isAbsolute(rawPath)
  const absoluteLexical = isAbsoluteInput
    ? path.resolve(rawPath)
    : path.join(projectRoot, rawPath)
  
  // For LEXICAL containment checks, normalize with normalizePathLexical (doesn't follow symlinks)
  const absoluteLexicalNormalized = isAbsoluteInput
    ? await normalizePathLexical(rawPath)
    : await normalizePathLexical(path.join(projectRoot, rawPath))
  
  // For PHYSICAL containment checks, normalize with normalizePath (follows symlinks)
  const absoluteNormalized = isAbsoluteInput
    ? await normalizePath(rawPath)
    : await normalizePath(path.join(projectRoot, rawPath))
  
  const { resolved, exists } = await realpathBestEffort(absoluteNormalized)
  const { symlinks, escapes } = await findSymlinks(projectRoot, absoluteLexical)

  // Lexical containment: use lexically normalized paths (consistent 8.3 handling, no symlink following)
  const insideLexically = isInsideRoot(projectRoot, absoluteLexicalNormalized)
  // Physical containment: use physically normalized paths (follows symlinks, 8.3 expanded)
  const insidePhysically = insideLexically && !escapes && isInsideRoot(projectRoot, resolved)

  return {
    absolute: absoluteNormalized,
    resolved,
    relative: toPosix(path.relative(projectRoot, resolved)),
    lexicalRelative: toPosix(path.relative(projectRoot, absoluteLexicalNormalized)),
    symlinks,
    exists,
    insideLexically,
    insidePhysically,
    projectRoot,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Archivos sensibles
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Archivos que NUNCA se pueden escribir, pase lo que pase.
 *
 * No son negociables por el scope de la card: un `mayTouch: ["**"]` no
 * habilita a tocar el `.npmrc` de alguien ni una clave privada.
 */
export const SENSITIVE_PATTERNS: readonly string[] = [
  "**/.env",
  "**/.env.*",
  "**/.npmrc",
  "**/.netrc",
  "**/.git/**",
  "**/.git-credentials",
  "**/.htpasswd",
  "**/*.pem",
  "**/*.key",
  "**/*.p12",
  "**/*.pfx",
  "**/*.crt",
  "**/id_rsa*",
  "**/id_ed25519*",
  "**/id_ecdsa*",
  "**/.ssh/**",
  "**/.aws/**",
  "**/.gnupg/**",
  "**/.config/gcloud/**",
  "**/.kube/**",
  "**/credentials.json",
  "**/service-account*.json",
  "**/.docker/config.json",
  "**/.opencode/opencode.json",
]

/**
 * Excepciones: archivos que matchean un patrón sensible pero son inocuos.
 *
 * `.env.example` es un template sin secretos; bloquearlo obliga a los
 * agentes a hacer un rodeo por el `.env` real.
 */
export const SENSITIVE_EXCEPTIONS: readonly string[] = [
  "**/.env.example",
  "**/.env.sample",
  "**/.env.template",
  "**/*.key.example",
  "**/credentials.example.json",
]

/** ¿El path relativo cae en un patrón sensible y no es una excepción? */
export function isSensitive(relativePath: string): boolean {
  const normalized = normalizeGlob(relativePath)
  if (SENSITIVE_EXCEPTIONS.some((ex) => matchesScope(normalized, [ex]))) return false
  return SENSITIVE_PATTERNS.some((pattern) => matchesScope(normalized, [pattern]))
}

/* ────────────────────────────────────────────────────────────────────────────
 * Veredicto de scope
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ScopePolicy {
  mayTouch: string[]
  forbidden: string[]
}

export type ScopeVerdictKind =
  | "allowed"
  | "invalid"
  | "outside-project"
  | "symlink-escape"
  | "sensitive"
  | "forbidden"
  | "out-of-scope"

export interface ScopeVerdict {
  allowed: boolean
  kind: ScopeVerdictKind
  /** Razón legible en español, lista para mostrarle al modelo. */
  reason: string
  /** Path real (symlinks resueltos). */
  resolved: string
  /** Relativo al root, del path real. */
  relative: string
  /** Symlinks encontrados en el camino. */
  symlinks: string[]
}

/**
 * Rutas que la propia oficina usa como canal de entrega.
 *
 * El agente tiene que poder escribir `handoff.md`, `evidence.md`,
 * `review.md` y `gates.md`: son la evidencia de su trabajo. El scope de la
 * card es `src/**`, asi que sin esta excepcion el agente no podria
 * entregar nunca.
 *
 * OJO: solo los directorios de entrega. `state.json`, `roster.json`, el bus
 * y los leases son del motor — que un agente pueda escribir ahi seria
 * falsear la verdad de la corrida.
 */
export const OFFICE_WRITABLE: readonly string[] = [
  ".oficina/artifacts/**",
  ".oficina/fichas/**",
]

export interface ScopeCheckOptions {
  /** Ignorar la lista de sensibles (solo para uso interno de la oficina). */
  ignoreSensitive?: boolean
  /** Rutas que el agente puede escribir aunque no esten en `mayTouch`. */
  officeWritable?: readonly string[]
}

/**
 * Decide si un path puede escribirse.
 *
 * El orden de las comprobaciones es intencionado: primero lo que invalida
 * la ruta, después lo que la vuelve peligrosa, y recién al final si entra
 * en el scope permitido. Así el error que recibe el modelo dice la verdad
 * mas específica posible.
 */
export async function checkScope(
  root: string,
  rawPath: string,
  policy: ScopePolicy,
  options: ScopeCheckOptions = {},
): Promise<ScopeVerdict> {
  // Normalize root ONCE. This is the single source of truth for all comparisons.
  // Critical for Windows 8.3: both root and target must go through normalizePath.
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    const projectRoot = await normalizePath(root)
    return deny("invalid", "Ruta vacía.", projectRoot, "")
  }
  if (rawPath.includes("\0")) {
    const projectRoot = await normalizePath(root)
    return deny("invalid", "La ruta contiene un byte NUL.", projectRoot, "")
  }

  // Normalize root first, then resolve target with the pre-normalized root
  const projectRoot = await normalizePath(root)
  const target = await resolveTarget(root, rawPath, projectRoot)

  // 1. Fuera del proyecto (por `..` o por path absoluto).
  if (!target.insideLexically) {
    return {
      ...deny(
        "outside-project",
        `\`${rawPath}\` resuelve fuera del proyecto (\`${target.absolute}\`). ` +
          `La oficina solo escribe dentro de \`${projectRoot}\`.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
      symlinks: target.symlinks,
    }
  }

  // 2. Escape por symlink: el path lexical esta adentro, el real no.
  if (!target.insidePhysically) {
    const detalle =
      target.symlinks.length > 0
        ? `El camino atraviesa el symlink \`${toPosix(target.symlinks[0]!)}\` que apunta afuera del proyecto.`
        : "El camino resuelve a una ubicación fuera del proyecto."
    return {
      ...deny(
        "symlink-escape",
        `\`${rawPath}\` escapa del proyecto por symlink. ${detalle} ` +
          `Resuelve a \`${target.resolved}\`, que está fuera de \`${projectRoot}\`.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
      symlinks: target.symlinks,
    }
  }

  // 3. Archivos sensibles: no se pueden habilitar con el scope.
  if (!options.ignoreSensitive && isSensitive(target.relative)) {
    return {
      ...deny(
        "sensitive",
        `\`${target.relative}\` es un archivo sensible (credenciales, claves o configuración de git). ` +
          `La oficina nunca escribe esos archivos, pase lo que pase el scope. ` +
          `Si de verdad hace falta, pedile al usuario que lo haga él.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
      symlinks: target.symlinks,
    }
  }

  // 4. Forbidden de la card.
  if (matchesScope(target.relative, policy.forbidden)) {
    return {
      ...deny(
        "forbidden",
        `\`${target.relative}\` está en el scope forbidden de la card. ` +
          `Forbidden: ${policy.forbidden.join(", ")}. No lo toques. ` +
          `Si realmente hace falta, pedí que se amplíe el scope.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
      symlinks: target.symlinks,
    }
  }

  // 5. Canal de entrega de la oficina: siempre escribible.
  const officeWritable = options.officeWritable ?? OFFICE_WRITABLE
  if (matchesScope(target.relative, [...officeWritable])) {
    return {
      allowed: true,
      kind: "allowed",
      reason: "ok",
      resolved: target.resolved,
      relative: target.relative,
      symlinks: target.symlinks,
    }
  }

  // 6. mayTouch.
  if (!matchesScope(target.relative, policy.mayTouch)) {
    return {
      ...deny(
        "out-of-scope",
        `\`${target.relative}\` está fuera del scope de la card. ` +
          `Podés tocar: ${policy.mayTouch.join(", ")}. ` +
          `Si el archivo es necesario, pedí por el bus que se amplíe el scope, ` +
          `o pedí ayuda a un peer que lo cubra.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
      symlinks: target.symlinks,
    }
  }

  return {
    allowed: true,
    kind: "allowed",
    reason: "ok",
    resolved: target.resolved,
    relative: target.relative,
    symlinks: target.symlinks,
  }
}

function deny(
  kind: ScopeVerdictKind,
  reason: string,
  _root: string,
  relative: string,
): ScopeVerdict {
  return {
    allowed: false,
    kind,
    reason,
    resolved: "",
    relative,
    symlinks: [],
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Analisis de comandos de shell
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ShellCandidate {
  /** Path afectado por la escritura. */
  target: string
  /** Verbo que produce la escritura ("redirect", "tee", "cp", ...). */
  op: string
  /**
   * true si se detecto una escritura pero no se pudo extraer un path
   * confiable. En ese caso hay que armar el tripwire: no se puede
   * autorizar en blindness.
   */
  uncertain: boolean
}

/** Quita comillas y comillas invertidas de un token de shell. */
function unquote(token: string): string {
  const t = token.trim()
  if (
    (t.startsWith('"') && t.endsWith('"') && t.length >= 2) ||
    (t.startsWith("'") && t.endsWith("'") && t.length >= 2)
  ) {
    return t.slice(1, -1)
  }
  return t
}

/** El ultimo token no-vacio de una lista de argumentos. */
function lastToken(args: string | string[]): string | undefined {
  const list = Array.isArray(args) ? args : args.split(/\s+/)
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const t = (list[i] ?? "").trim()
    if (!t) continue
    if (t.startsWith("-")) continue
    return unquote(t)
  }
  return undefined
}

/** Todos los tokens no-opcion de una lista de argumentos. */
function plainTokens(args: string | string[]): string[] {
  const list = Array.isArray(args) ? args : args.split(/\s+/)
  return list
    .filter((t) => t.trim().length > 0 && !t.trim().startsWith("-"))
    .map(unquote)
}

/**
 * Extrae los paths que un comando de shell puede escribir.
 *
 * ## Por qué no es un parser de shell
 *
 * Un parser completo de shell (con here-docs, substituciones, funciones,
 * `eval`, interpreters embebidos) es un proyecto entero y sigue siendo
 * evadible. Lo que hace falta aca es otra cosa: **no dejar pasar en
 * silencio** una escritura que no entendimos.
 *
 * Por eso la funcion devuelve tambien los targets `uncertain`: cuando
 * vemos una escritura pero no sabemos a donde apunta, el comando no se
 * autoriza a ciegas — se deja pasar con el tripwire armed, y el
 * tripwire es el que detecta la escribir fuera del scope despues.
 */
export function analyzeShellCommand(command: string): ShellCandidate[] {
  const out: ShellCandidate[] = []
  if (typeof command !== "string" || command.trim().length === 0) return out

  const add = (target: string | undefined, op: string, uncertain = false) => {
    if (target === undefined) {
      out.push({ target: "", op, uncertain: true })
      return
    }
    const clean = unquote(target).trim()
    if (!clean || clean === "-" || clean === "&1") return
    out.push({ target: clean, op, uncertain: false })
  }

  // Redirecciones: > >> 2> &> |>
  const redirect = /(?:^|[^0-9>|&])(?:\d*>>?|&>>?|\|>)\s*("[^"]*"|'[^']*'|[^\s;|&>]+)/g
  for (const m of command.matchAll(redirect)) {
    add(m[1], "redirect")
  }

  // tee
  for (const m of command.matchAll(/\btee\b((?:\s+-{1,2}\S+)*)\s+("[^"]*"|'[^']*'|[^\s;|&]+)/g)) {
    add(m[2], "tee")
  }

  // cp / mv / install -> destino = ultimo argumento
  for (const m of command.matchAll(/\b(cp|mv|install)\s+((?:[^\s;|&]|\s)+?)(?:\s*[;|&]|$)/g)) {
    const args = plainTokens(m[2] ?? "")
    if (args.length === 0) {
      add(undefined, m[1] ?? "cp", true)
      continue
    }
    // `cp -r a b c` -> el destino es `c`; `cp a b` -> `b`.
    const dest = args.length >= 2 ? args[args.length - 1] : args[0]
    add(dest, m[1] ?? "cp")
  }

  // rm -> todos los argumentos son blancos
  for (const m of command.matchAll(/\brm\s+((?:[^\s;|&]|\s)+?)(?:\s*[;|&]|$)/g)) {
    const args = plainTokens(m[1] ?? "")
    if (args.length === 0) add(undefined, "rm", true)
    else for (const a of args) add(a, "rm")
  }

  // mkdir / touch / truncate / mktemp
  for (const m of command.matchAll(/\b(mkdir|touch|truncate)\s+((?:[^\s;|&]|\s)+?)(?:\s*[;|&]|$)/g)) {
    const args = plainTokens(m[2] ?? "")
    if (args.length === 0) add(undefined, m[1] ?? "mkdir", true)
    else for (const a of args) add(a, m[1] ?? "mkdir")
  }

  // sed -i
  for (const m of command.matchAll(/\bsed\s+((?:[^\s;|&]|\s)+?)(?:\s*[;|&]|$)/g)) {
    const raw = m[1] ?? ""
    if (!/(^|\s)-[a-zA-Z]*i/.test(raw)) continue
    const args = plainTokens(raw.replace(/(^|\s)-[a-zA-Z]*i(\S*)/, " "))
    const target = lastToken(args)
    add(target, "sed -i")
  }

  // dd of=
  for (const m of command.matchAll(/\bdd\b[^\n;|&]*?\bof=("[^"]*"|'[^']*'|\S+)/g)) {
    add(m[1], "dd")
  }

  // curl -o / wget -O
  for (const m of command.matchAll(/\b(curl|wget)\b[^\n;|&]*?\s-[oO]\s*("[^"]*"|'[^']*'|\S+)/g)) {
    add(m[2], m[1] ?? "curl")
  }

  // git checkout / restore / clean
  for (const m of command.matchAll(/\bgit\s+(?:checkout|restore|clean)\b([^\n;|&]*)/g)) {
    const rest = (m[1] ?? "").trim()
    const afterDash = /--\s+(.+)$/.exec(rest)
    if (afterDash) {
      for (const p of plainTokens(afterDash[1] ?? "")) add(p, "git")
      continue
    }
    const args = plainTokens(rest)
    if (args.length === 0) {
      add(undefined, "git", true)
      continue
    }
    for (const p of args) add(p, "git")
  }

  // chmod / chown
  for (const m of command.matchAll(/\b(chmod|chown)\s+((?:[^\s;|&]|\s)+?)(?:\s*[;|&]|$)/g)) {
    const target = lastToken(plainTokens(m[2] ?? ""))
    add(target, m[1] ?? "chmod")
  }

  // Interpreters embebidos: python -c / node -e / ruby -e / perl -e.
  // OJO: el flag es `-c` en python y `-e` en node/ruby/perl. Un regex con
  // `-e?` matcheaba el guion suelto y nunca llegaba al codigo.
  const INTERPRETER = /\b(python3?|node|ruby|perl)\b\s+(?:-[ec]\s+|--eval\s+)?("[^"]*"|'[^']*')/g
  for (const m of command.matchAll(INTERPRETER)) {
    const code = unquote(m[2] ?? "")
    const literales = [...code.matchAll(/["']([^"']{2,})["']/g)].map((x) => x[1] ?? "")
    const paths = literales.filter((s) => s.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(s))
    if (paths.length === 0) {
      add(undefined, `${m[1] ?? "python"} -c`, true)
      continue
    }
    for (const p of paths) add(p, `${m[1] ?? "python"} -c`)
  }

  // Heredoc a un interpreter: el codigo entra por stdin, no se puede ver.
  for (const m of command.matchAll(/\b(python3?|node|ruby|perl)\b\s*<<-?\s*['"]?\w+['"]?/g)) {
    add(undefined, `${m[1] ?? "python"} heredoc`, true)
  }

  // Escrituras que no sabemos interpretar: el verbo esta pero no el target.
  if (/\b(python3?|node|ruby|perl)\b\s+(?:-[ec]\s+|--eval\s+|<<)/.test(command)) {
    const yaCubierto = out.some((c) => c.op.includes("-c") || c.op.includes("heredoc"))
    if (!yaCubierto) out.push({ target: "", op: "interpreter", uncertain: true })
  }

  // Deduplicar por (op, target).
  const seen = new Set<string>()
  return out.filter((c) => {
    const key = `${c.op}::${c.target}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
