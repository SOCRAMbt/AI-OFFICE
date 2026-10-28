# Desarrollando AI-OFFICE

## Setup rápido

```bash
git clone https://github.com/SOCRAMbt/AI-OFFICE.git
cd AI-OFFICE
npm ci
npm run build
npm test
```

## Comandos útiles

| Comando | Qué hace |
|---------|----------|
| `npm run typecheck` | TypeScript strict mode |
| `npm test` | 444 tests (27 suites) |
| `npm run build` | Compila a `dist/` |
| `npm run docs:check` | Verifica sincronía docs ↔ código |
| `npm run bench:selection` | Benchmark del matcher de agentes |
| `npm run coverage` | Cobertura (solo Ubuntu Node 24) |

## Estructura clave

```
src/
├── v2.ts              # Entry point OpenCode v2 (principal)
├── v1.ts              # Entry point legacy OpenCode v1
├── cli.ts             # CLI `oficina`
├── core/
│   ├── sandbox.ts     # Resolución de paths + scope (P0 Windows 8.3)
│   ├── scopeGuard.ts  # Hook enforcement de scope (fail-closed)
│   ├── tripwire.ts    # Detección post-comando (incomplete reporting)
│   ├── office.ts      # Fachada principal
│   ├── paths.ts       # Fallback .oficina/ global (colisión possible)
│   └── ...
├── hooks/
│   └── scopeGuard.ts  # createScopeGuardHook + resolveScopeCard
└── tools/             # 16 tools oficina_*
```

## Tests nuevos (hardening P1/P2)

| Archivo | Qué prueba |
|---------|------------|
| `tests/scopeGuard.test.ts` | Fail-closed en loadState/parent resolution falla |
| `tests/tripwire.test.ts` | Incomplete inspection reporting (truncated, errors) |
| `tests/sandbox-83.test.ts` | Windows 8.3 alias handling (GitHub Actions) |

## Flujo de trabajo

1. **Branch** desde `main`
2. **Cambios mínimos** + tests de regresión
3. `npm run typecheck && npm test && npm run build && npm run docs:check`
4. **PR** con descripción del defecto + fix + tests
5. CI matrix: Ubuntu/Windows × Node 22/24 + docs + smoke + install-verify

## Benchmark de selección (reproducible)

```bash
git clone --depth 1 https://github.com/msitarzewski/agency-agents.git ../agency-agents
AGENCY_ROOT=../agency-agents npm run bench:selection
```

- Catálogo fijado en `benchmarks/selection/RESULTADOS.md` (fingerprint SHA-256)
- 21 tareas, 258 agentes, 18 divisiones
- Target: hit@1 ≥ 60%, completo > keywords

## Debugging local

```bash
# Ver tráfico GitHub (requiere GH_TOKEN con scope repo)
GH_TOKEN=xxx node -e "
  const r = await fetch('https://api.github.com/repos/SOCRAMbt/AI-OFFICE/traffic/views', {headers:{Authorization:'Bearer '+process.env.GH_TOKEN}});
  console.log(await r.json());
"
```

## Convenciones

- **Fail-closed**: errores de verificación = bloqueo (no warning silencioso)
- **No secrets en logs**: tripwire redacts valores sensibles
- **Idempotencia**: `writeAtomic` + `safeId` + locks de directorio
- **Evidencia > narrativa**: tests adversariales, no happy paths

## Áreas pendientes (P2)

- [ ] Paths fallback collision (hash canónico en `src/core/paths.ts`)
- [ ] State corruption recovery (distinguir JSON corrupto vs esquema desconocido)
- [ ] Benchmark dataset inmutable (fijar commit agency-agents en CI)
- [ ] Security.md policy