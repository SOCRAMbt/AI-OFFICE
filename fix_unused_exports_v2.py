import os, re

files_to_fix = [
    {
        "file": "packages/ai-office-core/src/state.ts",
        "exports": ["RUN_TRANSITIONS", "canTransitionRun", "blockingCards"]
    },
    {
        "file": "packages/ai-office-core/src/stores.ts",
        "exports": ["evidenceOptions"]
    },
    {
        "file": "packages/ai-office-core/src/v1.ts",
        "exports": ["Office", "Bus"]
    },
    {
        "file": "packages/ai-office-core/src/briefing.ts",
        "exports": ["BriefingSectionId", "BriefingSection", "BriefingArtifact"]
    },
]

for item in files_to_fix:
    filepath = item["file"]
    exports = item["exports"]
    try:
        content = open(filepath, encoding='utf-8').read()
        for exp in exports:
            # Match: export const X, export function X, export type X, export interface X, etc.
            pattern = rf'(export\s+(?:const|function|type|interface|enum|class)\s+{re.escape(exp)})'
            replacement = f'// knip-ignore\n{exp}'
            content = re.sub(pattern, replacement, content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')

print('Done')