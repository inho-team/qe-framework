cc---
name: Qlocal-llm-setup
description: "Local LLM setup and optimization guide. Covers Ollama, vLLM, llama.cpp, SLM, and MCP integration. Use for local AI setup, Ollama install, model serving, GPU config, quantization, local inference, Qwen, DeepSeek, or open-source model deployment."
invocation_trigger: "When setting up local LLM infrastructure, deploying open-source models, configuring Ollama/vLLM/llama.cpp, or integrating local models with Claude Code via MCP."
recommendedModel: sonnet
---

# Qlocal-llm-setup

## Overview

This skill provides end-to-end guidance for setting up and optimizing local LLM infrastructure. It covers installation, model management, quantization strategies, API integration, and MCP bridging for Claude Code workflows.

---

## 1. Ollama: Quick-Start Local Model Server

### Installation

#### macOS
```bash
brew install ollama
# Start daemon
ollama serve
```

#### Linux
```bash
curl -fsSL https://ollama.com/install.sh | sh
# Start daemon (systemd)
sudo systemctl start ollama
```

#### Docker
```bash
docker run -d --gpus=all -v ollama:/root/.ollama -p 11434:11434 --name ollama ollama/ollama
docker exec ollama ollama pull mistral
```

### Model Management

| Command | Purpose |
|---------|---------|
| `ollama pull <model>` | Download model from registry |
| `ollama run <model>` | Run model interactively (blocking) |
| `ollama list` | Show downloaded models and size |
| `ollama rm <model>` | Delete model |
| `ollama show <model>` | Display model metadata |
| `ollama cp <src> <dst>` | Copy/rename model |

### Modelfile: Custom Model Definition

Create a `Modelfile` to customize models:

```dockerfile
FROM mistral
PARAMETER temperature 0.7
PARAMETER num_predict 256
PARAMETER top_k 40
PARAMETER top_p 0.9
SYSTEM "You are a helpful coding assistant."
```

**Common parameters:**
- `temperature`: Randomness (0.0–2.0); 0 = deterministic
- `top_k`: Sample from top K tokens
- `top_p`: Nucleus sampling threshold
- `num_predict`: Max output length
- `num_ctx`: Context window size
- `num_gpu`: GPU layers to offload

Build and use:
```bash
ollama create my-mistral -f Modelfile
ollama run my-mistral "Explain recursion"
```

### API Endpoints

Ollama exposes multiple endpoint formats:

#### Chat API (`/api/chat`)
```bash
curl http://localhost:11434/api/chat -d '{
  "model": "mistral",
  "messages": [{"role": "user", "content": "Hello"}],
  "stream": false
}'
```

#### Generate API (`/api/generate`)
```bash
curl http://localhost:11434/api/generate -d '{
  "model": "mistral",
  "prompt": "Tell me about Rust",
  "stream": false
}'
```

#### Embeddings API (`/api/embeddings`)
```bash
curl http://localhost:11434/api/embeddings -d '{
  "model": "nomic-embed-text",
  "prompt": "machine learning"
}'
```

#### OpenAI-Compatible Endpoint (`/v1/chat/completions`)
```bash
curl http://localhost:11434/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral",
    "messages": [{"role": "user", "content": "Hi"}]
  }'
```

### GPU Configuration

Set environment variables before starting Ollama:

```bash
# Use N GPU layers
export OLLAMA_NUM_GPU=35

# Limit concurrent loaded models
export OLLAMA_MAX_LOADED_MODELS=2

# Force CPU-only
export OLLAMA_NUM_GPU=0

# Start server with config
OLLAMA_NUM_GPU=35 ollama serve
```

**For NVIDIA GPUs:**
- `OLLAMA_NUM_GPU`: Number of layers to offload (higher = faster inference, more VRAM)
- For 8GB VRAM: offload 20–30 layers; for 16GB: 35+

**For Metal (macOS):**
- Automatic GPU acceleration; set `OLLAMA_NUM_GPU` to control layer offloading

---

## 2. vLLM: High-Performance LLM Serving

### Installation

```bash
pip install vllm
# With CUDA support
pip install vllm[cuda12]
```

### Basic Serving

```bash
vllm serve mistral-7b-instruct-v0.2 \
  --port 8000 \
  --tensor-parallel-size 1 \
  --max-model-len 2048
```

### Quantization Strategies

| Quantization | Size Reduction | Speed | VRAM | Use Case |
|--------------|----------------|-------|------|----------|
| **AWQ** | 3–4× | Very fast | Low | Production inference |
| **GPTQ** | 3–4× | Fast | Low | Balanced quality/speed |
| **FP8** | 2× | Fast | Medium | RTX 4000+ (Ampere+) |
| **FP16** (baseline) | 1× | Medium | High | Multi-GPU, high accuracy |

