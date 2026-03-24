export interface TierConfig {
  name: string;
  monthlyDebates: number;
  overageCost: number; // per debate over the limit, 0 = blocked
  unlimited: boolean;
}

export const TIERS: Record<string, TierConfig> = {
  free: {
    name: 'Free',
    monthlyDebates: 4, // ~1 per week
    overageCost: 0,
    unlimited: false,
  },
  pro: {
    name: 'Pro',
    monthlyDebates: 20,
    overageCost: 0.80,
    unlimited: false,
  },
  enterprise: {
    name: 'Enterprise',
    monthlyDebates: Infinity,
    overageCost: 0,
    unlimited: true,
  },
};

// Hardcoded enterprise users
const ENTERPRISE_EMAILS = ['alvin.kerremans@gmail.com'];

export function getTierForEmail(email: string, plan?: string): TierConfig {
  if (ENTERPRISE_EMAILS.includes(email)) {
    return TIERS.enterprise;
  }
  return TIERS[plan || 'free'] || TIERS.free;
}

export interface UsageCheck {
  allowed: boolean;
  remaining: number;
  limit: number;
  tier: TierConfig;
  isOverage: boolean;
  overageCost: number;
}

export function checkUsage(
  email: string,
  plan: string,
  debatesUsed: number,
): UsageCheck {
  const tier = getTierForEmail(email, plan);

  if (tier.unlimited) {
    return {
      allowed: true,
      remaining: Infinity,
      limit: Infinity,
      tier,
      isOverage: false,
      overageCost: 0,
    };
  }

  const remaining = Math.max(0, tier.monthlyDebates - debatesUsed);
  const isOverage = debatesUsed >= tier.monthlyDebates;

  // Pro users can go over at $0.80/debate. Free users are blocked.
  const allowed = !isOverage || tier.overageCost > 0;
  const overageCost = isOverage ? tier.overageCost : 0;

  return { allowed, remaining, limit: tier.monthlyDebates, tier, isOverage, overageCost };
}
