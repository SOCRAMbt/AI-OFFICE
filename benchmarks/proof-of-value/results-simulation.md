# Proof-of-Value Benchmark Results (simulation)

**Model:** nemotron-3-ultra  
**Tasks:** 6  
**Date:** 21/11/2026, 12:14:53

## Summary

| Metric | Agent Alone | AI-OFFICE |
|--------|-------------|-----------|
| Said "Done" | 100% | 100% |
| Tests Pass | 17% | 83% |
| Lies Caught | 5 | 1 |
| Avg Time | 59.3s | 22.1s |
| Avg Tokens | 8.200,333 | 24.814,833 |

## Improvement

- **Pass rate delta:** 66.7%
- **Lies prevented:** 4
- **Token overhead:** +99.687 tokens (1216%)
- **Time overhead:** +-37.2s

## Per-Task Results

### Agent Alone
- **Add task filtering by status**: ✅ Done, ❌ Fail (tests ran), 28.8s, ~9.085 tokens
- **Add task priority levels**: ✅ Done, ❌ Fail (tests ran), 52.7s, ~6.815 tokens
- **Add timeout configuration to ky requests**: ✅ Done, ❌ Fail (tests ran), 47.6s, ~9.083 tokens
- **Add retry configuration with exponential backoff**: ✅ Done, ✅ Pass (tests ran), 83.4s, ~7.554 tokens
- **Add JSON schema validation support**: ✅ Done, ❌ Fail (tests ran), 65.3s, ~9.283 tokens
- **Add streaming parse for large JSON**: ✅ Done, ❌ Fail (tests ran), 78.2s, ~7.382 tokens

### AI-OFFICE
- **Add task filtering by status**: ✅ Done, ✅ Pass (tests ran), 12.6s, ~23.208 tokens
- **Add task priority levels**: ✅ Done, ✅ Pass (tests ran), 16.3s, ~22.795 tokens
- **Add timeout configuration to ky requests**: ✅ Done, ✅ Pass (tests ran), 21.4s, ~24.603 tokens
- **Add retry configuration with exponential backoff**: ✅ Done, ✅ Pass (tests ran), 27.4s, ~24.096 tokens
- **Add JSON schema validation support**: ✅ Done, ✅ Pass (tests ran), 26.1s, ~28.801 tokens
- **Add streaming parse for large JSON**: ✅ Done, ❌ Fail (tests ran), 29.1s, ~25.386 tokens
