# Evaluation GUI Specification

This document defines the GUI-controllable parameters for orchestrating position and line evaluation. It is intended for developers building the evaluation controls and for users tuning the engine's behavior without changing core chess logic.

The evaluation combines base terms (material, tempo, etc.) with line-based incentives and risk-aware decision making. All values are white-centric centipawns unless noted. Defaults shown below can be adjusted in the GUI.

## Configuration schema (defaults)

```json
{
  "opponentPlyDepth": 4,
  "tradePlyDepthEquivalent": 0.5,
  "plyDepthRisk": {
    "type": "exponential",
    "kAt2x": 100
  },
  "centerPiecePlacementReward": 50,
  "endGameKingCenterMagnet": 15,
  "rankAttackFactor": 1.1,
  "developmentIncentive": 10,
  "notJustEmptySquaresThreatReward": true,
  "kingEngineValue": 7000,
  "kingOpponentValue": 5000
}
```

- opponentPlyDepth: starting estimate of how many ply equivalents the opponent can search (default 4). This may adapt based on observed opponent strength over time.
- tradePlyDepthEquivalent: per-ply equivalence factor when a line involves trades. Default 0.5 means one trade sequence counts as half the depth of a non-trade ply, allowing the assumption that opponents see deeper when trades simplify positions.
- plyDepthRisk: parameters for discounting risk when pushing beyond the estimated opponent depth (see formula below). kAt2x=100 means risk is 1/100 at 2× the estimated depth.
- centerPiecePlacementReward: reward per net engine piece placed on the 4 central squares (d4, e4, d5, e5) at the end of a line.
- endGameKingCenterMagnet: reward per square the engine king ends closer to the center; scaled by an endgamishness factor (see formula below).
- rankAttackFactor: multiplier by rank for rewarding control in the opponent’s half.
- developmentIncentive: base reward for net controlled squares in the opponent’s half; multiplied by rankAttackFactor^r.
- notJustEmptySquaresThreatReward: when true, the development reward also counts squares currently occupied by opponent pieces that are attacked by the engine.
- kingEngineValue, kingOpponentValue: centipawn values for each side's king used in expected value/mating assessments. Tunable for aggressive vs defensive styles.

## Control types and suggested ranges

- opponentPlyDepth: integer input or slider; typical range 0–12 (default 4).
- tradePlyDepthEquivalent: numeric input with step 0.1; range 0.0–1.0 (default 0.5).
- plyDepthRisk.type: select [exponential | logistic]. Default exponential.
  - For exponential: kAt2x numeric (10–1000), default 100.
  - For logistic: slope (1–10) and midpointMultiplier (1.0–2.0), defaults slope=5, midpointMultiplier=1.0.
- centerPiecePlacementReward: numeric input; 0–200 (default 50).
- endGameKingCenterMagnet: numeric input; 0–100 (default 15).
- rankAttackFactor: numeric input; 1.0–1.5 (default 1.1).
- developmentIncentive: numeric input; 0–50 (default 10).
- notJustEmptySquaresThreatReward: checkbox (default checked).
- kingEngineValue: numeric input; 1000–20000 (default 7000).
- kingOpponentValue: numeric input; 1000–20000 (default 5000).

## Concepts and derived quantities

### Ply-equivalent depth

We distinguish “actual plies” from “ply equivalents” to reflect that some lines are easier for opponents to see than others. A trade sequence is considered less complex per ply and thus counts less toward the opponent’s depth budget.

- For non-trade plies: each ply contributes 1.0 ply-equivalent.
- For trade plies: each ply contributes tradePlyDepthEquivalent (default 0.5) ply-equivalents.

Pseudocode for accumulating ply-equivalent depth along a line:

```
plyEq = 0
for each ply i in line:
  if isTradePly(i): plyEq += tradePlyDepthEquivalent
  else:            plyEq += 1.0
```

Note: “isTradePly(i)” is implementation-defined. A practical heuristic is that a capture followed by an equal-value recapture within the next 1–2 plies marks those plies as part of a trade sequence. More sophisticated detection can be added later.

### plyDepthRiskFunction

Purpose: discount the probability that the opponent will punish a risky line beyond their expected search depth. The function maps a ply-equivalent depth `d` to a risk multiplier in [0, 1].

We want risk to be near 1.0 around the estimated depth and close to 0.0 by 2× the estimate.

- Let D = opponentPlyDepth.
- Define x = max(0, d/D - 1).

Exponential form (default):

$$\mathrm{risk}(d) = \exp\big(-\ln(k) \cdot x\big)$$

- Here k = kAt2x (default 100), so at d = 2D (x = 1): risk(2D) = 1/k ≈ 0.01.
- At d = D (x = 0): risk(D) = 1.0 (no discount at the expected depth).
- Smoothly decays for d > D.

