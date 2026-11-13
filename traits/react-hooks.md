# React (hooks)

Cuándo aplica: el repo trae `react` y `@testing-library/react` o `vitest` con entorno jsdom.

Reglas operativas:
- Componentes puros: estado derivado, no efectos que duplican estado.
- `useMemo`/`useCallback` solo cuando hay costo medible o dependencia de children.
- `key={id}` estable, nunca index en listas dinámicas.
- Accesibilidad básica: labels asociadas, focus visible, `aria-live` para feedback.
- Tests: `@testing-library/react` con `userEvent`, no clicks crudos.
- Nada de `var(--theme)` en inline styles: tokens del theme a CSS Modules o variables globales.
