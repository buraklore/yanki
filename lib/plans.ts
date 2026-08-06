export type PlanKey = 'trial' | 'starter' | 'growth' | 'business' | 'agency';

export interface PlanLimits {
  label: string;
  prompts: number;
  competitors: number;
  runs: number;          // runs per prompt per engine
  auditsPerMonth: number;
  workspaces: number;
  dailyScan: boolean;
}

export const PLANS: Record<PlanKey, PlanLimits> = {
  trial:    { label: 'Trial',    prompts: 10,  competitors: 3,  runs: 3, auditsPerMonth: 3,   workspaces: 1,  dailyScan: false },
  starter:  { label: 'Starter',  prompts: 40,  competitors: 5,  runs: 3, auditsPerMonth: 10,  workspaces: 1,  dailyScan: false },
  growth:   { label: 'Growth',   prompts: 150, competitors: 15, runs: 5, auditsPerMonth: 30,  workspaces: 3,  dailyScan: true },
  business: { label: 'Business', prompts: 500, competitors: 50, runs: 5, auditsPerMonth: 100, workspaces: 10, dailyScan: true },
  agency:   { label: 'Agency',   prompts: 150, competitors: 50, runs: 5, auditsPerMonth: 200, workspaces: 25, dailyScan: true },
};

export const PLAN_RANK: Record<PlanKey, number> = {
  trial: 0, starter: 1, growth: 2, business: 3, agency: 3,
};

export function limits(plan: PlanKey): PlanLimits {
  return PLANS[plan] ?? PLANS.trial;
}
