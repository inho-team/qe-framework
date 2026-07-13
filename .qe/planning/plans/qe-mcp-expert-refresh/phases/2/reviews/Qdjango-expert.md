# Qdjango-expert Review Evidence

- expert: Qdjango-expert
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: 2025-12-03 for Django 6.0 release announcement
- currentMajor: 6
- verifiedMajor: 6
- lifecycle: trusted-current
- reviewer: qe-mcp-expert-refresh
- conflict: none

## sourceUrls

- https://docs.djangoproject.com/en/6.0/releases/6.0/
- https://www.djangoproject.com/weblog/2025/dec/03/django-60-released/

## sourceCommands

- `python3 -m pip index versions Django`

## raw command output / API summary

- `python3 -m pip index versions Django` -> latest `6.0.7`
- Official Django 6.0 notes identify CSP support, Template Partials, Background Tasks, and modern email API as notable areas.

## official-doc provenance

Django official docs and weblog supplied release and feature guidance.

## registry provenance

pip index output confirmed the current Django major and patch version.

## changedSections

- Frontmatter description/triggers now target Django 6.0 with Django 5.2 LTS migration caveat.
- Added Current Version Notes.
- Updated workflow mention from Django 5.0 async views to Django 6.0 async-capable views.

## residualRisk

Django 5.2 LTS remains the safer choice for some long-lived apps. Verify Python compatibility before upgrade advice.
