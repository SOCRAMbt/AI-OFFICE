#!/usr/bin/env node
// Uso:
//   node cli.js add "comprar pan"
//   node cli.js list
// Las tareas se guardan en todos.json (o en el archivo de la variable TODO_FILE).
import { add, format, load, save } from "./todo.js"

const file = process.env.TODO_FILE ?? "todos.json"
const [command, ...rest] = process.argv.slice(2)

try {
  if (command === "add") {
    const items = add(load(file), rest.join(" "))
    save(file, items)
    console.log(`Agregada: ${items.at(-1).id}. ${items.at(-1).text}`)
  } else if (command === "list") {
    const items = load(file)
    console.log(items.length ? format(items) : "No hay tareas.")
  } else {
    console.error('Uso: node cli.js add "texto" | node cli.js list')
    process.exitCode = 1
  }
} catch (err) {
  console.error(`Error: ${err.message}`)
  process.exitCode = 1
}
