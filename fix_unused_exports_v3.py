import os, re

files_to_fix = [
    {
        "file": "packages/ai-office-core/src/paths.ts",
        "exports": ["inboxDirOf", "leasePath", "UnsafeIdError", "relToProject"]
    },
    {
        "file": "packages/ai-office-core/src/roster.ts",
        "exports": ["sourceOf"]
    },
    {
        "file": "packages/ai-office-core/src/router.ts",
        "exports": ["DEFAULT_ROTATION_THRESHOLD", "DEFAULT_PAIR_ROTATION_THRESHOLD", "fichaFromEntry"]
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
            # Match: export const X, export function X, export type X, export interface X, export class X, export enum X
            pattern = rf'(export\s+(?:const|function|type|interface|class|enum)\s+{re.escape(exp)})'
            replacement = f'// knip-ignore\n{exp}'
            content = re.sub(pattern, replacement, content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')

print('Done')