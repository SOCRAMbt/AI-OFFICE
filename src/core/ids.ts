/**
 * IDs seguros para usar como nombre de archivo.
 *
 * ## Por qué existe
 *
 * Los ids de la oficina (card, agente, mensaje, task) vienen del modelo a
 * través de las tools. Se usan tal cual para construir rutas:
 *
 *     path.join(artifactsDir, cardId)      -> ".oficina/artifacts/../../evil"
 *
 * Con `cardId = "../../evil"` la escritura escapa del directorio de la
 * oficina. Como `writeAtomic` hace `mkdir -p` del padre, el archivo terminaba
 * fuera de `.oficina/`.
 *
 * Un id es "seguro" si:
 *   - no contiene separadores de ruta (`/` ni `\`)
 *   - no contiene `..` como segmento
 *   - no contiene caracteres de control ni NUL
 *   - no empieza por `.` (evita `.`, `..` y ocultos accidentales)
 *   - no excede un largo razonable
 *
 * ## Por qué no basta con "reemplazar caracteres"
 *
 * Reemplazar `/` por `_` deja pasar `..` (que no tiene separador) y
 * `....//` que al normalizarse se vuelve `../`. La normalización **antes**
 * de la sanitización es la que importa: por eso `safeId` valida el id ya
 * normalizado, sin transformarlo.
 */

/** Separadores de ruta. El guion NO va acá: `e-frontend-developer` es válido. */
const SEPARATORS = /[/\\]/

/** Longitud máxima de un id de archivo. */
export const MAX_ID_LENGTH = 96

/** ¿El string tiene caracteres de control (incluido NUL)? */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    if (code < 32 || code === 127) return true
  }
  return false
}

/**
 * Valida un id y lo devuelve si es seguro para usar como nombre de archivo.
 *
 * Devuelve `undefined` si el id no se puede sanear de forma no destructiva:
 * es preferible rechazar el input que convertir silenciosamente un id
 * distinto al que el modelo pidió.
 */
export function safeId(raw: string | undefined | null): string | undefined {
  if (typeof raw !== "string") return undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  if (trimmed.length > MAX_ID_LENGTH) return undefined
  if (SEPARATORS.test(trimmed)) return undefined
  if (hasControlChars(trimmed)) return undefined
  // `..` es un segmento de traversal aunque no tenga separadores, y
  // cualquier id que lo contenga es sospechoso (`a..b` no es un id real).
  if (trimmed.includes("..")) return undefined
  // Un id no puede empezar con punto: produciría rutas ocultas y, en
  // algunos sistemas, rutas relativas al directorio actual.
  if (trimmed.startsWith(".")) return undefined
  return trimmed
}

/** ¿El id es seguro sin transformarlo? */
export function isSafeId(raw: string | undefined | null): boolean {
  return safeId(raw) !== undefined
}

/**
 * Construye una ruta dentro de un directorio, garantizando que no escape.
 *
 * Devuelve `undefined` si el id no es seguro, en lugar de lanzar: el
 * llamador decide qué hacer con un id inválido.
 */
export function safeJoin(dir: string, id: string | undefined | null, suffix = ""): string | undefined {
  const safe = safeId(id)
  if (!safe) return undefined
  return `${dir}/${safe}${suffix}`
}
