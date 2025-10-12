// src/lib/data.ts
export type HealthSnapshot = { steps: number; calories: number; sleepHrs: number; sparkline: number[] };
export type Rewards = { balance: number; earnedThisMonth: number };

export interface DataSource {
  getHealthSnapshot(pubkey: string): Promise<HealthSnapshot>;
  getRewards(pubkey: string): Promise<Rewards>;
}

// src/lib/data.ts
export const LocalDataSource = {
  async getHealthSnapshot(_userId: string) {
    // For now: return mock data so the UI works
    return {
      steps: 8456,
      calories: 1230,
      sleepHrs: 7.75,
      sparkline: [0.2, 0.35, 0.3, 0.6, 0.5, 0.7, 0.55, 0.62, 0.48, 0.72, 0.68],
    };
  },

  async getRewards(_userId: string) {
    return {
      balance: 1225,
      earnedThisMonth: 350,
    };
  },
};
