
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface Lab {
  l: number;
  a: number;
  b: number;
}

export interface ColorData {
  hex: string;
  rgb: RGB;
  lab: Lab;
  avgRgb: RGB;
}

export interface ComparisonMetrics {
  dA: number;
  dB: number;
  towardA: number;
  towardB: number;
  separation: number;
  separationLabel: string;
}

export interface ComparisonRecord {
  id: string;
  timestamp: number;
  lastCheckedAt?: number;
  title: string;
  refA: { name: string; color: ColorData };
  refB: { name: string; color: ColorData };
  sample: ColorData;
  metrics: ComparisonMetrics;
  previousMetrics?: ComparisonMetrics;
  notes: string;
  feedback: 'liked' | 'disliked' | null;
  thumbnail: string; // base64 resized
}
