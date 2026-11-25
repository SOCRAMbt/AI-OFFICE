import os, re

# Remove all knip-ignore comments from source files
files_to_fix = [
    "packages/ai-office-core/src/v1.ts",
    "packages/ai-office-core/src/fsx.ts",
    "packages/ai-office-core/src/bus.ts",
    "packages/ai-office-core/src/evidence.ts",
    "packages/ai-office-core/src/gates.ts",
    "packages/ai-office-core/src/memory.ts",
    "packages/ai-office-core/src/recovery.ts",
    "packages/ai-office-core/src/retry.ts",
    "packages/ai-office-core/src/state.ts",
    "packages/ai-office-core/src/stores.ts",
    "packages/ai-office-core/src/briefing.ts",
    "packages/ai-office-core/src/paths.ts",
    "packages/ai-office-core/src/roster.ts",
    "packages/ai-office-core/src/router.ts",
    "packages/ai-office-core/src/factory.ts",
    "packages/ai-office-core/src/ids.ts",
    "packages/ai-office-core/src/leases.ts",
    "packages/ai-office-core/src/bootstrap.ts",
    "packages/ai-office-core/src/docsync.ts",
]

for filepath in files_to_fix:
    try:
        content = open(filepath, encoding='utf-8').read()
        # Remove all knip-ignore comments (both line and block)
        content = re.sub(r'// knip-ignore\n', '', content)
        content = re.sub(r'/\* knip-ignore \*/\n', '', content)
        content = re.sub(r'// knip-ignore$', '', content, flags=re.MULTILINE)
        content = re.sub(r'/\* knip-ignore \*/', '', content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Cleaned: {filepath}')
    except Exception as e:
        print(f'Error cleaning {filepath}: {e}')

# Also clean adapter files
adapters = ["claude-code", "codex", "cursor", "gemini", "grok", "opencode"]
for a in adapters:
    filepath = f"packages/ai-office-host-{a}/src/{a.capitalize()}Adapter.ts"
    try:
        content = open(filepath, encoding='utf-8').read()
        content = re.sub(r'// knip-ignore\n', '', content)
        content = re.sub(r'/\* knip-ignore \*/\n', '', content)
        open(filepath, 'w', encoding='utf-8', newline='\n').write(content)
        print(f'Cleaned adapter: {filepath}')
    except Exception as e:
        print(f'Error cleaning adapter {filepath}: {e}')

print('Done')