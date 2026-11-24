# TypeScript (strict)

Cuándo aplica: el repo tiene `tsconfig.json` con `"strict": true` o equivalente.

Reglas operativas:
- `Unknown` donde modeleás externos; castear solo con una guarda o un tipo brand.
- Nunca `any` para cerrar el loop: `unknown` + narrowing.
- `readonly` por defecto en propiedades que no mutan.
- Cada función exportada necesita firma explícita de retorno.
- `exactOptionalPropertyTypes`: `string | undefined` es distinto de opcional.
- Falla son test + typecheck: si no compila en strict, no hay "hecho".
