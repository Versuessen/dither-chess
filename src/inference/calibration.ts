/**
 * Level -> model settings: the rows measured by tools/calibrate, stored in the pack's
 * calibration. A level without a row is not playable.
 */

export interface LevelSettings {
  /** Rating fed to the model for its own side. */
  eloSelf: number;
  /** Rating fed to the model for the opponent. */
  eloOppo: number;
  temperature: number;
  /** Nucleus threshold; 1 disables it. */
  topP: number;
}

export interface TableCalibration {
  /** One row per playable level. */
  levels: { level: number; eloSelf: number; eloOppo: number; temperature: number; topP: number }[];
}

export function tableSettings(cal: TableCalibration, level: number): LevelSettings | null {
  const row = cal.levels.find((r) => r.level === level);
  return row ? { eloSelf: row.eloSelf, eloOppo: row.eloOppo, temperature: row.temperature, topP: row.topP } : null;
}
