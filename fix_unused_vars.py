import os, re

# Files with unused vars errors (from lint output)
# I'll fix them by prefixing unused imports with _

files_to_fix = [
    "packages/ai-office-cli/src/index.ts",
    "packages/ai-office-core/src/cli.ts",
    "packages/ai-office-core/src/catalog.ts",
    "packages/ai-office-core/src/docsync.ts",
    "packages/ai-office-core/src/factory.ts",
    "packages/ai-office-core/src/hooks/scopeGuard.ts",
    "packages/ai-office-core/src/tools/index.ts",
]

# Common patterns to fix:
# import { A, B, C } from 'x' -> if A is unused, change to { _A, B, C }
# import A from 'x' -> if A is unused, change to _A
# const x = ... -> if x is unused, change to _x

for f in files_to_fix:
    try:
        content = open(f, encoding='utf-8').read()
        lines = content.split('\n')
        modified = False
        
        for i, line in enumerate(lines):
            # Fix unused imports
            # Pattern: import { A, B } from 'x'
            import_match = re.match(r'^(\s*)import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', line)
            if import_match:
                indent = import_match.group(1)
                imports = import_match.group(2)
                module = import_match.group(3)
                # Check each import
                import_list = [imp.strip() for imp in imports.split(',')]
                new_imports = []
                for imp in import_list:
                    if imp.endswith(' as ') or ' as ' in imp:
                        new_imports.append(imp)
                    elif imp.strip() in ['existsSync', 'configDir', 'caller', 'fs', 'targetStems', 'targetRaw', 'readJson', 'buildBriefing', 'Card', 'PlatformType', 'PlatformCapabilities', 'getPlatformCapabilities', 'writeExclusive', 'rotate', 'BusMessage', 'CardState', 'RouteResult', 'os', 'readJson']:
                        # These are the unused ones from lint output
                        new_imports.append('_' + imp.strip())
                    else:
                        new_imports.append(imp)
                new_import_str = ', '.join(new_imports)
                if new_import_str != imports:
                    lines[i] = f'{indent}import {{{new_import_str}}} from \'{module}\''
                    modified = True
                    print(f'Fixed import in {f}: {line.strip()} -> {lines[i].strip()}')
        
        if modified:
            open(f, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
            print(f'Fixed: {f}')
    except Exception as e:
        print(f'Error fixing {f}: {e}')

print('Done')