**AWQ quantization example:**
```bash
# Use pre-quantized model
vllm serve TheBloke/Mistral-7B-Instruct-v0.2-AWQ \
  --quantization awq \
  --port 8000
```

**GPTQ:**
```bash
vllm serve TheBloke/Mistral-7B-Instruct-v0.2-GPTQ \
  --quantization gptq \
  --port 8000
```

**FP8 (auto-quantized):**
```bash
vllm serve mistral-7b-instruct-v0.2 \
  --quantization fp8 \
  --port 8000
```

### Performance Tuning

```bash
vllm serve mistral-7b-instruct-v0.2 \
  --port 8000 \
  --tensor-parallel-size 4 \
  --pipeline-parallel-size 2 \
  --max-model-len 4096 \
  --gpu-memory-utilization 0.9 \
  --kv-cache-dtype fp8_e5m2 \
  --batch-size 32
```

**Key parameters:**
- `--tensor-parallel-size N`: Shard model across N GPUs
- `--kv-cache-dtype fp8_e5m2`: KV cache quantization (saves 50% VRAM)
- `--gpu-memory-utilization`: Target GPU memory (0.9 = aggressive)
- `--max-model-len`: Max context length
- `--batch-size`: Batch size for inference

### Python API

```python
from vllm import LLM, SamplingParams

# Load model
llm = LLM(
    model="mistral-7b-instruct-v0.2",
    tensor_parallel_size=1,
    gpu_memory_utilization=0.8,
    quantization="awq",  # optional
)

# Configure sampling
sampling_params = SamplingParams(
    temperature=0.7,
    top_p=0.9,
    max_tokens=256
)

# Generate
outputs = llm.generate(
    ["Explain machine learning in 100 words"],
    sampling_params
)

for output in outputs:
    print(output.outputs[0].text)
```

---

## 3. llama.cpp: Lightweight Inference Engine

### Build from Source

```bash
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp

# macOS with Metal acceleration
cmake -B build -DGGML_METAL=ON
cmake --build build --config Release

# Linux with CUDA
cmake -B build -DGGML_CUDA=ON
cmake --build build --config Release
```

### GGUF Quantization Guide

| Format | Bits | Size | Quality | Speed | Use Case |
|--------|------|------|---------|-------|----------|
| **Q2_K** | 2 | 3.3GB (7B) | Poor | Fastest | Edge devices, demo |
| **Q3_K** | 3 | 5.2GB (7B) | Fair | Very fast | 4GB VRAM devices |
| **Q4_K** | 4 | 6.6GB (7B) | Good | Fast | 8GB VRAM, general use |
| **Q5_K** | 5 | 8.7GB (7B) | Very good | Medium | 12GB VRAM, balanced |
| **Q6_K** | 6 | 10.7GB (7B) | Excellent | Medium | 16GB VRAM, quality focus |
| **Q8_0** | 8 | 14.6GB (7B) | Near-original | Slower | Reference, high accuracy |

**Download quantized models:**
```bash
# TheBloke repository (extensive GGUF collection)
ollama pull neural-chat  # Or use llama.cpp directly:
wget https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf
```

### llama-server: REST API

```bash
./build/bin/llama-server \
  --model mistral-7b-instruct-v0.2.Q4_K_M.gguf \
  --port 8080 \
  --ctx-size 4096 \
  --n-gpu-layers 33 \
  --batch-size 512 \
  --parallel 4
```

**Parameters:**
- `--ctx-size`: Context window (max tokens)
- `--n-gpu-layers`: GPU layer offloading (higher = faster)
- `--batch-size`: Batch size for parallel processing
- `--parallel`: Run N independent sequences

**OpenAI-compatible API:**
```bash
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "mistral",
    "messages": [{"role": "user", "content": "Hi"}],
    "temperature": 0.7
  }'
```

### Memory Estimation

For a 7B-parameter model:

```
Base model memory = (7 × 10^9 params) × (bits per param) / 8

Q4_K_M (4.5 bits): ~3.5 GB
Q5_K (5 bits):     ~4.2 GB
Q8_0 (8 bits):     ~6.7 GB

+ KV cache overhead (~context_length × 2 layers × 0.1 GB per 4K ctx)
```

Example: Q4_K_M + 8K context ≈ 4 GB + 0.5 GB = **4.5 GB**

---

## 4. Model Selection Guide

### Task-to-Model Mapping

