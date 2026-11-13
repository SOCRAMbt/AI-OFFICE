# Docs en Markdown

Cuándo aplica: el repo/isor manuales usa Markdown, sin build step.

Reglas operativas:
- Todas las docs viven en `docs/` y se referencian desde el README índice.
- Fechas y versiones siempre actuales; nada de "456 tests" si hoy son 490. El resto de los datos volátiles vive en `docs:sync` o en archivos `catalog-facts.json`.
- Enlaces relativos al repo; paths con `/` (nunca backslashes) para portabilidad.
- Snippets de código tienen lengua especificada; bloques de salida de terminal son verbatim.
- Una regla por línea en la medida de lo posible: Grepa/Diffeaable.
- Sin contenido histórico muerto: archivar o borrar, nunca "duplicado y viejo".
