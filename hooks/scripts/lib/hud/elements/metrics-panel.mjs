#!/usr/bin/env node
'use strict';

import { getMetricsSummary } from '../../metrics-collector.mjs';

/**
 * HUD element: Harness metrics summary panel.
 * Reads harnessMetrics from unified-state and returns a formatted summary.
 * Returns empty string if no metrics data exists (panel hidden).
 *
 * @param {Object} state - Unified state object
 * @returns {string} Formatted metrics line or empty string
 */
export function render(state) {
  if (!state || !state.harnessMetrics) return '';

  const summary = getMetricsSummary(state.harnessMetrics);
  if (!summary) return '';

  return summary;
}

/**
 * HUD element metadata.
 */
export const meta = {
  name: 'metrics',
  label: 'Harness Metrics',
  position: 'bottom',
  priority: 50
};
