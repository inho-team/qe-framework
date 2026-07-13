# Qrag-architect Review Evidence

- expert: Qrag-architect
- accessedAt: 2026-07-12T16:18:29Z
- sourceDate: 2026-07-12
- sourcePublishedAt: Assistants migration docs include 2026-08-26 shutdown timeline in checked content
- currentMajor: null
- verifiedMajor: null
- lifecycle: use-with-caution
- reviewer: qe-mcp-expert-refresh
- conflict: OpenAI-native retrieval/file-search surfaces are current but migration/deprecation timelines make provider defaults volatile.

## sourceUrls

- https://developers.openai.com/api/docs/assistants/tools/file-search
- https://developers.openai.com/api/docs/guides/embeddings
- https://developers.openai.com/api/docs/assistants/migration
- https://developers.openai.com/api/docs/guides/deep-research
- https://developers.openai.com/api/docs/deprecations

## sourceCommands

- Official OpenAI docs search restricted to `developers.openai.com` / `platform.openai.com`.

## raw command output / API summary

- File search docs describe Vector Store usage for uploaded files.
- Embeddings docs describe third-generation `-3` embedding models.
- Assistants migration docs state Assistants API deprecation/shutdown guidance and migration to Responses API.

## official-doc provenance

OpenAI official docs supplied provider-native retrieval, embeddings, and migration claims.

## registry provenance

No package registry is authoritative for OpenAI retrieval platform state.

## changedSections

- Description now includes OpenAI vector stores/file search and custom vector DB distinction.
- Added Current Platform Notes.
- Marked provider-native defaults as caution-first unless exact API/model/source date is recorded.

## residualRisk

OpenAI retrieval APIs and model defaults can change. Custom RAG guidance remains valid but must be evaluated against tenant isolation, hybrid search, reranking, and storage-control requirements.