| Task | Recommended Models | Min Quantization | VRAM |
|------|-------------------|------------------|------|
| **Code Generation** | Qwen2.5-Coder-32B, DeepSeek-Coder-V2-16B, Llama 3.1-8B | Q4_K | 8–16GB |
| **Chat** | Mistral-7B, Llama 3-8B, Qwen2.5-14B | Q4_K | 6–12GB |
| **Reasoning** | DeepSeek-R1-14B, Mistral-Large, Llama 3.1-70B (quantized) | Q5_K | 12GB+ |
| **Embeddings** | nomic-embed-text (768-dim), BGE-small (384-dim) | F16 | 2–4GB |
| **Lightweight Chat** | Phi-3-mini (3.8B), Qwen2.5-3B | Q4_K | 2–4GB |

### Popular Open-Source Models (2025)

| Model | Params | Best For | License |
|-------|--------|----------|---------|
| **Qwen2.5-Coder-32B** | 32B | Code + CJK support | Apache 2.0 |
| **DeepSeek-Coder-V2** | 16B (MoE) | Code, reasoning | MIT |
| **Llama 3.1** | 8B/70B/405B | Chat, instruction-following | Llama License |
| **Mistral-7B-Instruct** | 7B | Fast chat | Apache 2.0 |
| **Phi-3-mini** | 3.8B | Edge inference | MIT |
| **nomic-embed-text** | 137M | Semantic search | OpenRAIL |
| **BGE-small-en-v1.5** | 33M | Dense embedding | MIT |

---

## 5. SLM (Small Language Models)

### Definition
Small Language Models (SLM): <7B parameters, designed for consumer hardware without offloading.

### Why Use SLM?

| Benefit | Impact |
|---------|--------|
| **Low latency** | 20–50ms first token on CPU |
| **Privacy** | Full on-device, no external calls |
| **Cost** | $0 inference cost |
| **Battery** | Suitable for mobile/edge |
| **Offline** | Works without internet |

### Popular SLMs

| Model | Params | Context | Strengths | VRAM |
|-------|--------|---------|-----------|------|
| **Phi-3-mini** | 3.8B | 128K | Fast, broad knowledge | 2GB |
| **Qwen2.5-3B** | 3B | 32K | CJK support, efficient | 2GB |
| **Gemma 2B** | 2B | 8K | Well-tuned, instruction-following | 1.5GB |
| **TinyLlama-1.1B** | 1.1B | 2K | Ultra-lightweight | 1GB |

### SLM Use Cases

1. **Code completion** (Phi-3-mini, Qwen2.5-3B)
2. **Summarization** (Gemma 2B)
3. **Classification & sentiment** (TinyLlama)
4. **Real-time chat** (Phi-3-mini with Q4 quantization)

### Running SLM Locally

```bash
# Ollama
ollama run phi

# vLLM
vllm serve microsoft/phi-3-mini --quantization awq --port 8000

# llama.cpp
./llama-server --model phi-3-mini-q4.gguf --ctx-size 2048
```

---

## 6. MCP Integration: Bridging Local LLMs to Claude Code

### What is MCP?

Model Context Protocol (MCP): A standardized bridge for Claude to access external LLM services, tools, and resources. Perfect for integrating local Ollama/vLLM/llama.cpp with Claude Code.

### Option A: ollama-mcp (Recommended)

**Install:**
```bash
claude mcp add ollama-mcp -- npx ollama-mcp --model mistral
```

**claude_desktop_config.json:**
```json
{
  "mcpServers": {
    "ollama": {
      "command": "npx",
      "args": ["ollama-mcp", "--model", "mistral"],
      "env": {
        "OLLAMA_BASE_URL": "http://localhost:11434"
      }
    }
  }
}
```

**Usage in Claude Code:**
```typescript
// MCP automatically exposes ollama tools
// Claude can call: generate_text, chat, embeddings
```

### Option B: OllamaClaude (Node.js)

**Install:**
```bash
git clone https://github.com/sammcj/OllamaClaude
cd OllamaClaude
npm install
```

**Configure:**
```typescript
const OllamaClaude = require('./src/index.js');

const client = new OllamaClaude({
  ollamaUrl: 'http://localhost:11434',
  model: 'mistral',
});

const response = await client.chat('Explain quantum computing');
```

### Option C: mcp-local-llm (Generic Bridge)

**Install:**
```bash
pip install mcp-local-llm
```

