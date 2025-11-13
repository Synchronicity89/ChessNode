# Long-Running Concerns

This document is a living log of architectural and test-impact considerations that may require gradual refactoring over time. It is intended to guide incremental updates without blocking feature work.

## Ragged Search Depths (variable line lengths)

Context: The evaluation now specifies general search rules that cause some lines to be extended (checks, material swings/trades) and others to be cut short (threefold repetition). As a result, explored lines in the search tree will often have different lengths.

Implications and guidance:
- Alpha–beta and PV: Ensure the search operates correctly with node-level extensions and cutoffs, not assuming a uniform ply limit. Extensions should be local (per-node) and can stack (e.g., check extension followed by a material-swing extension).
- Reporting: Include both the configured depth and the actual explored plies for each candidate line in JSON for transparency.
- Testing: Prefer assertions on ordering/relative scores and structural properties (e.g., presence of a recapture) over strict, uniform ply counts. When a test must constrain depth, pin the configuration to disable extensions or account for them explicitly.
- UI: Explorer/Play panels should be tolerant of variable-length PVs. Consider showing a per-line “actual plies” metric.
- Repetition handling: Implement line-internal threefold repetition detection as a local cutoff and, separately, recognize full-game threefold repetition as a draw state during gameplay.

Incremental plan:
1. Add metadata to engine JSON: per-child actualPlies, continuationReasons (e.g., ["checkExtension","materialSwing"]).
2. Update tests to accept ragged lines where appropriate, focusing on rankings rather than depth.
3. Refactor alpha–beta and move generation layers to apply extensions as local depth increments without duplicating logic.
4. Align diagnostic CLIs with engine-side orientation and extension rules to avoid mismatches during debugging.

This section will be expanded as we adopt additional extensions (e.g., passed-pawn races) or termination rules (e.g., 50-move rule) that affect line length.
