import os, re

# Files to update
test_files = [
    "packages/ai-office-core/tests/atomic-wx.test.ts",
    "packages/ai-office-core/tests/briefing.test.ts",
    "packages/ai-office-core/tests/bus.test.ts",
    "packages/ai-office-core/tests/catalog.test.ts",
    "packages/ai-office-core/tests/catalogReal.test.ts",
    "packages/ai-office-core/tests/childModel.test.ts",
    "packages/ai-office-core/tests/circuitBreaker.test.ts",
    "packages/ai-office-core/tests/coldStart.test.ts",
    "packages/ai-office-core/tests/concurrency.test.ts",
    "packages/ai-office-core/tests/dispatch.factory.test.ts",
    "packages/ai-office-core/tests/dispatch.test.ts",
    "packages/ai-office-core/tests/docsync.test.ts",
    "packages/ai-office-core/tests/evidence.test.ts",
    "packages/ai-office-core/tests/gates.test.ts",
    "packages/ai-office-core/tests/identity-security.test.ts",
    "packages/ai-office-core/tests/leases.test.ts",
    "packages/ai-office-core/tests/lite-mode.test.ts",
    "packages/ai-office-core/tests/match-threshold.test.ts",
    "packages/ai-office-core/tests/maxAgents.test.ts",
    "packages/ai-office-core/tests/memory.test.ts",
    "packages/ai-office-core/tests/migration.test.ts",
    "packages/ai-office-core/tests/office.test.ts",
    "packages/ai-office-core/tests/officeFactory.test.ts",
    "packages/ai-office-core/tests/phase1.test.ts",
    "packages/ai-office-core/tests/phase2.test.ts",
    "packages/ai-office-core/tests/phase4.test.ts",
    "packages/ai-office-core/tests/pluginV2.herencia.test.ts",
    "packages/ai-office-core/tests/pluginV2.scope.test.ts",
    "packages/ai-office-core/tests/protocol-fixes.test.ts",
    "packages/ai-office-core/tests/recovery.test.ts",
    "packages/ai-office-core/tests/router.test.ts",
    "packages/ai-office-core/tests/sandbox-83.test.ts",
    "packages/ai-office-core/tests/sandbox-shell-parser.test.ts",
    "packages/ai-office-core/tests/sandbox.canonicalizePhysical.test.ts",
    "packages/ai-office-core/tests/sandbox.test.ts",
    "packages/ai-office-core/tests/scopeGuard.test.ts",
    "packages/ai-office-core/tests/state.test.ts",
    "packages/ai-office-core/tests/systemPrompt.environment.test.ts",
    "packages/ai-office-core/tests/traits.test.ts",
    "packages/ai-office-core/tests/tripwire.test.ts",
]

non_test_files = [
    "packages/ai-office-core/src/cli.ts",
    "packages/ai-office-core/src/v1.ts",
    "packages/ai-office-core/src/hooks/compacting.ts",
    "packages/ai-office-core/src/hooks/scopeGuard.ts",
    "packages/ai-office-core/src/hooks/sessionIdle.ts",
    "packages/ai-office-core/src/hooks/systemTransform.ts",
    "packages/ai-office-core/src/tools/index.ts",
]

# Fix test files: ../src/core/ -> ../src/
for f in test_files:
    try:
        content = open(f, encoding='utf-8').read()
        new_content = content.replace('../src/core/', '../src/')
        if content != new_content:
            open(f, 'w', encoding='utf-8', newline='\n').write(new_content)
            print(f'Fixed test: {f}')
    except Exception as e:
        print(f'Error fixing {f}: {e}')

# Fix non-test files: ./core/ -> ./
for f in non_test_files:
    try:
        content = open(f, encoding='utf-8').read()
        new_content = content.replace('./core/', './')
        if content != new_content:
            open(f, 'w', encoding='utf-8', newline='\n').write(new_content)
            print(f'Fixed non-test: {f}')
    except Exception as e:
        print(f'Error fixing {f}: {e}')

print('Done')