**Configure for multiple backends:**
```json
{
  "mcpServers": {
    "local-ollama": {
      "command": "python",
      "args": ["-m", "mcp_local_llm", "--backend", "ollama", "--port", "11434"]
    },
    "local-vllm": {
      "command": "python",
      "args": ["-m", "mcp_local_llm", "--backend", "vllm", "--port", "8000"]
    }
  }
}
```

### Option D: llama.cpp Native MCP

**Build with MCP support:**
```bash
cmake -B build -DGGML_MCP=ON
cmake --build build --config Release
```

**Run server with MCP:**
```bash
./llama-server --model model.gguf --mcp-port 3000
```

### Delegation Pattern for Claude Code

```typescript
// workflows/my-workflow.ts
import { MCPClient } from './mcp-client';

const llm = new MCPClient('ollama');

async function analyzeCode(code: string) {
  // Delegate to local Mistral
  const review = await llm.generate({
    prompt: `Review this code:\n${code}`,
    model: 'mistral',
    temperature: 0.3,
  });
  
  return review;
}
```

---

## 7. Korean-Specific Models & Optimization

### Best-in-Class Korean LLMs

| Model | Params | Strengths | Notes |
|-------|--------|-----------|-------|
| **Qwen2.5** | 3B–72B | Excellent CJK support, multilingual | Recommended for Korean |
| **EEVE-Korean-10.8B** | 10.8B | Fine-tuned for Korean | Based on Mistral |
| **KULLM3** | 13B | Korean-specific instruction tuning | Samsung research |
| **Llama 3-8B** | 8B | Good CJK, multilingual base | Fine-tune for Korean |

### Setup for Korean Tasks

```bash
# Ollama: Pull Qwen with Korean support
ollama pull qwen2.5:14b

# Modelfile for Korean instruction-following
cat > Modelfile.ko <<EOF
FROM qwen2.5:14b
PARAMETER temperature 0.7
SYSTEM "당신은 한국어를 유창하게 이해하고 응답하는 AI 어시스턴트입니다."
EOF

ollama create ko-qwen -f Modelfile.ko
ollama run ko-qwen "한국 국회의 역할을 설명해주세요"
```

### Korean OCR/Vision Tasks

```bash
# Using OpenCLIP for Korean text recognition
pip install open-clip-torch pillow

from PIL import Image
import open_clip

model, _, preprocess = open_clip.create_model_and_transforms(
    'ViT-B-32',
    pretrained='openai'
)

image = preprocess(Image.open('korean_text.png')).unsqueeze(0)
# Then use with OCR pipeline (Tesseract or EasyOCR)
```

---

## 8. Troubleshooting

### CUDA Out of Memory

**Problem:** `RuntimeError: CUDA out of memory`

**Solutions (in order):**
1. Reduce `--gpu-memory-utilization` (0.9 → 0.7)
2. Reduce context length: `--max-model-len 2048` (from 4096)
3. Use smaller quantization: Q4_K instead of Q6_K
4. Enable KV cache quantization: `--kv-cache-dtype fp8_e5m2`
5. Use smaller model (7B instead of 13B)
6. Reduce batch size: `--batch-size 16` (from 32)

### Slow Inference on Mac

**Problem:** First token takes 5–10 seconds

**Causes & fixes:**
- **Metal not enabled**: Verify `OLLAMA_NUM_GPU` > 0
- **Model too large**: Use Q4_K or smaller (3B–7B)
- **Disk bottleneck**: Move model to SSD
- **CPU thermal throttling**: Check `sysctl hw.thermal` and cooling

**Optimal Mac setup:**
```bash
# Macbook Pro 16" M3 Max
ollama pull mistral:7b-instruct-q4_K_M
OLLAMA_NUM_GPU=12 ollama serve
# Expected: ~150ms first token, ~50ms/token streaming
```

### Model Loading Fails

**Problem:** `Error: failed to load model`

**Debug steps:**
1. Verify file integrity: `shasum -a 256 model.gguf`
2. Check format compatibility: `file model.gguf` (should be GGUF 3)
3. Sufficient disk space: `du -sh model.gguf`
4. Permissions: `ls -la ~/.ollama/models/` or `~/.cache/huggingface/`
5. For corrupted downloads: `rm && re-download`

```bash
# Verify model
llama-cpp -m model.gguf --test
```

### High Latency First Token (TTFT)

**Problem:** 1–2 seconds before first output

**Causes:**
- Model not in GPU memory (offloaded to CPU)
- Too many GPU layers in parallel
- GPU memory fragmentation

