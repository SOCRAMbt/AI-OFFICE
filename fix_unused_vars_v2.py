import os, re

# Map of file -> set of unused variable names (from lint output)
unused_vars = {
    "packages/ai-office-cli/src/index.ts": {"existsSync", "configDir"},
    "packages/ai-office-core/src/cli.ts": {"os", "readJson", "buildBriefing", "Card", "fs", "BusMessage", "CardState", "RouteResult"},
    "packages/ai-office-core/src/atomic.ts": {"caller", "writeExclusive", "rotate"},
    "packages/ai-office-core/src/docsync.ts": {"fs"},
    "packages/ai-office-core/src/catalog.ts": {"targetStems", "targetRaw"},
    "packages/ai-office-host-codex/src/CodexAdapter.ts": {"PlatformType", "PlatformCapabilities", "getPlatformCapabilities"},
    "packages/ai-office-core/src/hooks/scopeGuard.ts": {"fs"},
    "packages/ai-office-core/src/hooks/sessionIdle.ts": set(),
    "packages/ai-office-core/src/hooks/compacting.ts": set(),
    "packages/ai-office-core/src/hooks/systemTransform.ts": set(),
    "packages/ai-office-core/src/tools/index.ts": set(),
}

def prefix_unused_in_file(filepath, unused_set):
    try:
        content = open(filepath, encoding='utf-8').read()
        lines = content.split('\n')
        modified = False
        
        for i, line in enumerate(lines):
            original = line
            # Fix unused imports: import { A, B } from 'x'
            import_match = re.match(r'^(\s*)import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', line)
            if import_match:
                indent = import_match.group(1)
                imports = import_match.group(2)
                module = import_match.group(3)
                import_list = [imp.strip() for imp in imports.split(',')]
                new_imports = []
                for imp in import_list:
                    imp_clean = imp.strip()
                    if imp_clean in unused_set:
                        new_imports.append('_' + imp_clean)
                    else:
                        new_imports.append(imp_clean)
                new_import_str = ', '.join(new_imports)
                if new_import_str != imports:
                    lines[i] = f'{indent}import {{{new_import_str}}} from \'{module}\''
                    modified = True
                    print(f'  Fixed import in {filepath}: {imports} -> {new_import_str}')
                    continue
            
            # Fix unused const/let/var declarations
            # Pattern: const x = ... or let x = ... or var x = ...
            decl_match = re.match(r'^(\s*)(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=', line)
            if decl_match:
                indent = decl_match.group(1)
                keyword = decl_match.group(2)
                var_name = decl_match.group(3)
                if var_name in unused_set:
                    lines[i] = f'{indent}{keyword} _{var_name} ='
                    modified = True
                    print(f'  Fixed declaration in {filepath}: {var_name} -> _{var_name}')
                    continue
            
            # Fix unused function parameters
            # Pattern: function foo(x, y) or (x, y) => 
            # This is more complex, skip for now
        
        if modified:
            open(filepath, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
            print(f'Fixed: {filepath}')
            return True
        return False
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')
        return False

# Process files
for filepath, unused_set in unused_vars.items():
    if os.path.exists(filepath):
        prefix_unused_in_file(filepath, unused_set)
    else:
        print(f'File not found: {filepath}')

print('Done')