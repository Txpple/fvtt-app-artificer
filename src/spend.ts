// Session spend meter. Estimates only, from the published per-image prices; the API exposes no
// balance endpoint, so this is the best the server can report.

import { type ImageSize, PRICE, type Tier } from './gemini.js';

export interface SpendEntry {
  tool: string;
  tier: Tier;
  size: ImageSize;
  usd: number;
}

export class SpendMeter {
  private readonly entries: SpendEntry[] = [];

  estimate(tier: Tier, size: ImageSize): number {
    return PRICE[tier][size];
  }

  record(tool: string, tier: Tier, size: ImageSize): number {
    const usd = this.estimate(tier, size);
    this.entries.push({ tool, tier, size, usd });
    return usd;
  }

  get totalUsd(): number {
    return round(this.entries.reduce((a, e) => a + e.usd, 0));
  }

  get calls(): number {
    return this.entries.length;
  }

  summary(): { calls: number; estimatedUsd: number; byTier: Record<Tier, number> } {
    const byTier: Record<Tier, number> = { flash: 0, pro: 0 };
    for (const e of this.entries) byTier[e.tier] = round(byTier[e.tier] + e.usd);
    return { calls: this.calls, estimatedUsd: this.totalUsd, byTier };
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
