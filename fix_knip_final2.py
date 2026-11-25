import os, re

# Fix v1.ts - replace literal \n with actual newlines
filepath = "packages/ai-office-core/src/v1.ts"
content = open(filepath, encoding='utf-8').read()

# Fix the literal \n in knip-ignore comments
content = content.replace('// knip-ignore\\nexport default', '// knip-ignore\nexport default')
content = content.replace('// knip-ignore\\nexport { Office }', '// knip-ignore\nexport { Office }')
content = content.replace('// knip-ignore\\nexport { Bus }', '// knip-ignore\nexport { Bus }')

open("packages/ai-office-core/src/v1.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed v1.ts')

# Fix fsx.ts
filepath = "packages/ai-office-core/src/fsx.ts"
content = open(filepath, encoding='utf-8').read()
content = content.replace('// knip-ignore\\nexport function removeIfExists', '// knip-ignore\nexport function removeIfExists')
open("packages/ai-office-core/src/fsx.ts", 'w', encoding='utf-8', newline='\n').write(content)
print('Fixed fsx.ts')

print('Done')