# polymarket-faa-attribution-02-entry

Forecast Polymarket's FAA outage attribution prices minute by minute, 4 hours ahead — an entry for [make.fun](https://make.fun/) competition `polymarket-faa-attribution-02`.

## What it does

`main.ts` (Node 22, standard library only, no network, deterministic) reads one case at a time — every trading market of the FAA outage attribution family, each with its Yes price at every minute of the 72 hours up to a checkpoint — and writes, for each market and each of the 240 minutes after the checkpoint, five quantiles (5%, 25%, 50%, 75%, 95%) of that minute's price.

## Model

- **Anchor:** each market's last price. The family's Yes prices are mutually exclusive outcomes, so they sum to ~1: the median is pulled toward the sum-consistent level `x / S` (strength 0.8, saturating with a 90-minute time constant).
- **Spread:** per-market sigma from the realised 1-minute volatility of the last 120 minutes, shrunk 90% toward a 0.0005 floor and capped at 0.008, growing like `h^0.4`. Quantiles are normal around the median, clamped to [0, 1], rounded to 6 decimals.
- **No jump-reversal, no trend term:** on the practice both hurt; the last price plus the sum-consistency pull is the honest median.

Local practice (cases p00–p04, truth = the next case's prices): mean pinball loss **0.2914** vs the house baseline's **0.3925** on the same cases (−26%), better on every case. Two runs produce byte-identical outputs; all six practice cases run in ~0.35 s total (limit 8 s per case).

## Run it

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Owner

- make.fun account: **Wedspierre**
- Referral code: `ta01qs0h`
