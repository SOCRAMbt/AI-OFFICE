import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const MARKERS = [".git", "package.json", "pyproject.toml", "go.mod", "Cargo.toml", ".oficina"];

export class ProjectRootError extends Error {}

/**
 * Orden: raíz explícita -> worktree de git del host -> ancestro con marcador.
 * Fail-closed si la raíz termina siendo el home o la raíz del disco.
 */
export function resolveProjectRoot(opts: {
  explicit?: string;
  worktree?: string;
  directory: string;
}): string {
  const candidates = [opts.explicit, opts.worktree, findMarkedAncestor(opts.directory)];
  for (const c of candidates) {
    if (!c) continue;
    const abs = path.resolve(c);
    if (isUnsafeRoot(abs)) continue;
    return abs;
  }
  throw new ProjectRootError(
    `[OFICINA] No encontré un proyecto en ${opts.directory}. ` +
      `Abrí el agente dentro de la carpeta del repo, o pasá root: "<ruta del repo>" a oficina_plan.`,
  );
}

function findMarkedAncestor(dir: string): string | undefined {
  let cur = path.resolve(dir);
  while (true) {
    if (!isUnsafeRoot(cur) && MARKERS.some((m) => existsSync(path.join(cur, m)))) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return undefined;
    cur = parent;
  }
}

function isUnsafeRoot(p: string): boolean {
  const n = path.resolve(p).toLowerCase();
  return (
    n === path.resolve(os.homedir()).toLowerCase() ||
    n === path.parse(n).root.toLowerCase()
  );
}
