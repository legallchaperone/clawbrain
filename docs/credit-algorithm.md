# Credit Assignment Algorithm

## Motivation

Standard memory systems rank retrieved memories by semantic similarity or recency. Neither signal captures actual utility — how much did retrieving this memory help the agent complete a task?

The `openclaw-memory-engine` tracks task outcomes and uses them to assign credit to the memories that were retrieved before success or failure. Over time, this signal produces a utility-weighted ranking that outperforms pure semantic or recency-based approaches.

## The Credit Scoring Model

Every memory has a **credit score** $s \in [0, 1]$ initialized to 0.5 (neutral).

### Outcome Detection

After each agent turn, the system infers an outcome from available signals:

| Signal | Detection | Reward |
|--------|-----------|--------|
| Task completed | Tool calls succeeded + agent response contains completion indicators | +0.5 |
| Positive user feedback | "thanks", "perfect", "great", "exactly", etc. | up to +0.3 |
| Tool success | ≥50% of tool calls succeeded | +0.1 |
| User correction | "no I meant", "that's wrong", "try again", etc. | −0.4 |
| Session abandoned | Abrupt session end after retrieval | −0.2 |
| Productive continuation | User continues conversation without correction | +0.1 |

The combined scalar reward $r \in [-1, 1]$:

$$r = \text{clamp}\bigl(0.5 \cdot \mathbb{1}[\text{completed}] + 0.3 \cdot \text{satisfaction} + 0.1 \cdot \mathbb{1}[\text{tool\_ok}] - 0.4 \cdot \mathbb{1}[\text{correction}] - 0.2 \cdot \mathbb{1}[\text{abandoned}] + 0.1 \cdot \mathbb{1}[\text{continued}], -1, 1\bigr)$$

### Credit Sharing

When $n$ memories are retrieved in the same turn, each receives a share of the reward:

$$\delta_m = \frac{r}{\sqrt{n}}$$

Using $\sqrt{n}$ rather than $n$ prevents over-dilution: if 9 memories are retrieved and one is genuinely responsible for the success, that memory gets $r/3$ rather than $r/9$.

### Exponential Moving Average Update

Credit scores are updated via EMA with learning rate $\alpha$ (default: 0.1):

$$s_m \leftarrow \text{clamp}\bigl((1 - \alpha) \cdot s_m + \alpha \cdot \delta_m, 0, 1\bigr)$$

This produces a smooth credit signal that:
- Adapts quickly to consistent patterns (good memories keep scoring well)
- Is resistant to noise (one bad turn doesn't destroy a good memory's score)
- Has tunable sensitivity via $\alpha$

### Credit History

Every credit update is logged to SQLite with the full outcome and co-retrieved memory IDs. This enables:
- Debugging: inspect exactly which turns raised or lowered a memory's credit
- Cross-session analysis: understand which memory clusters co-occur
- Future work: counterfactual credit estimation using the co-retrieval graph

## Comparison to Alternatives

| Approach | Signal | Limitation |
|----------|--------|------------|
| Recency | Time since creation | Old memories may be very useful |
| Recall frequency | Times retrieved | Recalled often ≠ actually helpful |
| **Credit score** | Outcome after retrieval | Captures actual utility |

## Configuration

- `creditAlpha` (default: 0.1): learning rate. Lower = more stable but slower to adapt. Higher = adapts faster but noisier.
- `pruneThreshold` (default: 0.2): memories below this score are pruning candidates.
- `pruneMinAge` (default: 30 days): minimum age before a memory can be pruned.

## Open Research Questions

1. **Counterfactual estimation**: can we estimate what would have happened *without* the retrieved memory, for a cleaner credit signal?
2. **Cross-session propagation**: if a memory contributes to a task that completes in a later session, how do we propagate that credit back?
3. **Multi-agent credit**: in multi-agent setups, how should credit transfer when memory is shared between agents?
4. **Online evaluation**: benchmark credit-scored retrieval against BM25+vector on a longitudinal task completion dataset.
