# Vitest (testing)

Cuándo aplica: el repo tiene `vitest` en devDependencies o test script `vitest run`.

Reglas operativas:
- Tests deterministas: nada de Date.now/Math.random sin inyectar o mofkear.
- `beforeEach`/`afterEach` limpian tempdirs bajo `os.tmpdir()`. Nunca tocar el repo real.
- Concurrencia real: `Promise.all` sobre la operación, no asserts secuenciales pretendiendo que prueban race conditions.
- Fixtures de secretos falsos: construirlos con concatenación (`FAKE_ + "SK_LIVE"`) para que los scanners no den alarma.
- Assertions semánticas: no copies strings exactos de mensajes de error si el motor los reescribe.
- Cobertura de invariantes antes que del happy path.
