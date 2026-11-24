/**
 * Tests de regresión del parser de shell: targets basura deben marcarse
 * `uncertain` (permitido + tripwire), nunca como certeza de escritura.
 */
import { describe, it, expect } from "vitest"
import { analyzeShellCommand } from "../src/core/sandbox.js"

describe("analyzeShellCommand: targets de install son inciertos, no archivos", () => {
  it("pip install de un paquete con redirect 2>&1 no devuelve targets certeros", () => {
    const out = analyzeShellCommand("pip install pymdown-extensions 2>&1")
    const hard = out.filter((t) => !t.uncertain)
    expect(hard).toEqual([])
    expect(out.length).toBeGreaterThan(0)
    expect(out.some((t) => t.uncertain)).toBe(true)
  })

  it("npm install --save-dev vitest → incierto, nunca archivo", () => {
    const out = analyzeShellCommand("npm install --save-dev vitest")
    expect(out.every((t) => t.uncertain)).toBe(true)
  })

  it("python -m pip install → incierto (tripwire), nunca target certero", () => {
    const out = analyzeShellCommand("python -m pip install pymdown-extensions")
    expect(out.every((t) => t.uncertain)).toBe(true)
    expect(out.filter((t) => t.uncertain === false)).toEqual([])
  })

  it("pip install -r requirements.txt → incierto", () => {
    const out = analyzeShellCommand("pip install -r requirements.txt")
    expect(out.some((t) => t.uncertain)).toBe(true)
  })

  it("curl -o out.md → objetivo cierto (archivar la salida)", () => {
    expect(analyzeShellCommand("curl https://x.com/f.md -o out.md").some((t) => t.target === "out.md" && !t.uncertain)).toBe(true)
  })

  it("mkdir -p chapters → target cierto", () => {
    expect(analyzeShellCommand("mkdir -p chapters").some((t) => t.target === "chapters" && !t.uncertain)).toBe(true)
  })

  it("redirect a archivo → target cierto", () => {
    expect(analyzeShellCommand("echo hi > chapters/x.md").some((t) => t.target === "chapters/x.md" && !t.uncertain)).toBe(true)
  })

  it("git add -A → sin escritura local interpretada", () => {
    expect(analyzeShellCommand("git add -A")).toEqual([])
  })

  it("install con -o --output sí extrae el flag de salida como cierto", () => {
    const out = analyzeShellCommand("pip install --target site-packages pdfminer-six")
    expect(out.some((t) => t.target === "site-packages" && !t.uncertain)).toBe(true)
  })
})
