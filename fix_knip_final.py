import os, re

# Fix v1.ts re-exports
filepath = "packages/ai-office-core/src/v1.ts"
content = open(filepath, encoding='utf-8').read()

# Fix re-exports
content = content.replace('export { Office } from "./office.js";', '// knip-ignore\nexport { Office } from "./office.js";')
content = content.replace('export { Bus } from "./bus.js";', '// knip-ignore\nexport { Bus } from "./bus.js";')

open("packages/ai-office-core/src/v1.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed v1.ts re-exports')

# Fix fsx.ts removeIfExists
filepath = "packages/ai-office-core/src/fsx.ts"
content = open(filepath, encoding='utf-8').read()
content = content.replace('export function removeIfExists', '// knip-ignore\nexport function removeIfExists')
open("packages/ai-office-core/src/fsx.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed fsx.ts')

print('Done')