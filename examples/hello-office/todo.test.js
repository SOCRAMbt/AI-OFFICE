import assert from "node:assert/strict"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"
import { add, format, load, save } from "./todo.js"

test("add da ids correlativos y deja la tarea pendiente", () => {
  const items = add(add([], "comprar pan"), "llamar a mamá")
  assert.deepEqual(items, [
    { id: 1, text: "comprar pan", done: false },
    { id: 2, text: "llamar a mamá", done: false },
  ])
})

test("add rechaza un texto vacío", () => {
  assert.throws(() => add([], "   "), /vacía/)
})

test("format muestra una línea por tarea", () => {
  const items = [
    { id: 1, text: "comprar pan", done: true },
    { id: 2, text: "llamar a mamá", done: false },
  ]
  assert.equal(format(items), "1. [x] comprar pan\n2. [ ] llamar a mamá")
})

test("save y load guardan y recuperan la lista; sin archivo la lista está vacía", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hello-office-"))
  const file = path.join(dir, "todos.json")
  assert.deepEqual(load(file), [])
  save(file, add([], "comprar pan"))
  assert.deepEqual(load(file), [{ id: 1, text: "comprar pan", done: false }])
  fs.rmSync(dir, { recursive: true, force: true })
})
