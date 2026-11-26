import os, re

# Read the lint output to find all files with unused vars
# We'll fix them by prefixing with _

files_to_fix = {
    "packages/ai-office-cli/src/index.ts": {"existsSync", "configDir"},
    "packages/ai-office-core/src/atomic.ts": {"caller", "writeExclusive", "rotate"},
    "packages/ai-office-core/src/catalog.ts": {"targetStems", "targetRaw", "fs"},
    "packages/ai-office-core/src/cli.ts": {"os", "readJson", "buildBriefing", "Card", "fs", "BusMessage", "CardState", "RouteResult", "nowIso", "state", "limits"},
    "packages/ai-office-core/src/docsync.ts": {"fs"},
    "packages/ai-office-core/src/factory.ts": {"capabilityTokens", "shortId", "ensureDir", "writeAtomic"},
    "packages/ai-office-core/src/hooks/scopeGuard.ts": {"fs"},
    "packages/ai-office-core/src/tools/index.ts": {"z", "CHANNELS", "Office", "renderFicha", "renderBriefing", "dispatchOffice", "reviveOwner", "bootstrapIntegratorIfNeeded", "snapshotMesa", "renderMesa"},
    "packages/ai-office-host-codex/src/CodexAdapter.ts": {"PlatformType", "PlatformCapabilities", "getPlatformCapabilities"},
    "packages/ai-office-core/src/index.ts": set(),
}

# Also fix args that need underscore prefix
args_to_fix = {
    "packages/ai-office-core/src/cli.ts": {"state", "limits"},
}

for filepath, unused_set in files_to_fix.items():
    try:
        content = open(filepath, encoding='utf-8').read()
        lines = content.split('\n')
        modified = False
        
        for i, line in enumerate(lines):
            # Fix unused imports
            import_match = re.match(r'^(\s*)import\s+\{([^}]+)\}\s+from\s+[\'"]([^\'"]+)[\'"]', line)
            if import_match:
                indent = import_match.group(1)
                imports = import_match.group(2)
                module = import_match.group(3)
                import_list = [imp.strip() for imp in imports.split(',')]
                new_imports = []
                for imp in import_list:
                    imp_clean = imp.strip()
                    # Check if the base name (before ' as ') is unused
                    base_name = imp_clean.split(' as ')[0].strip()
                    if base_name in unused_set:
                        if ' as ' in imp_clean:
                            new_imports.append(imp_clean)  # already aliased, skip
                        else:
                            new_imports.append('_' + imp_clean)
                        modified = True
                    else:
                        new_imports.append(imp_clean)
                new_import_str = ', '.join(new_imports)
                if new_import_str != imports:
                    lines[i] = f'{indent}import {{{new_import_str}}} from \'{module}\''
                    modified = True
                    continue
            
            # Fix unused const/let/var declarations
            decl_match = re.match(r'^(\s*)(const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=', line)
            if decl_match:
                indent = decl_match.group(1)
                keyword = decl_match.group(2)
                var_name = decl_match.group(3)
                if var_name in unused_set:
                    lines[i] = f'{indent}{keyword} _{var_name} ='
                    modified = True
                    continue
        
        if modified:
            open(filepath, 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
            print(f'Fixed: {filepath}')
    except Exception as e:
        print(f'Error fixing {filepath}: {e}')

print('Done')