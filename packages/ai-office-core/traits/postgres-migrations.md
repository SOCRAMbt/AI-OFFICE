# Postgres migrations

Cuándo aplica: el repo declara dependencias `pg`, `postgres`, `drizzle-orm` o `prisma` apuntando a Postgres.

Reglas operativas:
- Toda migración va acompañada de rollback o up/down explícito. Nada "forward-only" sin justificar en el handoff.
- Las migraciones son idempotentes respecto al schema actual; `IF NOT EXISTS` o checks de `information_schema`.
- NUNCA `DROP TABLE`/`TRUNCATE` en una migración sin acción explícita del usuario.
- Cambios en `NOT NULL` sobre columnas existentes: backfill primero, constraint después.
- Índices en columnas usadas por queries reales (miden planner, no intuición).
- Constraints y políticas de seguridad prueban los tres backends: apply, reapply, rollback.
