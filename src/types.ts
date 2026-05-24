// 공통 타입 정의. 모든 핸들러가 import.

export interface RunCtx {
  input: { tool: string; args: Record<string, any> };
  secrets: Record<string, string>;
  data: {
    get(key: string): Promise<any>;
    set(key: string, value: any): Promise<void>;
    delete(key: string): Promise<boolean>;
    // 플랫폼 contract: list 결과는 value 까지 포함. list → 각 key get 의 N+1 패턴 금지.
    list(prefix?: string, limit?: number): Promise<{ key: string; value: any; updated_at: string }[]>;
  };
}

// ───── 운동 ─────
export type Equipment = 'smith' | 'barbell' | 'dumbbell' | 'machine' | 'bodyweight' | 'cardio';

export interface SetEntry {
  weight_kg?: number;
  reps?: number;
  rir?: number;
  duration_min?: number;
  distance_km?: number;
}

export interface Exercise {
  name: string;
  equipment?: Equipment;
  sets: SetEntry[];
}

export interface Pain {
  site: string;
  severity: number;
  note?: string;
}

export interface Session {
  id: string;
  date: string;
  exercises: Exercise[];
  pain?: Pain;
  condition?: number;
  note?: string;
  created_at: string;
}

// ───── 체중 ─────
export type WeightContext = 'fasted' | 'postmeal' | 'postworkout' | 'unknown';

export interface WeightEntry {
  date: string;
  time?: string;
  weight_kg: number;
  measurement_context: WeightContext;
  note?: string;
  created_at: string;
}

// ───── InBody ─────
export interface InBodyEntry {
  date: string;
  weight_kg: number;
  skeletal_muscle_kg: number;
  body_fat_kg: number;
  body_fat_pct: number;
  bmr_kcal: number;
  visceral_fat_level?: number;
  bmi?: number;
  note?: string;
  created_at: string;
}

// ───── 혈액검사 ─────
export interface BloodPanel {
  date: string;
  ldl_mg_dl?: number;
  hdl_mg_dl?: number;
  total_cholesterol_mg_dl?: number;
  triglycerides_mg_dl?: number;
  uric_acid_mg_dl?: number;
  vitamin_d_ng_ml?: number;
  fasting_glucose_mg_dl?: number;
  hba1c_pct?: number;
  note?: string;
  created_at: string;
}

// ───── 식단 ─────
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type MealSource = 'user_text' | 'photo_confirmed' | 'ai_recommended_consumed';

export interface MealItem {
  name: string;
  estimated_kcal?: number;
  protein_g?: number;
  portion_note?: string;
}

export interface Meal {
  id: string;
  date: string;
  slot: MealSlot;
  items: MealItem[];
  source: MealSource;
  recipe_ref?: string;
  total_kcal_estimated?: number;
  note?: string;
  created_at: string;
}

// ───── 레시피 ─────
export interface Recipe {
  id: string;
  date: string;
  name: string;
  cuisine?: string;
  source_url: string;
  ingredients?: string[];
  primary_protein_g?: number;
  estimated_kcal?: number;
  ldl_friendly?: boolean;
  rationale?: string;
  created_at: string;
}

// ───── 부상 ─────
export interface InjuryRecord {
  site: string;
  started: string;
  recovered?: string;
  notes?: string;
}

// ───── 영양제 / 약 (정기 복용 스케줄) ─────
//
// 데이터 키:
//   supplement:{slug}                — 정의 (고유, upsert)
//   intake:{date}:{slug}:{HHMM}      — 실제 복용 기록 (한 슬롯 = 한 row)
//
// slug 는 영문 snake_case (예: 'vitamin_d', 'omega3', 'magnesium_glycinate').
// schedule_times 길이 = times_per_day. 각 시간은 "HH:MM" 24시간.
// every_n_days = 1 매일, 2 격일, 7 주 1회. start_date 부터 계산.
export interface SupplementSchedule {
  slug: string;
  display_name: string;
  times_per_day: number;
  schedule_times: string[];
  every_n_days?: number;
  with_meal?: boolean;
  start_date?: string;
  end_date?: string;
  dose_note?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface SupplementIntake {
  slug: string;
  date: string;
  slot: string;
  taken_at: string;
  note?: string;
  created_at: string;
}

export interface Settings {
  target_weight_min: number;
  target_weight_max: number;
  target_weight_rule: 'always_in_range' | 'fasted_only' | 'daily_average';
  activity_factor: number;
  pr_squat_kg: number;
  pr_bench_press_kg: number;
  pr_shoulder_press_kg: number;
  pr_deadlift_kg: number;
  four_goals: string[];
  next_blood_panel_target: string;
  timezone: string;
  supplement_window_minutes: number;
}
