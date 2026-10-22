/**
 * Convierte los links relativos del README en absolutos de GitHub.
 *
 * En el repo los links relativos funcionan. En npm no: la página del paquete
 * vive en un contexto distinto y `docs/QUE-ES.md` da 404.
 */
import fs from "node:fs"
import path from "node:path"

const REPO = "https://github.com/SOCRAMbt/AI-OFFICE"
const BRANCH = "main"
const file = "C:/Users/Marcos/oficina-plugin/README.md"
let content = fs.readFileSync(file, "utf8")

/** Un destino sin extensión es un directorio: va por /tree/, no /blob/. */
function absolute(rawPath, anchorPart) {
  const kind = path.extname(rawPath) === "" ? "tree" : "blob"
  const anchor = anchorPart ? `#${anchorPart}` : ""
  return `${REPO}/${kind}/${BRANCH}/${rawPath}${anchor}`
}

let changed = 0

// 1. Badges: `[![alt](imagen)](destino)`.
//    Necesitan su propio patrón: el label contiene `]` y la imagen está
//    adentro, así que el regex de links simples no los alcanza.
content = content.replace(
  /\[!\[([^\]\n]*)\]\((https?:[^)\s]+)\)\]\(([^)\s]+)\)/g,
  (match, alt, img, target) => {
    if (/^https?:/.test(target)) return match
    const [rawPath, anchorPart] = target.split("#")
    changed += 1
    return `[![${alt}](${img})](${absolute(rawPath, anchorPart)})`
  },
)

// 2. Links simples a archivos relativos.
//    Grupo 1 = texto del link. Grupo 2 = destino. El paréntesis de apertura
//    queda FUERA de los grupos: si lo capturamos, el reemplazo duplica el '('.
content = content.replace(
  /\[([^\]\n]+)\]\(((?!https?:|#|mailto:)[^)\s]+)\)/g,
  (match, label, target) => {
    const [rawPath, anchorPart] = target.split("#")
    changed += 1
    return `[${label}](${absolute(rawPath, anchorPart)})`
  },
)

fs.writeFileSync(file, content, "utf8")
console.log(`Links convertidos a absolutos: ${changed}`)