Optional logistic form:

$$\mathrm{risk}(d) = \frac{1}{1 + e^{s\,(d/(mD) - 1)}}$$

- s = slope (default 5), m = midpointMultiplier (default 1.0).
- risk(mD) ≈ 0.5; increasing s sharpens the transition.

### Endgamishness factor

The king-centering reward should be larger in endgames. Define an endgamishness scalar in [0, 1] based on the opponent’s remaining major/minor material.

- Count opponent minors (N+B), rooks (R), queens (Q).
- Weighted strength: `S = 3*(N+B) + 5*R + 9*Q`.
- Map S into [0, 1] endgamishness via linear remap with clamp:

$$\mathrm{endgamish}(S) = \mathrm{clamp}\left(\frac{T - S}{T - L},\ 0,\ 1\right)$$

Recommended parameters:
- T (typical midgame strength) = 31 (≈ 2R + 1Q + 2N + 2B).
- L ("few pieces" strength) = 6 (e.g., one rook or two minors).

Thus:
- At S ≥ T: endgamish ≈ 0 (full discount).
- At S ≤ L: endgamish ≈ 1 (full king-centering reward).

You can replace this with a smooth logistic mapping if preferred.

## Scoring components per line

Let a “line” be a sequence of moves and countermoves from a given FEN. Evaluate at the end of the line (or at intermediate points if desired) and combine components below.

1) Base evaluation
- Use the engine’s positional evaluation (e.g., material and other terms) for the final FEN.
- This document focuses on additional line-based incentives and risk adjustments.

2) Center piece placement
- Compute net delta in the number of engine pieces occupying the 4 central squares (d4, e4, d5, e5) comparing end-of-line vs start.
- Reward = centerPiecePlacementReward × netDelta.
- Exception: do not reward the engine king for occupying center unless endgamishness is significant; you may multiply the king’s contribution by endgamishness.

3) King centering (endgame magnet)
- Let distStart be the king’s Manhattan distance to the nearest central square at the start; distEnd at the end.
- Improvement = max(0, distStart − distEnd).
- Reward = endGameKingCenterMagnet × endgamishness × Improvement.

4) Development and forward control
- Identify squares controlled by the engine in the opponent’s half. For each controlled square s, compute its forward rank depth r (1 for the first rank into opponent territory, 2 for the next, etc.).
- Sum reward per unique controlled square:

  Reward_s = developmentIncentive × (rankAttackFactor)^r

- If notJustEmptySquaresThreatReward is true, count squares even when occupied by opponent pieces (threats); otherwise only empty squares.
- Use the net gain in such controlled squares from start to end of line.

5) Risk-aware gain vs loss beyond depth
- Let d_eq be the line’s ply-equivalent depth (see above).
- Let risk = plyDepthRiskFunction(d_eq).
- Estimate potentialLoss (e.g., worst plausible tactical refutation value) and potentialGain (e.g., material/positional edge realized by the line). These can be approximated from engine deltas or heuristics.
- Apply “calculated gamble” rule:

  - EffectiveGain = potentialGain × (1 − risk)
  - EffectiveLoss = potentialLoss × risk
  - LineRiskBonus = EffectiveGain − EffectiveLoss

- Intuition: As depth grows past D, we trust gains less and fear losses less, reflecting the belief that the opponent cannot fully refute very deep ideas. For equal magnitudes, safer lines near D will have small adjustments; deep speculative lines will be favored if their discounted expected value stays positive.

6) Mating value handling
- If a forced mate is proven within the line, apply a large but finite terminal value rather than an absurd score to avoid pathological gambling.
  - If engine mates: add +kingOpponentValue (optionally scaled by 1/(plyToMate+1)).
  - If engine is mated: subtract kingEngineValue (optionally scaled).
- These values are configurable to bias defensive vs aggressive play.

## Combined line score (illustrative)

At end of line:

```
Score(line) = BaseEval(finalFEN)
            + CenterPlacementReward
            + KingCenterReward
            + DevelopmentReward
            + LineRiskBonus
```

- BaseEval(finalFEN) comes from the core evaluation terms (outside the scope of this doc).
- The risk component adjusts for opponent depth beyond `opponentPlyDepth` using the selected risk function.

## UI/UX guidance

- Persist settings (e.g., in localStorage + cookie) and allow quick reset to defaults.
- Group controls under sections: Opponent Model, Board Geometry Rewards, Development, King and Mate Values, Risk Model.
- Show inline help tooltips explaining each control and its default.
- When Greedy 1-ply is active, these settings directly influence the engine’s move choice.

## Example

