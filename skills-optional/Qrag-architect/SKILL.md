---
name: Qrag-architect
description: RAG pipeline architect and system designer. Covers document loading, chunking strategies, embedding models, vector databases (Chroma, pgvector, Pinecone, Qdrant), hybrid search, reranking, and evaluation with RAGAS. Designs and implements production-grade RAG systems by chunking documents, generating embeddings, configuring vector stores, building hybrid search pipelines, applying reranking, and evaluating retrieval quality. Use for RAG setup, vector DB, embedding, chunking, retrieval, semantic search, document retrieval, context augmentation, similarity search, or knowledge-grounded AI applications requiring embedding-based indexing.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: data-ml
triggers: RAG, retrieval-augmented generation, vector search, embeddings, semantic search, vector database, document retrieval, knowledge base, context retrieval, similarity search
role: architect
scope: system-design
output-format: architecture
related-skills: python-pro, database-optimizer, monitoring-expert, api-designer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# RAG Architect

## Core Workflow

1. **Requirements** — Identify retrieval needs, latency, accuracy, scale
2. **Vector Store** — Select database, schema, indexing, sharding
3. **Chunking** — Split on semantic boundaries, add overlap & metadata
4. **Retrieval** — Embeddings, query transform, hybrid search, reranking
5. **Evaluation** — Track metrics, debug retrieval, optimize iteratively

## Code Patterns (3 Examples with Docstrings)

```python
# Pattern 1: Semantic chunking with overlap
def semantic_chunking(text: str, chunk_size: int = 800, overlap: int = 100):
    """Split text on semantic boundaries with overlap for RAG."""
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_size, chunk_overlap=overlap,
        separators=["\n\n", "\n", ". ", " "]
    )
    return splitter.split_text(text)

# Pattern 2: Hybrid search with RRF
def hybrid_search(query: str, vector_results: list, bm25_results: list, k: int = 10):
    """Fuse dense + sparse retrieval using Reciprocal Rank Fusion."""
    rrf_scores = {}
    for rank, r in enumerate(vector_results[:k], 1):
        rrf_scores[r['id']] = rrf_scores.get(r['id'], 0) + 1 / (60 + rank)
    for rank, r in enumerate(bm25_results[:k], 1):
        rrf_scores[r['id']] = rrf_scores.get(r['id'], 0) + 1 / (60 + rank)
    return sorted(rrf_scores.items(), key=lambda x: x[1], reverse=True)[:k]

# Pattern 3: Retrieval evaluation
def evaluate_retrieval(queries: list, retrieved: list, ground_truth: list, k: int = 10):
    """Compute precision@k, recall@k, MRR on held-out queries."""
    precisions, recalls, mrrs = [], [], []
    for query, ret, rel in zip(queries, retrieved, ground_truth):
        rel_set, ret_set = set(rel), set(ret[:k])
        if rel_set:
            precisions.append(len(rel_set & ret_set) / k)
            recalls.append(len(rel_set & ret_set) / len(rel_set))
        for rank, doc in enumerate(ret[:k], 1):
            if doc in rel_set:
                mrrs.append(1 / rank); break
    return {
        "precision@k": sum(precisions) / len(precisions) if precisions else 0,
        "recall@k": sum(recalls) / len(recalls) if recalls else 0,
        "mrr": sum(mrrs) / len(mrrs) if mrrs else 0,
    }
```

## Comment Template (Google-style)

```python
def build_retrieval_index(documents: list, embedding_model: str):
    """One-line summary of indexing strategy.
    
    Longer: explain chunking approach, embedding rationale, guarantees.
    
    Args:
        documents: List of dicts with 'id', 'text', 'metadata'
        embedding_model: HuggingFace model (e.g., 'BAAI/bge-small-en-v1.5')
    
    Returns:
        Indexed vector database client
    
    Raises:
        ValueError: If documents lack 'id' or 'text' fields
    """
```

## Lint Rules (ruff/mypy/black)

```toml
[tool.ruff]
line-length = 100
select = ["E", "F", "W", "UP"]

[tool.mypy]
python_version = "3.9"
disallow_untyped_defs = true
ignore_missing_imports = true
```

## Security Checklist (5+)

1. **Prompt injection via retrieved context** — Sanitize docs before passing to LLM; limit text length
2. **Data poisoning in corpus** — Filter for toxicity on ingestion; flag unusual metadata/redactions
3. **PII leakage in embeddings** — Remove emails, SSNs, phone numbers before embedding
4. **Unauthorized vector DB access** — Enforce API keys, OAuth, role-based ACL per collection
5. **Model endpoint credential exposure** — Use env vars & secrets manager; never hardcode keys

## Anti-patterns (5 Wrong/Correct)

| Anti-pattern | Fix |
|--------------|-----|
| Fixed chunk_size=512 without domain eval | Test 256–1024 on domain data; measure recall@10 |
| No reranking; direct LLM on top-1 result | Use BM25+vector hybrid + reranker (Cohere, ColBERT) |
| Only measuring LLM output; ignoring retrieval | Measure context_precision ≥0.7 AND answer_relevancy separately |
| Tight coupling to embedding model | Decouple via vector DB schema; version embeddings in metadata |
| Single vector search; no hybrid or filtering | Always use hybrid (dense+sparse) + metadata filters + reranking |

## Implementation Checklist

- [ ] Chunking strategy evaluated on domain data
- [ ] Hybrid search (vector + BM25 or keyword) implemented
- [ ] Reranking (Cohere, ColBERT, or cross-encoder) in place
- [ ] Retrieval metrics (precision@k, recall@k, MRR) tracked
- [ ] Metadata enrichment (source, timestamp, section)
- [ ] Idempotent ingestion with deduplication (deterministic IDs)
- [ ] Tenant isolation & access control enforced

## MUST DO / MUST NOT DO

**MUST:** Evaluate embeddings on domain data, implement hybrid search, measure retrieval quality, test on prod scale, monitor latency  
**MUST NOT:** Use default chunk=512, skip reranking, ignore retrieval metrics, couple to embedding model, deploy without evaluation
