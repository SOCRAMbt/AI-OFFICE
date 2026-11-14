/**
 * OfficeFactory y multi-instancia por directorio (multi-ventana).
 *
 * Cubre los dos huecos de v3.2.3 en modo multi-ventana:
 * 1. una oficina por directorio (aislamiento de experiencias / estado)
 * 2. la fábrica propaga spawner+catalog desde el host (no arranca sin ellas)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { Office } from "../src/core/office.js";
import { OfficeFactory } from "../src/core/officeFactory.js";
import { scanCatalog } from "../src/core/catalog.js";
import { buildTools, type OficinaTool } from "../src/tools/index.js";
import { DEFAULT_LIMITS } from "../src/core/types.js";

let tmpBase: string;
let tmpA: string;
let tmpB: string;

const miniCatalog = async (rootDir: string) => {
  const dir = path.join(rootDir, "agency", "engineering");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, "frontend-developer.md"),
    [
      "---",
      "name: Frontend Developer",
      "description: React and CSS specialist",
      "vibe: Pixel obsessive.",
      "---",
      "",
      "# Frontend Developer Agent Personality",
      "",
      "## Critical Rules You Must Follow",
      "",
      "1. Never ship without a test.",
      "",
    ].join("\n"),
  );
  return scanCatalog({ root: path.join(rootDir, "agency") });
};

beforeEach(async () => {
  tmpBase = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-base-"));
  tmpA = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-a-"));
  tmpB = await fs.mkdtemp(path.join(os.tmpdir(), "oficina-b-"));
  for (const d of [tmpBase, tmpA, tmpB]) {
    await fs.writeFile(path.join(d, "package.json"), JSON.stringify({ name: "demo", scripts: { test: "true" } }));
  }
});
afterEach(async () => {
  await fs.rm(tmpBase, { recursive: true, force: true });
  await fs.rm(tmpA, { recursive: true, force: true });
  await fs.rm(tmpB, { recursive: true, force: true });
});

describe("OfficeFactory por directorio", () => {

  it("cachea la misma Office para el mismo directorio", () => {
    const factory = new OfficeFactory();
    const a = factory.get(tmpA);
    expect(factory.get(tmpA)).toBe(a);
  });

  it("crea oficinas distintas para directorios distintos", async () => {
    const factory = new OfficeFactory();
    expect(factory.get(tmpA)).not.toBe(factory.get(tmpB));
    expect(factory.size()).toBe(2);
  });

  it("dos oficinas no comparten estado entre sí", async () => {
    const factory = new OfficeFactory();
    const a = factory.get(tmpA);
    const b = factory.get(tmpB);
    await a.init();
    await b.init();
    const stateA = await a.loadState("Proyecto A");
    const stateB = await b.loadState("Proyecto B");
    expect(stateA.objective).not.toBe(stateB.objective);
  });

  it("propaga el limits del host a todas las oficinas", () => {
    const limits = { ...DEFAULT_LIMITS, maxConcurrentAgents: 3 };
    const factory = new OfficeFactory({ limits });
    expect(factory.get(tmpA).limits).toBe(limits);
    expect(factory.get(tmpB).limits).toBe(limits);
  });
});

describe("Tools resuelven la oficina por ctx.directory (ventana/hueco)", () => {
  it("oficina_plan llamada con directory=tmpA escribe estado en tmpA, no en el base", async () => {
    const catalog = await miniCatalog(tmpA);
    const factory = new OfficeFactory({ catalog });
    const baseOffice = new Office({ cwd: tmpBase, limits: DEFAULT_LIMITS, catalog });
    await baseOffice.init();

    const tools: Record<string, OficinaTool> = buildTools(baseOffice, {
      getOffice: (dir) => factory.get(dir),
    });
    const ctxA = { directory: tmpA, sessionID: "s-a", agent: "command", messageID: "m1" };
    const result = await tools["oficina_plan"]!.execute(
      {
        objective: "Proyecto A separado",
        cards: [
          {
            title: "A1", type: "implementation", requiredCapabilities: [],
            scope: { mayTouch: ["**"], forbidden: [] },
            acceptance: ["a1"], gate: "npm test",
          },
        ],
      },
      ctxA,
    );

    const artifactA = path.join(tmpA, ".oficina", "state.json");
    const artifactBase = path.join(tmpBase, ".oficina", "state.json");
    const stA = JSON.parse(await fs.readFile(artifactA, "utf8"));
    expect(stA.objective).toBe("Proyecto A separado");
    expect(result.output).toContain("Plan guardado");

    // La oficina base no se contamina con el objetivo del otro directorio.
    const stBase = JSON.parse(await fs.readFile(artifactBase, "utf8").catch(() => "{}"));
    expect(stBase.objective ?? "").not.toBe("Proyecto A separado");
  });
});
