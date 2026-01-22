
// Fixed: Added ColorData to the imported types from '../types'
import { RGB, Lab, ComparisonMetrics, ColorData } from '../types';

/**
 * Converts RGB to CIE Lab using sRGB D65 illuminant
 */
export const rgbToLab = (rgb: RGB): Lab => {
  let { r, g, b } = rgb;
  r /= 255; g /= 255; b /= 255;

  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  r *= 100; g *= 100; b *= 100;

  // D65 Illuminant
  const x = r * 0.4124 + g * 0.3576 + b * 0.1805;
  const y = r * 0.2126 + g * 0.7152 + b * 0.0722;
  const z = r * 0.0193 + g * 0.1192 + b * 0.9505;

  let xN = x / 95.047;
  let yN = y / 100.000;
  let zN = z / 108.883;

  xN = xN > 0.008856 ? Math.pow(xN, 1/3) : (7.787 * xN) + (16/116);
  yN = yN > 0.008856 ? Math.pow(yN, 1/3) : (7.787 * yN) + (16/116);
  zN = zN > 0.008856 ? Math.pow(zN, 1/3) : (7.787 * zN) + (16/116);

  return {
    l: (116 * yN) - 16,
    a: 500 * (xN - yN),
    b: 200 * (yN - zN)
  };
};

/**
 * Computes Delta E (CIE76) between two Lab colors.
 * DeltaE76 is the standard perceptual Euclidean distance.
 */
export const deltaE76 = (lab1: Lab, lab2: Lab): number => {
  return Math.sqrt(
    Math.pow(lab1.l - lab2.l, 2) +
    Math.pow(lab1.a - lab2.a, 2) +
    Math.pow(lab1.b - lab2.b, 2)
  );
};

// Fixed: Correctly using ColorData which is now imported
export const calculateMetrics = (sample: ColorData, refA: ColorData, refB: ColorData): ComparisonMetrics => {
  const dA = deltaE76(sample.lab, refA.lab);
  const dB = deltaE76(sample.lab, refB.lab);
  
  const totalDist = dA + dB;
  let towardA = 50;
  let towardB = 50;

  if (totalDist > 0) {
    towardA = (dB / totalDist) * 100;
    towardB = 100 - towardA; // Ensure 100% sum
  }
  
  const separation = totalDist === 0 ? 0 : (Math.abs(dA - dB) / totalDist) * 100;
  
  let separationLabel = 'Strong';
  if (separation < 5) separationLabel = 'Indistinguishable';
  else if (separation < 15) separationLabel = 'Weak';
  else if (separation < 30) separationLabel = 'Moderate';

  return { 
    dA, 
    dB, 
    towardA: Math.max(0, Math.min(100, towardA)), 
    towardB: Math.max(0, Math.min(100, towardB)), 
    separation, 
    separationLabel 
  };
};

export const rgbToHex = (rgb: RGB): string => {
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
};

export const getRepresentativeColor = (data: Uint8ClampedArray): { median: RGB, average: RGB } => {
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  let sumR = 0, sumG = 0, sumB = 0;

  for (let i = 0; i < data.length; i += 4) {
    rs.push(data[i]);
    gs.push(data[i + 1]);
    bs.push(data[i + 2]);
    sumR += data[i];
    sumG += data[i + 1];
    sumB += data[i + 2];
  }

  const median = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  const count = data.length / 4;

  return {
    median: { r: median(rs), g: median(gs), b: median(bs) },
    average: { r: sumR / count, g: sumG / count, b: sumB / count }
  };
};

/**
 * Creates a small thumbnail from a base64 image
 */
export const createThumbnail = async (base64: string, width: number = 256): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.src = base64;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = width / img.width;
      canvas.width = width;
      canvas.height = img.height * scale;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      } else {
        resolve(base64);
      }
    };
  });
};
