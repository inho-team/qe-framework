/**
 * extract-styles.js
 * Browser-side JavaScript (IIFE) for live design system extraction
 * Injects into webpage via Chrome MCP and returns computed style profiles
 */

(() => {
  try {
    // ============================================================================
    // 1. COLLECT VISIBLE ELEMENTS (capped at 300)
    // ============================================================================
    const allElements = document.querySelectorAll('*');
    const visibleElements = [];
    const MAX_ELEMENTS = 300;

    for (const el of allElements) {
      if (visibleElements.length >= MAX_ELEMENTS) break;

      // Check visibility: offsetParent not null (displayed) and not visibility:hidden
      if (el.offsetParent === null) continue;

      const computed = getComputedStyle(el);
      if (computed.visibility === 'hidden' || computed.display === 'none') continue;

      visibleElements.push(el);
    }

    // ============================================================================
    // 2. EXTRACT COMPUTED STYLES
    // ============================================================================
    const styleProperties = {
      colors: {},        // property -> [color values]
      typography: {
        families: {},
        sizes: {},
        weights: {},
        lineHeights: {},
        letterSpacing: {}
      },
      spacing: {},       // property -> [values]
      borderRadius: {},
      shadows: {},
      motion: {
        durations: {},
        easings: {}
      }
    };

    for (const el of visibleElements) {
      const computed = getComputedStyle(el);

      // --- Colors ---
      ['color', 'backgroundColor', 'borderColor'].forEach(prop => {
        const val = computed[prop];
        if (val && val !== 'rgba(0, 0, 0, 0)' && val !== 'transparent') {
          const normalized = normalizeColor(val);
          styleProperties.colors[prop] = styleProperties.colors[prop] || {};
          styleProperties.colors[prop][normalized] =
            (styleProperties.colors[prop][normalized] || 0) + 1;
        }
      });

      // --- Typography ---
      const fontFamily = computed.fontFamily;
      if (fontFamily) {
        styleProperties.typography.families[fontFamily] =
          (styleProperties.typography.families[fontFamily] || 0) + 1;
      }

      const fontSize = computed.fontSize;
      if (fontSize) {
        styleProperties.typography.sizes[fontSize] =
          (styleProperties.typography.sizes[fontSize] || 0) + 1;
      }

      const fontWeight = computed.fontWeight;
      if (fontWeight) {
        styleProperties.typography.weights[fontWeight] =
          (styleProperties.typography.weights[fontWeight] || 0) + 1;
      }

      const lineHeight = computed.lineHeight;
      if (lineHeight && lineHeight !== 'normal') {
        styleProperties.typography.lineHeights[lineHeight] =
          (styleProperties.typography.lineHeights[lineHeight] || 0) + 1;
      }

      const letterSpacing = computed.letterSpacing;
      if (letterSpacing && letterSpacing !== 'normal' && letterSpacing !== '0px') {
        styleProperties.typography.letterSpacing[letterSpacing] =
          (styleProperties.typography.letterSpacing[letterSpacing] || 0) + 1;
      }

      // --- Spacing (margin/padding) ---
      ['marginTop', 'marginRight', 'marginBottom', 'marginLeft',
       'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'].forEach(prop => {
        const val = computed[prop];
        if (val && val !== '0px') {
          const propBase = prop.match(/margin|padding/) ? prop.match(/margin|padding/)[0] : '';
          styleProperties.spacing[propBase] = styleProperties.spacing[propBase] || {};
          styleProperties.spacing[propBase][val] =
            (styleProperties.spacing[propBase][val] || 0) + 1;
        }
      });

      // --- Border Radius ---
      const borderRadius = computed.borderRadius;
      if (borderRadius && borderRadius !== '0px') {
        styleProperties.borderRadius[borderRadius] =
          (styleProperties.borderRadius[borderRadius] || 0) + 1;
      }

      // --- Shadows ---
      const boxShadow = computed.boxShadow;
      if (boxShadow && boxShadow !== 'none') {
        styleProperties.shadows[boxShadow] =
          (styleProperties.shadows[boxShadow] || 0) + 1;
      }

      // --- Motion ---
      const transitionDuration = computed.transitionDuration;
      if (transitionDuration && transitionDuration !== '0s') {
        styleProperties.motion.durations[transitionDuration] =
          (styleProperties.motion.durations[transitionDuration] || 0) + 1;
      }

      const transitionTiming = computed.transitionTimingFunction;
      if (transitionTiming) {
        styleProperties.motion.easings[transitionTiming] =
          (styleProperties.motion.easings[transitionTiming] || 0) + 1;
      }

      const animationDuration = computed.animationDuration;
      if (animationDuration && animationDuration !== '0s') {
        styleProperties.motion.durations[animationDuration] =
          (styleProperties.motion.durations[animationDuration] || 0) + 1;
      }
    }

    // ============================================================================
    // 3. AGGREGATE & FORMAT RESULTS
    // ============================================================================
    const formatFrequencyMap = (map) => {
      return Object.entries(map)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 50); // Top 50 per category
    };

    const formatColorFrequencyMap = (colorsByProp) => {
      const result = [];
      Object.entries(colorsByProp).forEach(([property, valueMap]) => {
        Object.entries(valueMap).forEach(([value, count]) => {
          result.push({ value, property, count });
        });
      });
      return result.sort((a, b) => b.count - a.count).slice(0, 80);
    };

    const formatSpacingFrequencyMap = (spacingByProp) => {
      const result = [];
      Object.entries(spacingByProp).forEach(([property, valueMap]) => {
        Object.entries(valueMap).forEach(([value, count]) => {
          result.push({ value, property, count });
        });
      });
      return result.sort((a, b) => b.count - a.count).slice(0, 60);
    };

    // ============================================================================
    // 4. SITE PROFILING
    // ============================================================================
    const profile = inferPageProfile(visibleElements);

    // ============================================================================
    // 5. RETURN RESULT
    // ============================================================================
    return {
      meta: {
        url: window.location.href,
        title: document.title,
        elementsScanned: visibleElements.length,
        extractedAt: new Date().toISOString()
      },
      profile: {
        surface: {
          type: profile.surface,
          confidence: profile.surfaceConfidence
        },
        audience: {
          type: profile.audience,
          confidence: profile.audienceConfidence
        }
      },
      colors: formatColorFrequencyMap(styleProperties.colors),
      typography: {
        families: formatFrequencyMap(styleProperties.typography.families),
        sizes: formatFrequencyMap(styleProperties.typography.sizes),
        weights: formatFrequencyMap(styleProperties.typography.weights),
        lineHeights: formatFrequencyMap(styleProperties.typography.lineHeights),
        letterSpacing: formatFrequencyMap(styleProperties.typography.letterSpacing)
      },
      spacing: formatSpacingFrequencyMap(styleProperties.spacing),
      borderRadius: formatFrequencyMap(styleProperties.borderRadius),
      shadows: formatFrequencyMap(styleProperties.shadows),
      motion: {
        durations: formatFrequencyMap(styleProperties.motion.durations),
        easings: formatFrequencyMap(styleProperties.motion.easings)
      }
    };

  } catch (e) {
    return {
      error: e.message,
      meta: {
        url: window.location.href,
        extractedAt: new Date().toISOString()
      }
    };
  }

  // ============================================================================
  // HELPERS
  // ============================================================================

  /**
   * Normalize color formats (rgba → hex when possible)
   */
  function normalizeColor(color) {
    // If already hex or simple color name, return as-is
    if (color.startsWith('#') || color.match(/^[a-z]+$/i)) {
      return color;
    }

    // Convert rgb(a) to hex
    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (match) {
      const r = parseInt(match[1], 10);
      const g = parseInt(match[2], 10);
      const b = parseInt(match[3], 10);
      const a = match[4] ? parseFloat(match[4]) : 1;

      // If fully transparent, keep as-is
      if (a === 0) {
        return 'transparent';
      }

      // Convert to hex
      const hex = '#' + [r, g, b].map(x => {
        const hex = x.toString(16);
        return hex.length === 1 ? '0' + hex : hex;
      }).join('');

      return a < 1 ? `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` : hex;
    }

    return color;
  }

  /**
   * Infer page surface type and audience based on page structure
   */
  function inferPageProfile(elements) {
    const url = window.location.href.toLowerCase();
    const bodyText = document.body.innerText.toLowerCase();
    const html = document.documentElement.innerHTML.toLowerCase();

    const scores = {
      docs: 0,
      dashboard: 0,
      marketing: 0,
      content: 0,
      ecommerce: 0,
      webapp: 0
    };

    // --- Docs signals ---
    if (document.querySelector('code') || document.querySelector('pre')) scores.docs += 2;
    if (url.includes('/docs') || url.includes('/api')) scores.docs += 2;
    if (document.querySelector('.docs') || document.querySelector('[class*="doc"]')) scores.docs += 1;
    if (html.match(/code block|syntax highlight/i)) scores.docs += 1;

    // --- Dashboard signals ---
    if (document.querySelector('table') || document.querySelector('canvas')) scores.dashboard += 2;
    if (html.match(/chart|graph|metric|kpi/i)) scores.dashboard += 1;
    if (document.querySelector('[class*="chart"]') || document.querySelector('[class*="widget"]')) {
      scores.dashboard += 1;
    }
    if (document.querySelector('aside') && document.querySelector('header')) scores.dashboard += 1;

    // --- Marketing signals ---
    if (document.querySelector('[class*="hero"]') || document.querySelector('[class*="cta"]')) {
      scores.marketing += 2;
    }
    if (html.match(/testimonial|pricing|benefit|feature/i)) scores.marketing += 1;
    if (document.querySelector('[class*="pricing"]') || document.querySelector('[class*="plan"]')) {
      scores.marketing += 1;
    }

    // --- Content signals ---
    if (document.querySelector('article') || document.querySelector('[role="article"]')) {
      scores.content += 2;
    }
    if (elements.filter(el => el.tagName === 'P').length > 20) scores.content += 1;
    if (url.includes('/blog') || url.includes('/news')) scores.content += 1;

    // --- Ecommerce signals ---
    if (document.querySelector('[class*="product"]') || document.querySelector('[class*="cart"]')) {
      scores.ecommerce += 2;
    }
    if (html.match(/add to cart|buy now|price|usd|\$\d+/i)) scores.ecommerce += 1;
    if (document.querySelector('[class*="price"]') || document.querySelector('[class*="product-card"]')) {
      scores.ecommerce += 1;
    }

    // --- Web app signals ---
    if (document.querySelector('form') || document.querySelector('input[type="text"]')) {
      scores.webapp += 1;
    }
    if (document.querySelector('[role="dialog"]') || document.querySelector('.modal')) {
      scores.webapp += 1;
    }
    if (html.match(/login|sign up|dashboard|settings/i)) scores.webapp += 1;

    // Determine top surface
    const surfaceEntries = Object.entries(scores);
    const topSurface = surfaceEntries.reduce((a, b) => b[1] > a[1] ? b : a);
    const surfaceConfidence = Math.min(topSurface[1] / 5, 1);
    const surface = surfaceConfidence > 0 ? topSurface[0] : 'general';

    // --- Audience inference ---
    const audienceScores = {
      developer: 0,
      operator: 0,
      business: 0,
      consumer: 0,
      general: 0
    };

    if (surface === 'docs') audienceScores.developer += 2;
    if (surface === 'dashboard' || surface === 'webapp') {
      if (html.match(/admin|analytics|monitor/i)) audienceScores.operator += 1;
      else audienceScores.developer += 1;
    }
    if (surface === 'marketing' || surface === 'ecommerce') audienceScores.consumer += 2;
    if (surface === 'content') audienceScores.business += 1;

    const audienceEntries = Object.entries(audienceScores);
    const topAudience = audienceEntries.reduce((a, b) => b[1] > a[1] ? b : a);
    const audienceConfidence = Math.min(topAudience[1] / 2, 1);
    const audience = audienceConfidence > 0 ? topAudience[0] : 'general';

    return {
      surface,
      surfaceConfidence: Math.round(surfaceConfidence * 100) / 100,
      audience,
      audienceConfidence: Math.round(audienceConfidence * 100) / 100
    };
  }

})();
