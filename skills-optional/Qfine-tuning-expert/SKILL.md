---
name: Qfine-tuning-expert
description: "Use when fine-tuning LLMs, training custom models, or adapting foundation models for specific tasks. Invoke for configuring LoRA/QLoRA adapters, preparing JSONL training datasets, setting hyperparameters for fine-tuning runs, adapter training, transfer learning, finetuning with Hugging Face PEFT, OpenAI fine-tuning, instruction tuning, RLHF, DPO, or quantizing and deploying fine-tuned models. Trigger terms include: LoRA, QLoRA, PEFT, finetuning, fine-tuning, adapter tuning, LLM training, model training, custom model."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: data-ml
triggers: fine-tuning, fine tuning, finetuning, LoRA, QLoRA, PEFT, adapter tuning, transfer learning, model training, custom model, LLM training, instruction tuning, RLHF, model optimization, quantization
role: expert
scope: implementation
output-format: code
related-skills: devops-engineer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Fine-Tuning Expert

Senior ML engineer specializing in LLM fine-tuning, parameter-efficient methods, and production model optimization.

## Core Workflow

1. **Dataset prep** — Validate & format data; run quality checks before training
   - Checkpoint: `validate_dataset.py --input data.jsonl` — fix errors before proceeding
2. **Method selection** — LoRA for most tasks; QLoRA (4-bit) if GPU memory constrained; full tune only for small models
3. **Training** — Configure hyperparams, monitor loss curves, checkpoint regularly
   - Checkpoint: validation loss must decrease; plateau signals overfitting
4. **Evaluation** — Benchmark vs base model; test on held-out set & edge cases
   - Checkpoint: collect perplexity, task metrics (BLEU/ROUGE), latency
5. **Deployment** — Merge adapter weights, quantize, measure inference throughput

## Code Patterns (3 Examples with Docstrings)

```python
# Pattern 1: Dataset validation & deduplication
def validate_and_deduplicate_dataset(input_jsonl: str, output_jsonl: str):
    """Validate JSONL format and remove duplicates before fine-tuning."""
    import json
    seen, valid_count = set(), 0
    with open(input_jsonl) as f_in, open(output_jsonl, 'w') as f_out:
        for line in f_in:
            try:
                record = json.loads(line)
                assert 'instruction' in record and 'output' in record
                record_hash = hash((record['instruction'], record['output']))
                if record_hash not in seen:
                    seen.add(record_hash)
                    f_out.write(line)
                    valid_count += 1
            except (json.JSONDecodeError, AssertionError):
                continue
    assert valid_count >= 100, f"Too few training examples: {valid_count}"
    return valid_count

# Pattern 2: LoRA config selection
def select_lora_config(model_size_b: float, gpu_memory_gb: int):
    """Select LoRA rank & alpha based on model size and GPU capacity."""
    from peft import LoraConfig, TaskType
    if gpu_memory_gb < 16: r, alpha = 8, 16
    elif gpu_memory_gb < 32: r, alpha = 16, 32
    else: r, alpha = 32, 64
    return LoraConfig(task_type=TaskType.CAUSAL_LM, r=r, lora_alpha=alpha,
                      target_modules=["q_proj", "v_proj"], lora_dropout=0.05, bias="none")

# Pattern 3: Evaluation metrics
def compute_eval_metrics(model, eval_dataset, tokenizer):
    """Compute perplexity and task metrics on held-out set."""
    import torch
    total_loss, total_tokens = 0, 0
    with torch.no_grad():
        for batch in eval_dataset:
            outputs = model(**batch)
            total_loss += outputs.loss.item() * batch['input_ids'].shape[0]
            total_tokens += batch['input_ids'].shape[0]
    perplexity = torch.exp(torch.tensor(total_loss / total_tokens)).item()
    return {'perplexity': perplexity, 'eval_loss': total_loss / total_tokens}
```

## Comment Template (Google-style)

```python
def finetune_llm_for_task(base_model_id: str, train_path: str, task_type: str):
    """One-line task summary (e.g., 'Summarization fine-tuning').
    
    Longer: PEFT method rationale, expected improvements, evaluation approach.
    
    Args:
        base_model_id: HuggingFace model (e.g., 'meta-llama/Llama-3-8B')
        train_path: Path to JSONL training data
        task_type: Task identifier (e.g., 'summarization', 'classification')
    
    Returns:
        Path to saved LoRA adapter
    
    Raises:
        FileNotFoundError: If train_path not found
        ValueError: If dataset validation fails
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

Critical: F841 (unused checkpoint), E501 (long args), missing loss assertions

## Security Checklist (5+)

1. **Training data contamination** — No overlap in train/val/test; hash-based dedup; log data version
2. **Model theft via inference** — Rate limiting, API auth, per-user quotas, watermarking
3. **Credential exposure** — Use env vars, `~/.huggingface` token; never hardcode keys in config
4. **Poisoning via malicious examples** — Filter for toxicity on ingestion; flag unusual patterns
5. **Overfitting on small data** — Use dropout, weight decay, eval_steps < 1000; monitor val loss plateau

## Anti-patterns (5 Wrong/Correct)

| Anti-pattern | Fix |
|--------------|-----|
| No dataset validation; train on raw data | Always run validation script first; log valid record count |
| LoRA rank=4 for all tasks | Use rank ≥ 16; set alpha = 2×rank; tune on eval metrics |
| Train without warmup or LR schedule | Always use `warmup_ratio=0.03` + `lr_scheduler_type="cosine"` |
| Skip evaluation on held-out set | Hold out 10–20% test data; compute perplexity + task metrics |
| Merge adapter without quantization | Merge + quantize with bitsandbytes before serving |

## Quick LoRA Template

```python
from peft import LoraConfig
from trl import SFTTrainer

lora_config = LoraConfig(r=16, lora_alpha=32, target_modules=["q_proj", "v_proj"],
                         lora_dropout=0.05, bias="none")
trainer = SFTTrainer(model=model, args=training_args, train_dataset=train_data,
                     eval_dataset=eval_data, peft_config=lora_config, max_seq_length=2048)
trainer.train()
model.save_pretrained("./lora-adapter")
```

## MUST DO / MUST NOT DO

**MUST:** Validate datasets, use PEFT, monitor loss curves, evaluate on held-out set, version configs, include warmup  
**MUST NOT:** Skip validation, train without tracking, overfit on small data, hardcode creds, deploy unquantized
