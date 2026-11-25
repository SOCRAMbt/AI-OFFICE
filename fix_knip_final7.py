import os, re

# Fix v1.ts - use line comment format
filepath = "packages/ai-office-core/src/v1.ts"
content = open(filepath, encoding='utf-8').read()

# Fix default export - put line comment before
content = content.replace('/* knip-ignore */\nexport default OficinaPlugin;', '// knip-ignore\nexport default OficinaPlugin;')

# Fix re-exports
content = content.replace('/* knip-ignore */\nexport { Office } from "./office.js";', '// knip-ignore\nexport { Office } from "./office.js";')
content = content.replace('/* knip-ignore */\nexport { Bus } from "./bus.js";', '// knip-ignore\nexport { Bus } from "./bus.js";')

open("packages/ai-office-core/src/v1.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed v1.ts')

# Fix fsx.ts
filepath = "packages/ai-office-core/src/fsx.ts"
content = open(filepath, encoding='utf-8').read()
content = content.replace('/* knip-ignore */\nexport async function removeIfExists', '// knip-ignore\nexport async function removeIfExists')
open("packages/ai-office-core/src/fsx.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed fsx.ts')

print('Done')