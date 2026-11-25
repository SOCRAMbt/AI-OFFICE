import os, re

# Fix v1.ts - put knip-ignore on line before export
filepath = "packages/ai-office-core/src/v1.ts"
content = open(filepath, encoding='utf-8').read()

# Fix default export - put comment on line before
content = content.replace('export default OficinaPlugin; // knip-ignore', '// knip-ignore\nexport default OficinaPlugin;')
content = content.replace('export { Office } from "./office.js"; // knip-ignore', '// knip-ignore\nexport { Office } from "./office.js";')
content = content.replace('export { Bus } from "./bus.js"; // knip-ignore', '// knip-ignore\nexport { Bus } from "./bus.js";')

open("packages/ai-office-core/src/v1.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed v1.ts')

# Fix fsx.ts
filepath = "packages/ai-office-core/src/fsx.ts"
content = open(filepath, encoding='utf-8').read()
content = content.replace('export async function removeIfExists // knip-ignore', '// knip-ignore\nexport async function removeIfExists')
open("packages/ai-office-core/src/fsx.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed fsx.ts')

print('Done')