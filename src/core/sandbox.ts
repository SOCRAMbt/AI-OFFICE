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
 * Normalización canónica para contención (Windows 8.3-safe)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Canoniza una ruta para contención LÉXICA (sin seguir symlinks).
 *
 * Algoritmo:
 * 1. path.resolve para obtener la ruta absoluta
 * 2. Caminar hacia arriba hasta encontrar el ancestro existente más profundo (lstat, NO realpath)
 * 3. fs.realpath sobre el PADRE de ese ancestro (en Windows expande 8.3 automáticamente)
 *    Esto evita seguir symlinks en el componente final mientras expande 8.3.
 * 4. Re-enganchar el componente encontrado + cola de componentes inexistentes
 *
 * Para contención LÉXICA: NO sigue symlinks en la cola, usa lstat para verificar existencia.
 * Usada para insideLexically y lexicalRelative.
 */
export async function canonicalizeLexical(target: string): Promise<string> {
  let current = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      // lstat NO sigue symlinks - solo verifica existencia
      await fs.lstat(current)
      break
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Cannot canonicalize path: no existing ancestor for ${target}`)
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }

  // current es el ancestro existente más profundo (sin seguir symlinks)
  // Usar realpath del PADRE para expandir 8.3 aliases sin seguir symlinks en current
  const parent = path.dirname(current)
  const realParent = await fs.realpath(parent)
  const baseName = path.basename(current)
  const real = path.join(realParent, baseName)
  return tail.length > 0 ? path.join(real, ...tail) : real
}

/**
 * Canoniza una ruta para contención FÍSICA (siguiendo symlinks).
 *
 * Algoritmo:
 * 1. path.resolve para obtener la ruta absoluta
 * 2. Caminar hacia arriba hasta encontrar el ancestro existente más profundo
 * 3. fs.realpath sobre ese ancestro (sigue symlinks, expande 8.3 en Windows)
 * 4. Re-enganchar la cola de componentes inexistentes
 *
 * Para contención FÍSICA: sigue symlinks, usa realpath.
 * Usada para insidePhysically y relative.
 */
export async function canonicalizePhysical(target: string): Promise<string> {
  let current = path.resolve(target)
  const tail: string[] = []

  for (;;) {
    try {
      const real = await fs.realpath(current)
      return tail.length > 0 ? path.join(real, ...tail) : real
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        throw err
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new Error(`Cannot canonicalize path: no existing ancestor for ${target}`)
      }
      tail.unshift(path.basename(current))
      current = parent
    }
  }
}

const IS_WINDOWS = process.platform === "win32"

/**
 * En Windows, normaliza los componentes de una ruta eliminando puntos y espacios finales
 * por segmento (comportamiento de Win32 API), preservando '.' y '..' y la letra de unidad.
 */
export function normalizeWindowsSegments(p: string): string {
  return p
    .split(/[/\\]/)
    .map((seg, idx) => {
      if (idx === 0 && /^[a-zA-Z]:$/.test(seg)) return seg
      if (seg === "." || seg === "..") return seg
      return seg.replace(/[. ]+$/, "")
    })
    .join(path.sep)
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
  return new RegExp(`^${escaped}$`, IS_WINDOWS ? "i" : undefined)
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
 * 
 * Recibe `root` ya canonizado y `absolute` path léxico (sin canonizar).
 */
async function findSymlinks(
  root: string,
  absolute: string,
  physicalRoot?: string,
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
    const inside = isInsideRoot(root, target) || (physicalRoot ? isInsideRoot(physicalRoot, target) : false)
    if (!inside) escapes = true
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
 * - Root y target se canonizan con la MISMA función `canonicalizeLexical`
 *   para todas las decisiones de contención (insideLexically, insidePhysically).
 * - La contención léxica y física usan paths canonizados de la misma forma.
 * - Para detectar symlinks, usamos el path lexicográfico sin canonizar y lo pasamos a findSymlinks.
 * 
 * Si se proporciona `preNormalizedRoot`, se usa directamente (evita canonizar dos veces).
 */
export async function resolveTarget(root: string, rawPath: string, preNormalizedRoot?: string): Promise<ResolvedTarget & { projectRoot: string }> {
  // En Windows: rechazar streams alternativos NTFS (colon después de la letra de unidad)
  if (IS_WINDOWS) {
    const afterDrive = rawPath.replace(/^[a-zA-Z]:/, "")
    if (afterDrive.includes(":")) {
      throw new Error(`NTFS alternate data streams are not supported: ${rawPath}`)
    }
  }

  // Canonizar el root con la función canónica ÚNICA
  const projectRoot = preNormalizedRoot ?? await canonicalizeLexical(root)
  const { resolved: physicalRoot } = await realpathBestEffort(projectRoot)

  const effectiveRawPath = IS_WINDOWS ? normalizeWindowsSegments(rawPath) : rawPath
  
  // Path absoluto léxico (sin canonizar) para detección de symlinks
  const isAbsoluteInput = path.isAbsolute(effectiveRawPath)
  const absoluteLexical = isAbsoluteInput
    ? path.resolve(effectiveRawPath)
    : path.join(projectRoot, effectiveRawPath)
  
  // Canonizar target con la MISMA función que el root para contención
  const targetCanonical = isAbsoluteInput
    ? await canonicalizeLexical(effectiveRawPath)
    : await canonicalizeLexical(path.join(projectRoot, effectiveRawPath))
  
  // Para verificación física: resolver symlinks del target canonizado
  const { resolved, exists } = await realpathBestEffort(targetCanonical)
  
  // Detección de symlinks: walk léxico sin canonizar
  const { symlinks, escapes } = await findSymlinks(projectRoot, absoluteLexical, physicalRoot)

  // Contención: AMBOS usan paths canonizados con la MISMA función
  const insideLexically = isInsideRoot(projectRoot, targetCanonical)
  const insidePhysically =
    insideLexically &&
    !escapes &&
    (isInsideRoot(projectRoot, resolved) || isInsideRoot(physicalRoot, resolved))

  const relPhysical = isInsideRoot(projectRoot, resolved)
    ? path.relative(projectRoot, resolved)
    : path.relative(physicalRoot, resolved)

  return {
    absolute: targetCanonical,
    resolved,
    relative: toPosix(relPhysical),
    lexicalRelative: toPosix(path.relative(projectRoot, targetCanonical)),
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
  "**/.opencode/agents/**",
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
  ".oficina/board.md",
  ".oficina/context.md",
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
  // Canonizar root UNA VEZ léxicamente. Esta es la única fuente de verdad.
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    const projectRoot = await canonicalizeLexical(root)
    return deny("invalid", "Ruta vacía.", projectRoot, "")
  }
  if (rawPath.includes("\0")) {
    const projectRoot = await canonicalizeLexical(root)
    return deny("invalid", "La ruta contiene un byte NUL.", projectRoot, "")
  }
  if (IS_WINDOWS) {
    const afterDrive = rawPath.replace(/^[a-zA-Z]:/, "")
    if (afterDrive.includes(":")) {
      const projectRoot = await canonicalizeLexical(root)
      return deny("invalid", `Ruta no válida: stream NTFS alternativo detectado en \`${rawPath}\`.`, projectRoot, rawPath)
    }
  }

  // Canonizar root léxicamente, luego resolver target con el root ya canonizado
  const projectRoot = await canonicalizeLexical(root)
  let target: ResolvedTarget & { projectRoot: string }
  try {
    target = await resolveTarget(root, rawPath, projectRoot)
  } catch (err) {
    return {
      ...deny(
        "invalid",
        `Ruta no válida: ${(err as Error).message}`,
        projectRoot,
        rawPath,
      ),
      resolved: "",
      symlinks: [],
    }
  }

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

  // 5. Protección de estado interno de .oficina y canal de entrega.
  const officeWritable = options.officeWritable ?? OFFICE_WRITABLE
  const isInsideOficina =
    target.relative === ".oficina" ||
    target.relative.startsWith(".oficina/") ||
    target.lexicalRelative === ".oficina" ||
    target.lexicalRelative.startsWith(".oficina/")

  if (isInsideOficina) {
    const isAllowedOficina =
      matchesScope(target.relative, [...officeWritable]) ||
      matchesScope(target.lexicalRelative, [...officeWritable])
    if (isAllowedOficina) {
      return {
        allowed: true,
        kind: "allowed",
        reason: "ok",
        resolved: target.resolved,
        relative: target.relative,
        symlinks: target.symlinks,
      }
    }
    return {
      ...deny(
        "forbidden",
        `\`${target.relative}\`: estado interno del motor (.oficina) protegido. ` +
          `Solo se pueden escribir artefactos y fichas de entrega.`,
        projectRoot,
        target.relative,
      ),
      resolved: target.resolved,
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
  path?: string
  reason?: string
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

  const add = (target: string | undefined, op: string, uncertain = false, extra?: { path?: string; reason?: string }) => {
    if (target === undefined) {
      out.push({ target: "", op, uncertain: true, path: extra?.path ?? ".", reason: extra?.reason ?? "uncertain target" })
      return
    }
    const clean = unquote(target).trim()
    if (
      !clean ||
      clean === "-" ||
      clean === "&1" ||
      clean === "&2" ||
      clean === "2>&1" ||
      clean === "1>&2" ||
      clean === ">&2" ||
      clean === "/dev/null" ||
      clean === "$null"
    ) return
    out.push({
      target: clean,
      op,
      uncertain,
      ...(extra?.path ? { path: extra.path } : {}),
      ...(extra?.reason ? { reason: extra.reason } : {}),
    })
  }

  // Redirecciones: > >> 2> &> |> (excluyendo => y -> para funciones flecha)
  const redirect = /(?:^|[^0-9>|&=-])(?:\d*>>?|&>>?|\|>)\s*("[^"]*"|'[^']*'|[^\s;|&>]+)/g
  for (const m of command.matchAll(redirect)) {
    add(m[1], "redirect")
  }

  // tee
  for (const m of command.matchAll(/\btee\b((?:\s+-{1,2}\S+)*)\s+("[^"]*"|'[^']*'|[^\s;|&>\r\n]+)/g)) {
    add(m[2], "tee")
  }

  // cp / mv / install -> destino = ultimo argumento
  for (const m of command.matchAll(/\b(cp|mv|install)\s+((?:[^\s;|&>\r\n]|\s)+?)(?:\s*[;|&>\r\n]|$)/g)) {
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
  for (const m of command.matchAll(/\brm\s+((?:[^\s;|&>\r\n]|\s)+?)(?:\s*[;|&>\r\n]|$)/g)) {
    const args = plainTokens(m[1] ?? "")
    if (args.length === 0) add(undefined, "rm", true)
    else for (const a of args) add(a, "rm")
  }

  // mkdir / touch / truncate / mktemp
  for (const m of command.matchAll(/\b(mkdir|touch|truncate)\s+((?:[^\s;|&>\r\n]|\s)+?)(?:\s*[;|&>\r\n]|$)/g)) {
    const args = plainTokens(m[2] ?? "")
    if (args.length === 0) add(undefined, m[1] ?? "mkdir", true)
    else for (const a of args) add(a, m[1] ?? "mkdir")
  }

  // sed -i
  for (const m of command.matchAll(/\bsed\s+((?:[^\s;|&>\r\n]|\s)+?)(?:\s*[;|&>\r\n]|$)/g)) {
    const raw = m[1] ?? ""
    if (!/(^|\s)-[a-zA-Z]*i/.test(raw)) continue
    const args = plainTokens(raw.replace(/(^|\s)-[a-zA-Z]*i(\S*)/, " "))
    const target = lastToken(args)
    add(target, "sed -i")
  }

  // dd of=
  for (const m of command.matchAll(/\bdd\b[^\r\n;|&>]*?\bof=("[^"]*"|'[^']*'|\S+)/g)) {
    add(m[1], "dd")
  }

  // curl -o / wget -O
  for (const m of command.matchAll(/\b(curl|wget)\b[^\r\n;|&>]*?\s-[oO]\s*("[^"]*"|'[^']*'|\S+)/g)) {
    add(m[2], m[1] ?? "curl")
  }

  // git checkout / restore / clean
  for (const m of command.matchAll(/\bgit\s+(?:checkout|restore|clean)\b([^\r\n;|&>]*)/g)) {
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
  for (const m of command.matchAll(/\b(chmod|chown)\s+((?:[^\s;|&>\r\n]|\s)+?)(?:\s*[;|&>\r\n]|$)/g)) {
    const target = lastToken(plainTokens(m[2] ?? ""))
    add(target, m[1] ?? "chmod")
  }

  // PowerShell: Set-Content, Add-Content, Clear-Content
  for (const m of command.matchAll(/\b(Set-Content|Add-Content|Clear-Content)\b([^\r\n;|&>]*)/gi)) {
    const raw = m[2] ?? ""
    const pathMatch = /-(?:Path|LiteralPath)\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (pathMatch?.[1]) {
      add(pathMatch[1], m[1] ?? "Set-Content")
    } else {
      const tokens = plainTokens(raw)
      add(tokens[0], m[1] ?? "Set-Content", tokens.length === 0)
    }
  }

  // PowerShell: Out-File
  for (const m of command.matchAll(/\bOut-File\b([^\r\n;|&>]*)/gi)) {
    const raw = m[1] ?? ""
    const fileMatch = /-(?:FilePath|LiteralPath|Path)\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (fileMatch?.[1]) {
      add(fileMatch[1], "Out-File")
    } else {
      const tokens = plainTokens(raw)
      add(tokens[0], "Out-File", tokens.length === 0)
    }
  }

  // PowerShell: New-Item
  for (const m of command.matchAll(/\bNew-Item\b([^\r\n;|&>]*)/gi)) {
    const raw = m[1] ?? ""
    const pathMatch = /-(?:Path|Name)\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (pathMatch?.[1]) {
      add(pathMatch[1], "New-Item")
    } else {
      const tokens = plainTokens(raw)
      add(tokens[0], "New-Item", tokens.length === 0)
    }
  }

  // PowerShell: Remove-Item
  for (const m of command.matchAll(/\bRemove-Item\b([^\r\n;|&>]*)/gi)) {
    const raw = m[1] ?? ""
    const pathMatch = /-(?:Path|LiteralPath)\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (pathMatch?.[1]) {
      add(pathMatch[1], "Remove-Item")
    } else {
      const tokens = plainTokens(raw)
      if (tokens.length === 0) add(undefined, "Remove-Item", true)
      else for (const t of tokens) add(t, "Remove-Item")
    }
  }

  // PowerShell: Copy-Item, Move-Item
  for (const m of command.matchAll(/\b(Copy-Item|Move-Item)\b([^\r\n;|&>]*)/gi)) {
    const raw = m[2] ?? ""
    const destMatch = /-(?:Destination)\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (destMatch?.[1]) {
      add(destMatch[1], m[1] ?? "Copy-Item")
    } else {
      const tokens = plainTokens(raw)
      if (tokens.length === 0) {
        add(undefined, m[1] ?? "Copy-Item", true)
      } else {
        const dest = tokens.length >= 2 ? tokens[tokens.length - 1] : tokens[0]
        add(dest, m[1] ?? "Copy-Item")
      }
    }
  }

  // PowerShell: Rename-Item
  for (const m of command.matchAll(/\bRename-Item\b([^\r\n;|&>]*)/gi)) {
    const raw = m[1] ?? ""
    const newNameMatch = /-NewName\s+("[^"]*"|'[^']*'|\S+)/i.exec(raw)
    if (newNameMatch?.[1]) {
      add(newNameMatch[1], "Rename-Item")
    }
    const tokens = plainTokens(raw)
    if (tokens.length === 0 && !newNameMatch) {
      add(undefined, "Rename-Item", true)
    } else {
      for (const t of tokens) add(t, "Rename-Item")
    }
  }

  // PowerShell: Invoke-WebRequest -OutFile, iwr -OutFile, curl -OutFile
  for (const m of command.matchAll(/\b(?:Invoke-WebRequest|iwr|curl)\b[^\r\n;|&>]*?-OutFile\s+("[^"]*"|'[^']*'|\S+)/gi)) {
    add(m[1], "Invoke-WebRequest -OutFile")
  }

  // PowerShell / .NET: [System.IO.File]::Write*
  for (const m of command.matchAll(/(?:^|[^a-zA-Z0-9_])\[System\.IO\.File\]::Write\w*\s*\(\s*("[^"]*"|'[^']*'|[^,\s)]+)/gi)) {
    add(m[1], "[System.IO.File]::Write")
  }

  // Interpreters embebidos: python -c / node -e / ruby -e / perl -e / bun -e / etc.
  const INTERPRETER = /\b(python3?|node|ruby|perl|bun|deno|tsx|bash|sh|pwsh|powershell|cmd)\b(?:\s+--?[a-zA-Z0-9_-]+)*\s+(?:-[ec]\s+|--eval\s+|-[cC]ommand\s+|\/[ckCK]\s+)("[^"]*"|'[^']*')/g
  for (const m of command.matchAll(INTERPRETER)) {
    const code = unquote(m[2] ?? "")
    const literales = [...code.matchAll(/["']([^"']{2,})["']/g)].map((x) => x[1] ?? "")
    const paths = literales.filter((s) => s.includes("/") || /\.[A-Za-z0-9]{1,6}$/.test(s))
    const op = `${m[1]} -c`
    if (paths.length === 0) {
      add(undefined, op, true, { path: ".", reason: `interpreter eval: ${m[1]}` })
      continue
    }
    for (const p of paths) add(p, op, false, { path: p, reason: `interpreter path: ${p}` })
  }

  // Heredoc a un interpreter
  for (const m of command.matchAll(/\b(python3?|node|ruby|perl|bun|deno|tsx|bash|sh|pwsh|powershell|cmd)\b\s*<<-?\s*['"]?\w+['"]?/g)) {
    add(undefined, `${m[1]} heredoc`, true, { path: ".", reason: `interpreter heredoc: ${m[1]}` })
  }

  // Cualquier otra invocación de interprete con flags de ejecución (-e, -c, --eval, -Command, -File, /c)
  const INTERPRETER_INVOCATION = /\b(python3?|node|ruby|perl|bun|deno|tsx|bash|sh|pwsh|powershell|cmd)\b(?:\s+--?[a-zA-Z0-9_-]+)*\s+(?:-[ec]\b|--eval\b|-[cC]ommand\b|-[fF]ile\b|\/[ckCK]\b|<<)/i
  if (INTERPRETER_INVOCATION.test(command)) {
    const yaCubierto = out.some((c) => c.op.includes("-c") || c.op.includes("heredoc") || c.uncertain)
    if (!yaCubierto) {
      out.push({ target: "", op: "interpreter", uncertain: true, path: ".", reason: "interpreter invocation" })
    }
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
