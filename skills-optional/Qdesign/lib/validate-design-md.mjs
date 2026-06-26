'use strict';

import { readFileSync, existsSync } from 'fs';

/**
 * Validates a DESIGN.md file against required structure and content rules.
 * @param {string} filePath - Absolute path to DESIGN.md
 * @returns {{grade: string, score: number, checks: Array, summary: Object}}
 */
export function validateDesignMd(filePath) {
  if (!existsSync(filePath)) {
    return {
      grade: 'FAIL',
      score: 0,
      checks: [
        {
          id: 'FILE',
          name: 'File exists',
          status: 'FAIL',
          detail: 'File not found'
        }
      ],
      summary: { total: 1, passed: 0, warned: 0, failed: 1 }
    };
  }

  try {
    const content = readFileSync(filePath, 'utf-8');
    return validateContent(content);
  } catch (error) {
    return {
      grade: 'FAIL',
      score: 0,
      checks: [
        {
          id: 'FILE',
          name: 'File readable',
          status: 'FAIL',
          detail: `Failed to read file: ${error.message}`
        }
      ],
      summary: { total: 1, passed: 0, warned: 0, failed: 1 }
    };
  }
}

/**
 * Validates DESIGN.md content from a string.
 * @param {string} markdownString - Markdown content to validate
 * @returns {{grade: string, score: number, checks: Array, summary: Object}}
 */
export function validateContent(markdownString) {
  const checks = [];
  const lines = markdownString.split('\n');
  const headings = extractHeadings(lines);

  // H01-H09: Required headings
  checks.push(
    checkHeading(headings, 'H01', 'Brand Identity heading', ['Brand Identity', 'Brand']),
    checkHeading(headings, 'H02', 'Colors heading', ['Colors', 'Color', 'Palette']),
    checkHeading(headings, 'H03', 'Typography heading', ['Typography', 'Type', 'Font']),
    checkHeading(headings, 'H04', 'Spacing heading', ['Spacing', 'Layout']),
    checkHeading(headings, 'H05', 'Motion heading', ['Motion', 'Animation']),
    checkHeading(headings, 'H06', 'Component heading', ['Component']),
    checkHeading(headings, 'H07', 'Accessibility heading', ['Accessibility', 'a11y', 'WCAG']),
    checkHeading(headings, 'H08', 'Do/Dont heading', ['Do']),
    checkDarkModeHeading(markdownString, headings)
  );

  // C01-C06: Content quality
  checks.push(
    checkOKLCHColors(markdownString),
    checkHexOnlyColors(markdownString),
    checkBlacklistedFonts(markdownString, headings, lines),
    checkContrastDocumentation(markdownString),
    checkWCAGLevel(markdownString, headings, lines),
    checkComponentCount(markdownString)
  );

  // S01-S05: State coverage
  const componentSection = extractComponentSection(markdownString);
  checks.push(
    checkState(componentSection, 'S01', 'Hover state coverage', /hover/i),
    checkState(componentSection, 'S02', 'Active/pressed state coverage', /active|pressed/i),
    checkState(componentSection, 'S03', 'Focus state coverage', /focus/i),
    checkState(componentSection, 'S04', 'Disabled state coverage', /disabled/i),
    checkAllStates(componentSection)
  );

  // Summary
  const summary = {
    total: checks.length,
    passed: checks.filter(c => c.status === 'PASS').length,
    warned: checks.filter(c => c.status === 'WARN').length,
    failed: checks.filter(c => c.status === 'FAIL').length
  };

  const grade = summary.failed > 0 ? 'FAIL' : summary.warned > 3 ? 'WARN' : 'PASS';
  const score = Math.round((summary.passed / summary.total) * 100);

  return { grade, score, checks, summary };
}

