export type TimerPhase = "Working" | "Break" | "Paused";
export type BreakStyle = "card" | "overlay";
export type Platform = "macos" | "windows" | "linux";

export interface AppSettings {
  work_duration_secs: number;
  break_duration_secs: number;
  break_style: BreakStyle;
  sound_enabled: boolean;
  strict_mode: boolean;
  show_floating_widget: boolean;
  idle_detection_enabled: boolean;
  idle_threshold_secs: number;
  defer_on_fullscreen: boolean;
  launch_at_login: boolean;
  eye_style: string;
  show_tray_timer: boolean;
  widget_pos?: [number, number] | null;
}

export type SettingsPatch = Partial<Omit<AppSettings, "widget_pos">>;

export interface DailyStats {
  date: string;
  breaks_completed: number;
  breaks_skipped: number;
}

export interface TimerSnapshot {
  phase: TimerPhase;
  elapsed_secs: number;
  total_secs: number;
  remaining_secs: number;
  progress: number;
  is_idle_paused: boolOrFalse;
  is_demo: boolean;
  settings_version: number;
  platform: Platform;
  settings: AppSettings;
  stats: DailyStats;
}

type boolOrFalse = boolean;
