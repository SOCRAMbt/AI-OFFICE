// Lógica de la lista de tareas. Sin dependencias.
import fs from "node:fs"

/** Lee las tareas del archivo. Si no existe, la lista está vacía. */
export function load(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

export function save(file, items) {
  fs.writeFileSync(file, JSON.stringify(items, null, 2) + "\n")
}

/** Agrega una tarea pendiente y devuelve la lista nueva. El id es correlativo. */
export function add(items, text) {
  const clean = String(text ?? "").trim()
  if (!clean) throw new Error("La tarea no puede estar vacía")
  const id = items.reduce((max, item) => Math.max(max, item.id), 0) + 1
  return [...items, { id, text: clean, done: false }]
}

/** Una línea por tarea: "1. [ ] comprar pan". */
export function format(items) {
  return items.map((item) => `${item.id}. [${item.done ? "x" : " "}] ${item.text}`).join("\n")
}
