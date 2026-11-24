# Windows / PowerShell

Cuándo aplica: el host común es Windows (nuestro caso).

Reglas operativas:
- Rutas con espacios: SIEMPRE entre comillas dobles (`& "C:\ruta\file.ts"`).
- Separador de comandos: usar `;` en lugar de `&&` (PowerShell clásico no lo soporta). O ejecutar comandos separados en sesiones distintas.
- NUNCA `Set-Content -Encoding utf8` en PowerShell 5.1 para archivos que parsea JSON: escribe BOM y rompe `JSON.parse`.
- `C:\Users\...` en minúsculas, `AppData\Local\Temp\opencode` para temporales.
- `getf /usr/bin/…` puede no existir: usar `& where.exe <cmd>`.
- Preferir Bash (Git Bash) o Node para scripts que no son estrictamente de la session.
- `.git` en Windows: cuidado con `core.symlinks=false` y enlaces simbólicos.
