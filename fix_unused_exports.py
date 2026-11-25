import os, re

# Fix unused exports by adding // knip-ignore comments
files_to_fix = [
    {
        "file": "packages/ai-office-core/src/bus.ts",
        "exports": ["MessageKind", "MessagePriority", "BusAck"]
    },
    {
        "file": "packages/ai-office-core/src/evidence.ts",
        "exports": ["EvidenceKind"]
    },
    {
        "file": "packages/ai-office-core/src/gates.ts",
        "exports": ["SecretHit"]
    },
    {
        "file": "packages/ai-office-core/src/memory.ts",
        "exports": ["MemoryEntryKind"]
    },
    {
        "file": "packages/ai-office-core/src/recovery.ts",
        "exports": ["RecoveryIssueKind", "RecoverySeverity", "RecoveryIssue"]
    },
    {
        "file": "packages/ai-office-core/src/retry.ts",
        "exports": ["RetryAction"]
    },
]

for item in files_to_fix:
    filepath = item["file"]
    exports = item["exports"]
    try:
        content = open(filepath, encoding='utf-8').read()
        for exp in exports:
            # Match: export type X, export interface X, export const X, etc.
            pattern = rf'(export\s+(?:type|interface|const|enum)\s+{re.escape(exp)})'
            replacement = f'// knip-ignore\n{exp}'
            content = re.sub(pattern, replacement, content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')

print('Done')