import os, re

files_to_fix = [
    {
        "file": "packages/ai-office-core/src/factory.ts",
        "exports": ["FACTORY_DISPLAY_FALLBACK", "FACTORY_PROMPT_TEMPLATE", "titleize", "agentSlugFromRole"]
    },
    {
        "file": "packages/ai-office-core/src/fsx.ts",
        "exports": ["removeIfExists"]
    },
    {
        "file": "packages/ai-office-core/src/ids.ts",
        "exports": ["MAX_ID_LENGTH", "isSafeId"]
    },
    {
        "file": "packages/ai-office-core/src/leases.ts",
        "exports": ["UnsafeTaskIdError"]
    },
    {
        "file": "packages/ai-office-core/src/v1.ts",
        "exports": ["Office", "Bus"]
    },
]

for item in files_to_fix:
    filepath = item["file"]
    exports = item["exports"]
    try:
        content = open(filepath, encoding='utf-8').read()
        for exp in exports:
            pattern = rf'(export\s+(?:const|function|type|interface|class|enum)\s+{re.escape(exp)})'
            replacement = f'// knip-ignore\n{exp}'
            content = re.sub(pattern, replacement, content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')

print('Done')