- opponentPlyDepth = 4, tradePlyDepthEquivalent = 0.5
- A tactical line goes 8 actual plies with two trade plies:
  - plyEq = 6 × 1.0 + 2 × 0.5 = 7.0
  - D = 4 ⇒ d/D = 1.75 ⇒ x = 0.75
  - risk = exp(−ln(100) × 0.75) ≈ 0.056
- If potentialGain = 150 cp and potentialLoss = 100 cp:
  - EffectiveGain ≈ 150 × (1 − 0.056) ≈ 142 cp
  - EffectiveLoss ≈ 100 × 0.056 ≈ 6 cp
  - LineRiskBonus ≈ +136 cp
- Deep but favorable lines are encouraged; shallow risky lines will be penalized when risk is larger.

---

This specification is intentionally modular. Future terms (mobility, pawn structure, king safety) can be added with independent weights and switches without changing the existing GUI contract.

## Atomic GUI control requirement (per-operation knobs)

To enable fine-grained orchestration, every individual mathematical operation that affects a line’s score must have an associated GUI control. This includes, but is not limited to:

- Additions and subtractions (component mixing, offsets)
- Multiplications and divisions (scaling, normalizations)
- Exponentiation and roots (non-linear scalings like rankAttackFactor^r)
- Min/max and clamps (caps, floors, saturations)
- Blends and convex combinations (weighted mixtures, e.g., gain/loss blending)

This requirement means that each formula term above is backed by one or more tunables so users can “open up” or “dial back” parts of the math without changing code. Defaults should recover the behavior described earlier. The set of controls may evolve iteratively; when a new operation is introduced in the evaluation pipeline, add a corresponding control with a neutral default.

### Operation-to-control mapping (baseline)

Below is a non-exhaustive mapping of the formulas in this document to atomic controls. Names are suggestions; actual IDs may follow the project’s naming conventions.

1) Center piece placement
- centerPiecePlacementReward: multiplier for netDelta (existing)
- centerPieceWeights.{p,n,b,r,q,k}: optional per-piece multipliers (default 1.0, with k likely 0 or scaled by endgamishness)
- centerPlacementOffset: additive offset before mixing into total (default 0)
- centerPlacementCap: clamp on absolute contribution (default disabled)

2) King centering (endgame magnet)
- endGameKingCenterMagnet: base multiplier (existing)
- endgamishnessPow: exponent applied to endgamishness before multiplication (default 1.0)
- kingCenterImprovementPow: exponent on Improvement (default 1.0)
- kingCenterOffset, kingCenterCap: additive offset and clamp (defaults 0, disabled)

3) Development and forward control
- developmentIncentive: base multiplier (existing)
- rankAttackFactor: exponential base (existing)
- developmentGamma: exponent on (rankAttackFactor^r) to shape growth (default 1.0)
- developmentOffset, developmentCap: additive offset and clamp (defaults 0, disabled)
- notJustEmptySquaresThreatReward: include occupied threat squares (existing)

4) Risk-aware gain vs loss beyond depth
- kAt2x / logistic parameters: shape of risk(d) (existing)
- riskPow: exponent on risk before use (default 1.0)
- gainScale: multiplier on potentialGain (default 1.0)
- lossScale: multiplier on potentialLoss (default 1.0)
- blendAlpha: mix ratio for gain vs loss in the final combination (default 1.0 for pure gain − loss)
  - Example: LineRiskBonus = gainScale·potentialGain·(1 − risk^riskPow) − (1 − blendAlpha)·lossScale·potentialLoss·(risk^riskPow)
- riskOffset, riskCap: additive offset and clamp to the risk contribution (defaults 0, disabled)

5) Endgamishness mapping
- pieceWeightMinor, pieceWeightRook, pieceWeightQueen: weights in S = 3*(N+B) + 5*R + 9*Q (defaults 3, 5, 9)
- T, L: thresholds for linear remap (existing recommendations)
- endgamishnessMin, endgamishnessMax: clamp bounds (defaults 0, 1)
- endgamishnessForm: select [linear | logistic], with logistic slope and midpoint controls

6) Component mixing and totals
- weightCenter, weightKingCenter, weightDevelopment, weightRisk: per-component mix weights in the final sum (defaults 1.0)
- totalOffset, totalCap: additive offset and clamp on the final score (defaults 0, disabled)

### Neutral defaults and iterative evolution

- All new knobs must ship with neutral defaults that preserve existing behavior (e.g., offsets 0, multiplicative scales 1.0, caps disabled, exponents 1.0).
- When introducing a new evaluation operation, add:
  1) A GUI control (or set) for that operation.
  2) A persisted config entry with a neutral default.
  3) A brief inline tooltip explaining its effect and safe ranges.
- If an operation is later removed or replaced, mark its control as deprecated but keep reading it for a deprecation window if feasible, to avoid breaking saved configurations.
