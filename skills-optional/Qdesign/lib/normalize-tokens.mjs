'use strict';

/**
 * Converts hexadecimal color to OKLCH color space
 * @param {string} hex - Hex color code (e.g., "#FF0000")
 * @returns {string} OKLCH formatted string (e.g., "oklch(0.65 0.15 250)")
 */
function hexToOklch(hex) {
  // Normalize hex
  const h = hex.replace('#', '').toLowerCase();
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;

  // sRGB → linear RGB (gamma decode)
  const lin = (c) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  const lr = lin(r);
  const lg = lin(g);
  const lb = lin(b);

  // linear RGB → XYZ
  const x = lr * 0.4124564 + lg * 0.3575761 + lb * 0.1804375;
  const y = lr * 0.2126729 + lg * 0.7151522 + lb * 0.0721750;
  const z = lr * 0.0193339 + lg * 0.1191920 + lb * 0.9503041;

  // XYZ → Oklab
  const l_ = Math.cbrt(x * 0.8189330101 + y * 0.3618667424 + z * -0.1288597137);
  const m_ = Math.cbrt(x * 0.0329845436 + y * 0.9293118715 + z * 0.0361456387);
  const s_ = Math.cbrt(x * 0.0482003018 + y * 0.2643662691 + z * 0.6338517070);

  const l = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_;
  const b_ = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_;

  // Oklab → OKLCH
  const c = Math.sqrt(a * a + b_ * b_);
  let h_ = Math.atan2(b_, a) * (180 / Math.PI);
  if (h_ < 0) h_ += 360;

  return `oklch(${l.toFixed(3)} ${c.toFixed(3)} ${h_.toFixed(0)})`;
}

/**
 * Detects if a color is neutral (low saturation)
 * @param {string} oklch - OKLCH color string
 * @returns {boolean}
 */
function isNeutral(oklch) {
  const match = oklch.match(/oklch\(([\d.]+)\s+([\d.]+)\s+([\d.]+)\)/);
  if (!match) return false;
  const c = parseFloat(match[2]);
  return c < 0.03;
}

/**
 * Extracts lightness from OKLCH string
 * @param {string} oklch - OKLCH color string
 * @returns {number}
 */