**Solutions:**
```bash
# Pre-load model into GPU
ollama run mistral "hi" && echo "Warmed up"

# For vLLM: ensure model is loaded
python -c "from vllm import LLM; llm = LLM('mistral')" # Blocks until loaded

# Batch requests to amortize cost
# Instead of 10 requests × 2s TTFT = 20s total
# Queue 10 requests → 2s TTFT + 0.1s/token = 3s total
```

---

## 9. Performance Tuning Deep Dive

### Context Length vs Memory Tradeoff

**Formula:**
```
KV cache size = 2 × (seq_length × num_heads × head_dim × dtype_bytes)
Example: seq_len=4096, heads=32, head_dim=128, fp16:
  KV cache ≈ 2 × (4096 × 32 × 128 × 2) / (1024^3) ≈ 2 GB
```

**Context length strategies:**
- **2K tokens**: Lightweight, <1GB overhead, fast
- **4K tokens**: Balanced, 1–2GB, general use
- **8K tokens**: Extended, 2–4GB, document processing
- **16K+ tokens**: Memory-intensive, requires 16GB+ VRAM or quantization

**Recommendation:** Start at 4K; increase only if needed.

### Batch Size Optimization

**Trade: Throughput vs Latency**

```bash
# Low batch size (1): Fast TTFT, low throughput
vllm serve model --max-num-seqs 1

# Medium batch size (8): Balanced
vllm serve model --max-num-seqs 8

# High batch size (32+): High throughput, high latency (APIs)
vllm serve model --max-num-seqs 32 --disable-log-requests
```

### KV Cache Management

**Default (FP16):** Each token cached at full precision
- 7B model, 4K context: ~4 GB KV overhead

**With FP8 quantization:**
```bash
vllm serve model --kv-cache-dtype fp8_e5m2
# Reduces to ~2 GB (50% savings)
```

**With sliding window:**
```bash
# Only keep recent N tokens in KV cache
vllm serve model --kv-cache-dtype fp8_e5m2 --max-model-len 4096
```

### GPU Layer Offloading Strategy

**For NVIDIA (CUDA):**
```bash
# Estimate layers to offload = (available_vram_gb - 1) / (model_size_gb / num_layers)
# Example: 12 GB VRAM, 7B model (~4 GB, 32 layers)
# Layers = (12 - 1) / (4 / 32) ≈ 88 (offload all)

vllm serve mistral \
  --gpu-memory-utilization 0.85 \
  --tensor-parallel-size 2  # Use 2 GPUs
```

**For Metal (macOS):**
```bash
# Metal has automatic GPU detection
# Adjust OLLAMA_NUM_GPU (0–100+ depending on chip)
OLLAMA_NUM_GPU=30 ollama serve  # M3 Max: ~30 layers
```

### Monitoring & Benchmarking

```bash
# Measure TTFT and tokens/second
time curl -X POST http://localhost:11434/api/generate \
  -d '{"model": "mistral", "prompt": "Explain AI", "stream": false}' \
  | jq '.eval_count, .eval_duration'

# Profile with vLLM metrics
vllm serve model --enable-prometheus --port 8000
# Visit http://localhost:8000/metrics
```

---

## Quick Reference

### Installation One-Liners

```bash
# Ollama
brew install ollama && ollama serve

# vLLM
pip install vllm[cuda12] && vllm serve mistral --port 8000

# llama.cpp
git clone https://github.com/ggerganov/llama.cpp && \
  cd llama.cpp && cmake -B build && cmake --build build

# MCP bridge
claude mcp add ollama-mcp -- npx ollama-mcp
```

### Common Commands

```bash
# Ollama
ollama pull mistral
ollama run mistral "Hi"
ollama list
ollama rm mistral

# Check running models
curl http://localhost:11434/api/tags | jq .

# Kill hung process
lsof -i :11434 | grep LISTEN | awk '{print $2}' | xargs kill -9
```

### Environment Variables

```bash
# Ollama
export OLLAMA_NUM_GPU=35
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_MODELS=~/.ollama/models

# vLLM
export VLLM_GPU_MEMORY_UTILIZATION=0.9
export VLLM_ATTENTION_BACKEND=flashinfer

# llama.cpp
export LLAMA_CUDA_FORCE_DMMV=1
export LLAMA_METAL_MAX_BATCH_SIZE=512
```

---

## See Also

- [Ollama Docs](https://github.com/ollama/ollama)
- [vLLM GitHub](https://github.com/vllm-project/vllm)
- [llama.cpp](https://github.com/ggerganov/llama.cpp)
- [Model Context Protocol](https://modelcontextprotocol.io/)
- [Hugging Face Model Hub](https://huggingface.co/models)
- [TheBloke GGUF Collection](https://huggingface.co/TheBloke)
