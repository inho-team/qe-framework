---
name: Qi18n-audit
description: "Scans source files for hardcoded user-facing strings and generates translation keys. Use for i18n audit, translation check, hardcoded string detection, missing translation, 번역 누락, 하드코딩 문자열, 다국어 검사, i18n 감사. Distinct from Qdoc-converter (format conversion) — this scans .tsx/.ts/.jsx files for untranslated strings and replaces them with t('key') calls."
metadata:
  author: anthropic
  version: "1.0.0"
user_invocable: true
---

# Qi18n-audit — i18n Coverage Auditor

Scans for hardcoded user-facing strings, generates translation keys, updates locale files, and reports coverage.

## Modes

| Flag | Behavior |
|------|----------|
| `--audit` | Report only — no file changes |
| `--fix` | Auto-replace hardcoded strings with `t('key')` calls |
| `--report` | Detailed markdown report with full untranslated list |

Default: `--audit` (safe, non-destructive).

---

## Workflow

### Step 1 — Detect Project Structure

Locate locale files and i18n library before scanning:

```bash
# Find locale files
find . -name "ko.ts" -o -name "en.ts" -o -name "*.i18n.ts" \
       -o -name "ko.json" -o -name "en.json" | grep -v node_modules

# Identify i18n library in use
grep -r "i18next\|react-i18next\|useTranslation\|i18n\.t(" \
     src/ --include="*.ts" --include="*.tsx" -l | head -5
```

If no locale files are found, ask the user before proceeding.

### Step 2 — Scan for Hardcoded Strings

Scan all `.tsx`, `.ts`, `.jsx` files under `src/` (exclude `node_modules`, `dist`, `__tests__`, `*.test.*`, `*.spec.*`).

**Target patterns (collect these):**

| Pattern | Example |
|---------|---------|
| JSX text content | `<Button>Save</Button>` |
| JSX string props | `placeholder="Enter name"` |
| String literals assigned to UI props | `label: "Submit"` |
| Template literals in UI context | `` title={`Hello ${name}`} `` |

**Exclude (skip silently):**

- Import paths: `import x from './foo'`
- Variable/function names
- CSS class names, style values
- `console.log`, `console.error`, etc.
- Code comments (`//`, `/* */`)
- Type annotations and interfaces
- Test files (`*.test.*`, `*.spec.*`, `__tests__/`)
- URLs, regex patterns, enum values
- Single-char strings and pure numeric strings

**Heuristic — user-facing check:**
A string is user-facing if it appears inside JSX return, is assigned to `label`/`placeholder`/`title`/`message`/`description`/`tooltip`/`aria-label` props, or is passed to notification/toast/alert functions.

### Step 3 — Generate Translation Keys

Follow project naming convention (detect from existing keys; default to dot-notation):

```
{feature}.{component}.{descriptor}

Examples:
  auth.loginForm.submitButton   → "Login"
  common.actions.save           → "Save"
  dashboard.header.title        → "Dashboard"
  errors.validation.required    → "This field is required"
```

Rules:
- All lowercase, camelCase segments separated by `.`
- Reuse existing keys when the string matches a known translation value
- Flag potential duplicates (same string, different keys)

### Step 4 — Update Locale Files (`--fix` only)

Add new keys to detected locale files. Append to the appropriate namespace object:

```typescript
// ko.ts — add Korean (use English as placeholder if translation unavailable)
export const ko = {
  auth: {
    loginForm: {
      submitButton: "로그인",   // translated
    }
  }
}

// en.ts — add English
export const en = {
  auth: {
    loginForm: {
      submitButton: "Login",
    }
  }
}
```

If only one locale file exists, create the missing counterpart with English values and mark with `// TODO: translate` comments.

### Step 5 — Replace Hardcoded Strings (`--fix` only)

Replace each hardcoded string with the appropriate `t()` call:

```tsx
// Before
<Button>Save</Button>
<input placeholder="Enter name" />

// After
<Button>{t('common.actions.save')}</Button>
<input placeholder={t('common.form.namePlaceholder')} />
```

Ensure `useTranslation` (or equivalent) is imported at the top of each modified file. Do not modify files that already use `t()` correctly for the targeted string.

### Step 6 — Generate Coverage Report

Output after every run (all modes):

```markdown
## i18n Coverage Report

**Scanned:** 42 files
**Hardcoded strings found:** 17
**Already translated:** 83 (coverage: 83%)
**Untranslated:** 17

### Untranslated Strings

| File | Line | String | Suggested Key |
|------|------|--------|---------------|
| src/features/auth/LoginForm.tsx | 24 | "Login" | auth.loginForm.submitButton |
| src/shared/ui/Modal.tsx | 11 | "Close" | common.actions.close |
| ...

### Duplicate Candidates
| String | Keys |
|--------|------|
| "Cancel" | common.actions.cancel, modal.footer.cancel |
```

For `--report` mode, write this to `i18n-audit-report.md` in the project root.

---

## Validation Gates

Before finalizing `--fix` changes:

1. Locale files parse without syntax errors — if invalid, **STOP** and report
2. No key collision with existing translations — warn on conflict, do not overwrite
3. Modified `.tsx`/`.ts` files still compile (`tsc --noEmit`) — revert on failure
4. Each replaced string has a corresponding key in both locale files

---

## Quick Reference

```
--audit   Safe scan, report only (default)
--fix     Auto-replace + update locale files
--report  Write detailed markdown to i18n-audit-report.md
```

## Never Do

- Do not replace strings inside `console.*`, comments, or type definitions
- Do not overwrite existing translation keys with new values
- Do not run `--fix` without first showing the `--audit` report to the user
- Do not invent translations — use English as placeholder and mark `// TODO: translate`
- Do not modify test files
