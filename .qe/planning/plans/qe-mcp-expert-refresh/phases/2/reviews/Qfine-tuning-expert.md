# Qfine-tuning-expert Review Evidence

- expert: Qfine-tuning-expert
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: not stable across checked OpenAI docs surfaces
- currentMajor: null
- verifiedMajor: null
- lifecycle: use-with-caution
- reviewer: qe-mcp-expert-refresh
- conflict: OpenAI docs expose SFT/RFT/DPO/vision fine-tuning surfaces while best-practice docs also state the fine-tuning platform is being wound down for new users.

## sourceUrls

- https://developers.openai.com/api/docs/guides/model-optimization
- https://developers.openai.com/api/docs/guides/supervised-fine-tuning
- https://developers.openai.com/api/docs/guides/vision-fine-tuning
- https://developers.openai.com/api/docs/guides/direct-preference-optimization
- https://developers.openai.com/api/docs/guides/reinforcement-fine-tuning
- https://developers.openai.com/api/docs/guides/fine-tuning-best-practices
- https://developers.openai.com/api/docs/deprecations

## sourceCommands

- Official OpenAI docs search restricted to `developers.openai.com` / `platform.openai.com`.

## raw command output / API summary

- OpenAI docs identify model optimization, supervised fine-tuning, vision fine-tuning, DPO, and RFT surfaces.
- Fine-tuning best-practice/deprecation surfaces indicate platform availability and model lifecycle can change.

## official-doc provenance

OpenAI official docs supplied all provider-specific claims.

## registry provenance

No package registry is authoritative for OpenAI fine-tuning platform availability.

## changedSections

- Description/triggers now include OpenAI model optimization, SFT, DPO, and RFT.
- Added Current Platform Notes.
- Marked OpenAI-specific provider/model advice as volatile and caution-first.

## residualRisk

Exact model availability, fine-tuning eligibility, and deprecation timelines are temporal. Verify docs and account access immediately before implementation.