function extractHeadings(lines) {
  return lines
    .map((line, index) => {
      const match = line.match(/^(#{1,3})\s+(.+)$/);
      return match ? { level: match[1].length, text: match[2].trim(), index } : null;
    })
    .filter(Boolean);
}

function checkHeading(headings, id, name, aliases) {
  const found = headings.find(h =>
    aliases.some(alias => h.text.toLowerCase().includes(alias.toLowerCase()))
  );
  return {
    id,
    name,
    status: found ? 'PASS' : 'FAIL',
    detail: found ? `Found at line ${found.index + 1}` : 'Required heading not found'
  };
}

function checkDarkModeHeading(markdownString, headings) {
  const hasDarkHeading = headings.some(h => h.text.toLowerCase().includes('dark'));
  const mentionsDark = /dark\s+mode|dark\s+theme|darkmode/gi.test(markdownString);

  let status = 'WARN';
  let detail = 'No dark mode mention or section';

  if (hasDarkHeading) {
    status = 'PASS';
    detail = 'Found dedicated dark mode section';
  } else if (mentionsDark) {
    status = 'FAIL';
    detail = 'Dark mode mentioned but no dedicated section';
  }

  return { id: 'H09', name: 'Dark Mode heading', status, detail };
}

function checkOKLCHColors(markdownString) {
  const oklchCount = (markdownString.match(/oklch\s*\([^)]+\)/gi) || []).length;

  if (oklchCount === 0) {
    return { id: 'C01', name: 'OKLCH color values present', status: 'FAIL', detail: '0 oklch() values found' };
  }
  if (oklchCount < 3) {
    return { id: 'C01', name: 'OKLCH color values present', status: 'WARN', detail: `${oklchCount} oklch values found (< 3)` };
  }
  return { id: 'C01', name: 'OKLCH color values present', status: 'PASS', detail: `${oklchCount} oklch values found` };
}

function checkHexOnlyColors(markdownString) {
  const hexCount = (markdownString.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length;
  const oklchCount = (markdownString.match(/oklch\s*\([^)]+\)/gi) || []).length;

  if (hexCount > 0 && oklchCount === 0) {
    return { id: 'C02', name: 'No hex-only colors without OKLCH', status: 'FAIL', detail: `Found ${hexCount} hex colors without oklch companions` };
  }
  return { id: 'C02', name: 'No hex-only colors without OKLCH', status: 'PASS', detail: 'Hex colors have OKLCH companions or none found' };
}

function checkBlacklistedFonts(markdownString, headings, lines) {
  const blacklist = ['Inter', 'Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Poppins', 'Arial'];
  const typIdx = headings.findIndex(h => /typography|type|font/i.test(h.text));

  if (typIdx === -1) {
    return { id: 'C03', name: 'Blacklisted fonts not used', status: 'PASS', detail: 'No typography section found' };
  }

  const endIdx = findSectionEnd(headings, typIdx, lines);
  const section = lines.slice(headings[typIdx].index, endIdx).join('\n');

  for (const font of blacklist) {
    if (new RegExp(font, 'i').test(section)) {
      return { id: 'C03', name: 'Blacklisted fonts not used', status: 'FAIL', detail: `Found blacklisted font: ${font}` };
    }
  }
  return { id: 'C03', name: 'Blacklisted fonts not used', status: 'PASS', detail: 'No blacklisted fonts found' };
}

function checkContrastDocumentation(markdownString) {
  const hasMention = /contrast|4\.5:1|contrast\s+ratio|wcag/i.test(markdownString);
  const hasRatio = /\d+\.?\d*:1|contrast\s+ratio\s+of/i.test(markdownString);

  if (!hasMention) {
    return { id: 'C04', name: 'Contrast ratio documented', status: 'FAIL', detail: 'No mention of contrast, ratio, or WCAG' };
  }
  if (!hasRatio) {
    return { id: 'C04', name: 'Contrast ratio documented', status: 'WARN', detail: 'Contrast mentioned but no specific ratio values' };
  }
  return { id: 'C04', name: 'Contrast ratio documented', status: 'PASS', detail: 'Contrast ratio with specific values documented' };
}

function checkWCAGLevel(markdownString, headings, lines) {
  const a11yIdx = headings.findIndex(h => /accessibility|a11y|wcag/i.test(h.text));

  if (a11yIdx === -1) {
    return { id: 'C05', name: 'WCAG level stated', status: 'FAIL', detail: 'No accessibility section found' };
  }

  const endIdx = findSectionEnd(headings, a11yIdx, lines);
  const section = lines.slice(headings[a11yIdx].index, endIdx).join('\n');

  if (!/wcag\s+(level\s+)?(aa|aaa|a)/i.test(section)) {
    return { id: 'C05', name: 'WCAG level stated', status: 'FAIL', detail: 'No WCAG level (AA/AAA) specified' };
  }
  return { id: 'C05', name: 'WCAG level stated', status: 'PASS', detail: 'WCAG level specified' };
}

function checkComponentCount(markdownString) {
  const components = ['Button', 'Input', 'Card', 'Badge', 'Modal', 'Toast', 'Dropdown', 'Menu', 'Dialog', 'Popover', 'Tooltip', 'Tab', 'Accordion', 'Checkbox', 'Radio', 'Select', 'Textarea', 'Link', 'Header', 'Footer', 'Sidebar', 'Navigation', 'Breadcrumb', 'Pagination', 'Progress', 'Spinner'];
  const found = new Set();

  components.forEach(name => {
    if (new RegExp(`\\b${name}\\b`, 'i').test(markdownString)) {
      found.add(name);
    }
  });

  const count = found.size;
  if (count < 3) {
    return { id: 'C06', name: 'Minimum 6 components defined', status: 'FAIL', detail: `${count} components found (< 3)` };
  }
  if (count < 6) {
    return { id: 'C06', name: 'Minimum 6 components defined', status: 'WARN', detail: `${count} components found (< 6)` };
  }
  return { id: 'C06', name: 'Minimum 6 components defined', status: 'PASS', detail: `${count} components found` };
}

function findSectionEnd(headings, startIdx, lines) {
  const startLevel = headings[startIdx].level;
  for (let i = startIdx + 1; i < headings.length; i++) {
    if (headings[i].level <= startLevel) {
      return headings[i].index;
    }
  }
  return lines.length;
}

function extractComponentSection(markdownString) {
  const lines = markdownString.split('\n');
  const headings = extractHeadings(lines);
  const compIdx = headings.findIndex(h => h.text.toLowerCase().includes('component'));

  if (compIdx === -1) return '';

  const endIdx = findSectionEnd(headings, compIdx, lines);
  return lines.slice(headings[compIdx].index, endIdx).join('\n');
}

function checkState(componentSection, id, name, regex) {
  const hasState = regex.test(componentSection);
  return {
    id,
    name,
    status: hasState ? 'PASS' : 'FAIL',
    detail: hasState ? `${name.split(' ')[0]} state documented` : `${name.split(' ')[0]} state not found`
  };
}

function checkAllStates(componentSection) {
  const states = {
    hover: /hover/i.test(componentSection),
    active: /active|pressed/i.test(componentSection),
    focus: /focus/i.test(componentSection),
    disabled: /disabled/i.test(componentSection)
  };

  const count = Object.values(states).filter(Boolean).length;

  if (count === 4) {
    return { id: 'S05', name: 'All 4 states defined', status: 'PASS', detail: 'All states (hover, active, focus, disabled) documented' };
  }
  if (count === 3) {
    return { id: 'S05', name: 'All 4 states defined', status: 'WARN', detail: `${count}/4 states found` };
  }
  return { id: 'S05', name: 'All 4 states defined', status: 'FAIL', detail: `${count}/4 states found` };
}