function getLightness(oklch) {
  const match = oklch.match(/oklch\(([\d.]+)\s+/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Extracts hue from OKLCH string
 * @param {string} oklch - OKLCH color string
 * @returns {number}
 */
function getHue(oklch) {
  const match = oklch.match(/oklch\([^)]*\s+([\d.]+)\)$/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Classifies a hue angle into semantic color type
 * @param {number} hue - Hue in degrees (0-360)
 * @returns {string|null}
 */
function classifyHue(hue) {
  // Normalize hue to 0-360
  const h = ((hue % 360) + 360) % 360;

  // Green (100-150): success
  if (h >= 100 && h < 150) return 'success';
  // Yellow/Orange (30-60): warning
  if (h >= 30 && h < 60) return 'warning';
  // Red (0-20, 340-360): error
  if (h >= 0 && h < 20) return 'error';
  if (h >= 340) return 'error';
  // Blue (200-260): info
  if (h >= 200 && h < 260) return 'info';

  return null;
}

/**
 * Normalizes raw extracted CSS colors into semantic design tokens
 * @param {Object} rawColors - Raw color data from extract-styles
 * @returns {Object} Normalized color tokens
 */
export function normalizeColors(rawColors) {
  const result = {
    brand: { primary: null, secondary: null, accent: null },
    neutrals: {},
    semantic: {
      success: null,
      warning: null,
      error: null,
      info: null,
    },
  };

  if (!rawColors || typeof rawColors !== 'object') {
    return result;
  }

  // Convert all colors to OKLCH and categorize
  // Accepts both array format [{ value, count }] (from extract-styles) and
  // flat object format { hex: count }
  const colorMap = {};
  if (Array.isArray(rawColors)) {
    rawColors.forEach(({ value, count }) => {
      if (typeof value !== 'string' || !value.startsWith('#')) return;
      const oklch = hexToOklch(value);
      colorMap[value] = { oklch, count: count || 1, isNeutralColor: isNeutral(oklch) };
    });
  } else {
    Object.entries(rawColors).forEach(([hex, count]) => {
      if (typeof hex !== 'string' || !hex.startsWith('#')) return;
      const oklch = hexToOklch(hex);
      colorMap[hex] = { oklch, count, isNeutralColor: isNeutral(oklch) };
    });
  }

  // Separate neutrals and chromatic colors
  const neutrals = [];
  const chromatic = [];

  Object.entries(colorMap).forEach(([hex, data]) => {
    if (data.isNeutralColor) {
      neutrals.push({ hex, ...data });
    } else {
      chromatic.push({ hex, ...data });
    }
  });

  // Brand colors: top 3 chromatic by frequency
  chromatic.sort((a, b) => b.count - a.count);
  if (chromatic.length > 0) {
    result.brand.primary = { hex: chromatic[0].hex, oklch: chromatic[0].oklch };
  }
  if (chromatic.length > 1) {
    result.brand.secondary = { hex: chromatic[1].hex, oklch: chromatic[1].oklch };
  }
  if (chromatic.length > 2) {
    result.brand.accent = { hex: chromatic[2].hex, oklch: chromatic[2].oklch };
  }

  // Semantic colors: classify by hue
  chromatic.forEach(({ hex, oklch }) => {
    const hue = getHue(oklch);
    const semantic = classifyHue(hue);
    if (semantic && !result.semantic[semantic]) {
      result.semantic[semantic] = { hex, oklch };
    }
  });

  // Neutral scale: sort by lightness, map to 50-950
  neutrals.sort((a, b) => getLightness(a.oklch) - getLightness(b.oklch));
  const standardScales = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950];

  if (neutrals.length > 0) {
    const step = (standardScales.length - 1) / (neutrals.length - 1 || 1);
    neutrals.forEach((neutral, idx) => {
      const scaleIdx = Math.round(idx * step);
      const scale = standardScales[scaleIdx];
      result.neutrals[scale] = { hex: neutral.hex, oklch: neutral.oklch };
    });
  }

  return result;
}

/**
 * Normalizes raw typography data into semantic tokens
 * @param {Object} rawTypography - Raw typography data from extract-styles
 * @returns {Object} Normalized typography tokens
 */
export function normalizeTypography(rawTypography) {
  const result = {
    families: {
      headings: null,
      body: null,
      mono: null,
    },
    scale: {
      xs: '12px',
      sm: '14px',
      base: '16px',
      lg: '18px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '30px',
      '4xl': '36px',
      '5xl': '48px',
    },
    blacklistWarnings: [],
  };

  if (!rawTypography || typeof rawTypography !== 'object') {
    return result;
  }

  // Extract families
  const familyFrequency = {};
  const headingFamilies = {};
  const bodyFamilies = {};

  if (rawTypography.families && Array.isArray(rawTypography.families)) {
    rawTypography.families.forEach((entry) => {
      // Accept both { family, count } and { value, count } formats
      const family = entry.family || entry.value;
      const count = entry.count || 1;
      if (!family) return;
      familyFrequency[family] = familyFrequency[family] || 0;
      familyFrequency[family] += count;
      if (entry.headings) headingFamilies[family] = (headingFamilies[family] || 0) + entry.headings;
      if (entry.body) bodyFamilies[family] = (bodyFamilies[family] || 0) + entry.body;
    });
  }

  // Blacklist check
  const blacklist = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Arial'];
  Object.keys(familyFrequency).forEach((family) => {
    if (blacklist.some(b => family.includes(b))) {
      result.blacklistWarnings.push(`${family} detected — blacklisted by Qdesign`);
    }
  });

  // Sort families by frequency
  const sortedFamilies = Object.entries(familyFrequency).sort((a, b) => b[1] - a[1]);

  // Classify families
  if (sortedFamilies.length > 0) {
    result.families.body = { value: sortedFamilies[0][0], source: 'most-used-overall' };
  }

  // Detect mono
  sortedFamilies.forEach(([family]) => {
    if (!result.families.mono && (family.toLowerCase().includes('monospace') || family.toLowerCase().includes('mono') || family.includes('Consolas') || family.includes('Menlo') || family.includes('Monaco') || family.includes('JetBrains'))) {
      result.families.mono = { value: family, source: 'detected-monospace' };
    }
  });

  // Detect headings
  if (Object.keys(headingFamilies).length > 0) {
    const sortedHeadings = Object.entries(headingFamilies).sort((a, b) => b[1] - a[1]);
    result.families.headings = { value: sortedHeadings[0][0], source: 'most-used-in-headings' };
  } else if (sortedFamilies.length > 1) {
    result.families.headings = { value: sortedFamilies[1][0], source: 'most-used-in-headings' };
  } else if (sortedFamilies.length > 0) {
    result.families.headings = { value: sortedFamilies[0][0], source: 'most-used-overall' };
  }

  // Process scale
  const sizes = [];
  if (rawTypography.sizes && Array.isArray(rawTypography.sizes)) {
    rawTypography.sizes.forEach((entry) => {
      // Accept both { size } and { value } formats
      const size = entry.size || entry.value;
      const num = parseInt(size);
      if (!isNaN(num)) sizes.push(num);
    });
  }

  // Map sizes to scale
  const scaleMap = {
    xs: [10, 12],
    sm: [13, 14],
    base: [15, 16],
    lg: [17, 19],
    xl: [20, 22],
    '2xl': [23, 26],
    '3xl': [27, 32],
    '4xl': [33, 40],
    '5xl': [41, Infinity],
  };

  const detected = [];
  sizes.forEach((size) => {
    let mapped = 'base';
    Object.entries(scaleMap).forEach(([scale, [min, max]]) => {
      if (size >= min && size <= max) {
        mapped = scale;
      }
    });
    detected.push({ raw: `${size}px`, normalized: `${mapped} (${result.scale[mapped]})`, count: 1 });
  });

  result.detected = detected;

  return result;
}

/**
 * Normalizes raw spacing data into semantic tokens
 * @param {Object} rawSpacing - Raw spacing data from extract-styles
 * @returns {Object} Normalized spacing tokens
 */
export function normalizeSpacing(rawSpacing) {
  const baseUnit = '4px';
  const scale = {
    0: '0px',
    1: '4px',
    2: '8px',
    3: '12px',
    4: '16px',
    5: '20px',
    6: '24px',
    8: '32px',
    10: '40px',
    12: '48px',
    16: '64px',
    20: '80px',
    24: '96px',
  };

  const detected = [];

  if (rawSpacing && Array.isArray(rawSpacing)) {
    rawSpacing.forEach(({ value, count }) => {
      const num = parseInt(value);
      if (isNaN(num)) return;

      // Round to nearest 4px multiple
      const rounded = Math.round(num / 4) * 4;
      const normalized = scale[rounded / 4] || `${rounded}px`;

      detected.push({
        raw: value,
        normalized: `${rounded}px (scale ${rounded / 4})`,
        count: count || 1,
      });
    });
  }

  return { baseUnit, scale, detected };
}

/**
 * Normalizes raw border radius data into semantic tokens
 * @param {Object} rawRadius - Raw border radius data from extract-styles
 * @returns {Object} Normalized border radius tokens
 */
export function normalizeBorderRadius(rawRadius) {
  const scale = {
    none: '0px',
    sm: '4px',
    md: '8px',
    lg: '12px',
    xl: '16px',
    full: '9999px',
  };

  const detected = [];
  const radiusMap = {
    none: [0, 0],
    sm: [1, 5],
    md: [6, 10],
    lg: [11, 15],
    xl: [16, 49],
    full: [50, 9999],
  };

  if (rawRadius && Array.isArray(rawRadius)) {
    rawRadius.forEach(({ value, count }) => {
      const num = parseInt(value);
      if (isNaN(num)) return;

      let normalized = 'md';
      Object.entries(radiusMap).forEach(([key, [min, max]]) => {
        if (num >= min && num <= max) {
          normalized = key;
        }
      });

      detected.push({
        raw: value,
        normalized: `${normalized} (${scale[normalized]})`,
        count: count || 1,
      });
    });
  }

  return { scale, detected };
}

/**
 * Normalizes raw shadow data into semantic tokens
 * @param {Object} rawShadows - Raw shadow data from extract-styles
 * @returns {Object} Normalized shadow tokens
 */
export function normalizeShadows(rawShadows) {
  const scale = {
    sm: '0 1px 2px rgba(0,0,0,0.05)',
    md: '0 4px 6px rgba(0,0,0,0.1)',
    lg: '0 10px 15px rgba(0,0,0,0.1)',
    xl: '0 20px 25px rgba(0,0,0,0.15)',
  };

  const detected = [];
  const shadowTiers = { sm: [], md: [], lg: [], xl: [] };

  if (rawShadows && Array.isArray(rawShadows)) {
    rawShadows.forEach((entry) => {
      // Accept both { shadow, count } and { value, count } formats
      const shadow = entry.shadow || entry.value;
      const count = entry.count;
      if (typeof shadow !== 'string') return;

      // Parse box-shadow: extract blur+spread
      const parts = shadow.split(' ');
      let blurSpread = 0;
      parts.forEach((part, idx) => {
        const num = parseInt(part);
        if (!isNaN(num) && idx >= 2) blurSpread += Math.abs(num);
      });

      let tier = 'md';
      if (blurSpread <= 4) tier = 'sm';
      else if (blurSpread <= 12) tier = 'md';
      else if (blurSpread <= 24) tier = 'lg';
      else tier = 'xl';

      shadowTiers[tier].push({ shadow, count: count || 1 });
      detected.push({ raw: shadow, normalized: tier, count: count || 1 });
    });
  }

  // Pick representative shadow for each tier
  Object.keys(shadowTiers).forEach((tier) => {
    if (shadowTiers[tier].length > 0) {
      const representative = shadowTiers[tier].reduce((a, b) => (b.count > a.count ? b : a));
      scale[tier] = representative.shadow;
    }
  });

  return { scale, detected };
}

/**
 * Normalizes raw motion data into semantic tokens
 * @param {Object} rawMotion - Raw motion data from extract-styles
 * @returns {Object} Normalized motion tokens
 */
export function normalizeMotion(rawMotion) {
  const result = {
    durations: {
      fast: '100ms',
      normal: '200ms',
      slow: '400ms',
    },
    easings: {
      default: 'cubic-bezier(0.4, 0, 0.2, 1)',
      enter: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      exit: 'cubic-bezier(0.4, 0, 1, 1)',
    },
    detected: {
      durations: [],
      easings: [],
    },
  };

  if (!rawMotion || typeof rawMotion !== 'object') {
    return result;
  }

  // Process durations
  const durationsMs = [];
  if (rawMotion.durations && Array.isArray(rawMotion.durations)) {
    rawMotion.durations.forEach((entry) => {
      // Accept both { duration, count } and { value, count } formats
      const duration = entry.duration || entry.value;
      const count = entry.count;
      const ms = parseInt(duration);
      if (!isNaN(ms)) {
        for (let i = 0; i < (count || 1); i++) {
          durationsMs.push(ms);
        }
      }
    });
  }

  if (durationsMs.length > 0) {
    durationsMs.sort((a, b) => a - b);
    const fastVals = durationsMs.filter(d => d <= 150);
    const normalVals = durationsMs.filter(d => d > 150 && d <= 350);
    const slowVals = durationsMs.filter(d => d > 350);

    if (fastVals.length > 0) {
      const median = fastVals[Math.floor(fastVals.length / 2)];
      result.durations.fast = `${median}ms`;
      result.detected.durations.push({ raw: `${median}ms`, tier: 'fast', count: fastVals.length });
    }
    if (normalVals.length > 0) {
      const median = normalVals[Math.floor(normalVals.length / 2)];
      result.durations.normal = `${median}ms`;
      result.detected.durations.push({ raw: `${median}ms`, tier: 'normal', count: normalVals.length });
    }
    if (slowVals.length > 0) {
      const median = slowVals[Math.floor(slowVals.length / 2)];
      result.durations.slow = `${median}ms`;
      result.detected.durations.push({ raw: `${median}ms`, tier: 'slow', count: slowVals.length });
    }
  }

  // Process easings
  const easingFreq = {};
  if (rawMotion.easings && Array.isArray(rawMotion.easings)) {
    rawMotion.easings.forEach((entry) => {
      // Accept both { easing, count } and { value, count } formats
      const easing = entry.easing || entry.value;
      const count = entry.count;
      if (!easing) return;
      easingFreq[easing] = (easingFreq[easing] || 0) + (count || 1);
    });
  }

  const sortedEasings = Object.entries(easingFreq).sort((a, b) => b[1] - a[1]);
  if (sortedEasings.length > 0) {
    result.easings.default = sortedEasings[0][0];
  }
  result.detected.easings = sortedEasings.map(([easing, count]) => ({ easing, count }));

  return result;
}

/**
 * Normalizes all raw extracted CSS data into semantic design tokens
 * @param {Object} extractedData - Complete extracted data object from extract-styles.js
 * @returns {Object} Combined normalized design tokens
 */
export function normalizeAll(extractedData) {
  return {
    colors: normalizeColors(extractedData?.colors),
    typography: normalizeTypography(extractedData?.typography),
    spacing: normalizeSpacing(extractedData?.spacing),
    borderRadius: normalizeBorderRadius(extractedData?.borderRadius),
    shadows: normalizeShadows(extractedData?.shadows),
    motion: normalizeMotion(extractedData?.motion),
    profile: extractedData?.profile,
  };
}
