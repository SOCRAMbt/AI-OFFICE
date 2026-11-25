import os, re

# Fix v1.ts - put knip-ignore on same line as export
filepath = "packages/ai-office-core/src/v1.ts"
content = open(filepath, encoding='utf-8').read()

# Fix default export
content = content.replace('// knip-ignore\nexport default OficinaPlugin;', 'export default OficinaPlugin; // knip-ignore')

# Fix re-exports
content = content.replace('// knip-ignore\nexport { Office } from "./office.js";', 'export { Office } from "./office.js"; // knip-ignore')
content = content.replace('// knip-ignore\nexport { Bus } from "./bus.js";', 'export { Bus } from "./bus.js"; // knip-ignore')

open("packages/ai-office-core/src/v1.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed v1.ts')

# Fix fsx.ts
filepath = "packages/ai-office-core/src/fsx.ts"
content = open(filepath, encoding='utf-8').read()
content = content.replace('export async function removeIfExists', 'export async function removeIfExists // knip-ignore')
open("packages/ai-office-core/src/fsx.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed fsx.ts')

print('Done')