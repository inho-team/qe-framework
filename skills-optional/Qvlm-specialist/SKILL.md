---
name: Qvlm-specialist
description: "Vision Language Model (VLM) and multimodal AI specialist. Covers image understanding, OCR, visual QA, image generation, OpenCLIP, LLaVA, Qwen-VL, and multimodal pipelines. Use for VLM setup, image analysis, visual AI, multimodal, OCR, image generation, OpenCLIP."
invocation_trigger: "When working with vision-language models, multimodal AI, image understanding, OCR, visual question answering, or image generation."
recommendedModel: sonnet
---

# Qvlm-specialist: Vision Language Model & Multimodal AI Expert

## 1. VLM Overview

### What is a VLM?
Vision Language Models are AI systems that understand and reason about both images and text simultaneously. They bridge the gap between computer vision and natural language processing.

### Key Capabilities
- **Image Understanding**: Describe images, identify objects, scenes, actions
- **OCR & Text Extraction**: Extract text from images, documents, screenshots
- **Visual QA**: Answer questions about image content
- **Image Captioning**: Generate natural language descriptions of images
- **Document Analysis**: Extract structured data from forms, tables, diagrams
- **Visual Reasoning**: Compare images, analyze relationships, detect anomalies
- **Multimodal Analysis**: Process mixed image-text content

### Architecture
- **Vision Encoder**: CLIP/SigLIP backbone that converts images to embeddings
- **Language Model**: LLM that processes both visual embeddings and text tokens
- **Connector**: Projection layer bridging vision and language spaces

## 2. Available VLMs Comparison

| Model | Size | Capabilities | Local? | Notes |
|-------|------|--------------|--------|-------|
| **GPT-4o / GPT-4V** | Proprietary | Best-in-class vision understanding, fast | Cloud only | Commercial leader, highest quality |
| **Claude 3.5 Sonnet/Opus** | Proprietary | Excellent document understanding, CJK support | Cloud only | Strong for multimodal reasoning |
| **Qwen-VL / Qwen2-VL** | 4B-32B | Best open-source, strong CJK, multilingual | Local (Ollama, vLLM) | Excellent for Chinese/Japanese/Korean text |
| **LLaVA 1.6 / LLaVA-NeXT** | 7B-34B | Pioneering open VLM, good general purpose | Local (Ollama, vLLM) | Community-driven, well-supported |
| **InternVL2** | 8B-26B | Strong benchmarks, competitive with closed models | Local | Growing adoption, good multimodal reasoning |
| **Phi-3-Vision** | 4.2B | Small but capable, edge-friendly | Local | Mobile/edge optimized |
| **MiniCPM-V** | 2B-8B | Lightweight, efficient for mobile | Local | Good for resource-constrained environments |

## 3. Local VLM Setup

### Via Ollama (Simplest Method)
```bash
# Install Ollama first from https://ollama.ai

# Pull vision models
ollama pull llava:13b           # Full-featured LLaVA
ollama pull llama3.2-vision:11b # Latest Llama vision variant
ollama pull qwen2-vl:7b         # Qwen2-VL (good for CJK)

# Check installed models
ollama list
```

### API Usage with Image
```bash
# Using Ollama REST API
curl http://localhost:11434/api/chat -d '{
  "model": "llava:13b",
  "messages": [
    {
      "role": "user",
      "content": "Describe this image in detail",
      "images": ["base64-encoded-image-or-url"]
    }
  ],
  "stream": false
}'
```

### Python Integration
```python
import requests
import base64
from pathlib import Path

def analyze_image_with_ollama(image_path: str, prompt: str, model: str = "llava:13b"):
    # Encode image to base64
    with open(image_path, "rb") as img:
        image_data = base64.b64encode(img.read()).decode()
    
    response = requests.post(
        "http://localhost:11434/api/chat",
        json={
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "images": [image_data]
                }
            ],
            "stream": False
        }
    )
    
    return response.json()["message"]["content"]

# Usage
result = analyze_image_with_ollama("screenshot.png", "What's shown in this screenshot?")
print(result)
```

### Advanced Setup: vLLM (faster inference)
```bash
# For production-grade local deployment
pip install vllm

# Start vLLM server
vllm serve qwen/qwen2-vl-7b-instruct \
    --tensor-parallel-size 2 \
    --enable-lora \
    --port 8000
```

## 4. OpenCLIP: Image-Text Embeddings

### What is OpenCLIP?
Open-source implementation of CLIP (Contrastive Language-Image Pretraining) that creates aligned image and text embeddings in the same vector space.

### Installation & Setup
```bash
pip install open-clip-torch
```

### Use Cases
- Zero-shot image classification (classify images without training)
- Image-text similarity search
- Content-based image retrieval
- Cross-modal similarity metrics
- Semantic image search

### Code Example
```python
import open_clip
import torch
from PIL import Image

# Load model
device = "cuda" if torch.cuda.is_available() else "cpu"
model, _, preprocess = open_clip.create_model_and_transforms(
    'ViT-B-32',
    pretrained='openai'
)
model = model.to(device)
tokenizer = open_clip.get_tokenizer('ViT-B-32')

# Encode image
image = Image.open("photo.jpg")
image_data = preprocess(image).unsqueeze(0).to(device)
with torch.no_grad():
    image_features = model.encode_image(image_data)

# Encode text
text = tokenizer(["a dog", "a cat", "a car"])
with torch.no_grad():
    text_features = model.encode_text(text.to(device))

# Compute similarity
image_features /= image_features.norm(dim=-1, keepdim=True)
text_features /= text_features.norm(dim=-1, keepdim=True)
similarity = (image_features @ text_features.T).softmax(dim=-1)

print(f"Similarity scores: {similarity}")
```

### For CJK (Chinese/Japanese/Korean) Content
```python
# Combine OpenCLIP with language-specific models
# Option 1: Use multilingual CLIP variants
model, _, preprocess = open_clip.create_model_and_transforms(
    'ViT-bigG-14',
    pretrained='laion2b_s39b_b160k'
)

# Option 2: Pair with PaddleOCR for Korean/Chinese text extraction
# See section 6 for OCR setup
```

## 5. Image Understanding Patterns

### Single Image Analysis
```python
def analyze_single_image(image_path: str) -> dict:
    """Generic pattern for analyzing one image"""
    # 1. Load image
    # 2. Send to VLM with specific prompt
    # 3. Parse structured response
    
    prompt = """Analyze this image and provide:
    1. Main subjects/objects
    2. Text content (if any)
    3. Layout/composition
    4. Color palette
    5. Overall purpose/context"""
    
    return vlm.analyze(image_path, prompt)
```

### Multi-Image Comparison
```python
def compare_images(before_path: str, after_path: str) -> dict:
    """Compare two versions of the same scene"""
    prompt = """Compare these two images and identify:
    1. What changed between them
    2. What stayed the same
    3. Significance of changes
    4. Any visual inconsistencies"""
    
    return vlm.compare([before_path, after_path], prompt)
```

### Document Understanding
```python
def extract_from_document(doc_path: str) -> dict:
    """Extract structured data from documents"""
    prompt = """Extract structured information from this document:
    1. Document type
    2. Key fields and values
    3. Tables (as JSON)
    4. Any handwritten annotations
    5. Overall document state (incomplete/complete/etc)"""
    
    return vlm.analyze(doc_path, prompt)
```

### Chart/Graph Interpretation
```python
def interpret_chart(chart_path: str) -> dict:
    """Extract data and insights from charts"""
    prompt = """Analyze this chart and provide:
    1. Chart type (bar, line, pie, etc)
    2. Axes labels and units
    3. Key data points
    4. Trends or patterns
    5. Title and legend information
    6. Export data as JSON"""
    
    return vlm.analyze(chart_path, prompt)
```

### UI Screenshot Analysis
```python
def analyze_ui(screenshot_path: str) -> dict:
    """Analyze UI components and structure"""
    prompt = """Analyze this UI screenshot:
    1. Identify all UI components (buttons, forms, etc)
    2. Extract text labels and values
    3. Describe layout hierarchy
    4. Identify interactive elements
    5. Note accessibility concerns
    6. Generate DOM-like structure"""
    
    return vlm.analyze(screenshot_path, prompt)
```

## 6. OCR Pipeline

### Tesseract OCR (Basic)
```bash
# Install dependencies
brew install tesseract  # macOS
# or apt-get install tesseract-ocr  # Linux

pip install pytesseract pillow
```

```python
from pytesseract import pytesseract
from PIL import Image

def extract_text_tesseract(image_path: str) -> str:
    img = Image.open(image_path)
    text = pytesseract.image_to_string(img)
    return text

# For Korean text specifically
def extract_korean_text(image_path: str) -> str:
    img = Image.open(image_path)
    # Tesseract needs Korean language data
    text = pytesseract.image_to_string(img, lang='kor+eng')
    return text
```

### PaddleOCR (Better for CJK)
```bash
pip install paddleocr
```

```python
from paddleocr import PaddleOCR

def extract_text_paddle(image_path: str, language: str = 'ko') -> str:
    """
    language options: 'en', 'ch', 'ko', 'ja', or combinations like 'ch_sim+en'
    """
    ocr = PaddleOCR(use_angle_cls=True, lang=language)
    result = ocr.ocr(image_path, cls=True)
    
    # Parse results
    extracted_text = "\n".join([line[0][1] for line in result[0]])
    return extracted_text

def extract_with_confidence(image_path: str):
    """Extract text with confidence scores"""
    ocr = PaddleOCR(use_angle_cls=True, lang='ko')
    result = ocr.ocr(image_path, cls=True)
    
    output = []
    for line in result[0]:
        text, confidence = line[0][1], line[1]
        output.append({"text": text, "confidence": confidence})
    
    return output
```

### VLM-Based OCR (Context-Aware)
```python
def extract_text_vlm(image_path: str) -> dict:
    """Use VLM for intelligent text extraction"""
    prompt = """Extract all text from this image:
    1. Preserve layout/formatting
    2. Note text confidence (clear vs blurry)
    3. Identify text type (printed/handwritten/mixed)
    4. Mark any unclear sections
    5. Return as structured JSON"""
    
    return vlm.analyze(image_path, prompt)
```

### Comparison & When to Use

| Method | Speed | Accuracy | CJK | Handwriting | Code |
|--------|-------|----------|-----|-------------|------|
| **Tesseract** | Fast | Medium | Limited | Poor | Simple |
| **PaddleOCR** | Medium | High | Excellent | Better | Medium |
| **VLM-based** | Slow | Highest | Excellent | Good | Simple |

**Recommendation**: Use PaddleOCR for Korean/Chinese text extraction, VLM for when context matters.

## 7. Image Generation (Brief Overview)

### Local Setup: Stable Diffusion
```bash
# Option 1: ComfyUI (node-based, flexible)
git clone https://github.com/comfyanonymous/ComfyUI
cd ComfyUI
pip install -r requirements.txt

# Option 2: AUTOMATIC1111 WebUI (simple)
git clone https://github.com/AUTOMATIC1111/stable-diffusion-webui
cd stable-diffusion-webui
./webui.sh
```

### Cloud APIs
- **DALL-E 3** (OpenAI): highest quality, paid
- **Stable Diffusion (API)**: cost-effective, good quality

### Latest Open-Source: Flux
```bash
pip install diffusers transformers

from diffusers import FluxPipeline
import torch

pipe = FluxPipeline.from_pretrained(
    "black-forest-labs/FLUX.1-dev",
    torch_dtype=torch.bfloat16
)
pipe.enable_attention_slicing()

image = pipe(
    "A serene landscape with mountains and lake",
    height=1024,
    width=1024,
    guidance_scale=3.5,
    num_inference_steps=50
).images[0]

image.save("output.png")
```

### Note on Image Generation vs Understanding
- **VLM (this guide)**: Understand, analyze, extract from existing images
- **Diffusion Models**: Create new images from text descriptions
- They're complementary but distinct capabilities

## 8. Multimodal RAG (Retrieval-Augmented Generation)

### Image Embeddings for Retrieval
```python
import open_clip
import torch
import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

class ImageRetriever:
    def __init__(self, model_name='ViT-B-32'):
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained='openai'
        )
        self.model = self.model.to(self.device)
        self.tokenizer = open_clip.get_tokenizer(model_name)
        self.image_embeddings = {}
    
    def index_images(self, image_paths: list):
        """Create embeddings for a collection of images"""
        with torch.no_grad():
            for path in image_paths:
                image = Image.open(path)
                image_data = self.preprocess(image).unsqueeze(0).to(self.device)
                embedding = self.model.encode_image(image_data).cpu().numpy()
                self.image_embeddings[path] = embedding
    
    def search(self, query: str, k: int = 5) -> list:
        """Search for images similar to text query"""
        query_tokens = self.tokenizer([query]).to(self.device)
        with torch.no_grad():
            query_embedding = self.model.encode_text(query_tokens).cpu().numpy()
        
        # Find top-k similar images
        similarities = {}
        for path, embedding in self.image_embeddings.items():
            sim = cosine_similarity([query_embedding[0]], [embedding[0]])[0][0]
            similarities[path] = sim
        
        return sorted(similarities.items(), key=lambda x: x[1], reverse=True)[:k]
```

### Mixed Document Indexing
```python
from llamaindex import SimpleDirectoryReader, VectorStoreIndex
from llama_index.embeddings import OpenAIEmbedding

# Index both text and images
documents = SimpleDirectoryReader(
    input_dir="./documents",
    image_mode="embed"  # Embed images as part of indexing
).load_data()

index = VectorStoreIndex.from_documents(
    documents,
    embed_model=OpenAIEmbedding()
)

# Query across text and images
results = index.as_query_engine().query(
    "Show me documents with tables about revenue"
)
```

### Visual Question Answering Over Collections
```python
class MultimodalRAG:
    def __init__(self, document_paths: list):
        self.documents = self._index_documents(document_paths)
    
    def _index_documents(self, paths: list) -> dict:
        """Extract images and text from documents"""
        indexed = {}
        for path in paths:
            # Extract images and OCR
            images = extract_images(path)
            ocr_text = extract_ocr_text(path)
            indexed[path] = {"images": images, "text": ocr_text}
        return indexed
    
    def visual_qa(self, question: str) -> list:
        """Answer questions using visual and textual content"""
        results = []
        
        # For each document's images
        for doc_path, content in self.documents.items():
            for image in content["images"]:
                # Ask VLM about the image
                response = vlm.analyze(image, question)
                if response["confidence"] > 0.7:
                    results.append({
                        "source": doc_path,
                        "answer": response["answer"],
                        "confidence": response["confidence"]
                    })
        
        return sorted(results, key=lambda x: x["confidence"], reverse=True)
```

## 9. Small Vision Models (SLM) for Edge

### Phi-3-Vision (4.2B)
```python
from transformers import AutoModelForCausalLM, AutoProcessor
from PIL import Image

def phi3_analyze(image_path: str, prompt: str):
    model = AutoModelForCausalLM.from_pretrained(
        "microsoft/phi-3-vision-128k-instruct",
        device_map="auto",
        trust_remote_code=True,
        torch_dtype="auto"
    )
    processor = AutoProcessor.from_pretrained(
        "microsoft/phi-3-vision-128k-instruct",
        trust_remote_code=True
    )
    
    image = Image.open(image_path)
    messages = [
        {"role": "user", "content": f"<|image_1|>\n{prompt}"},
    ]
    
    text = processor.tokenizer.apply_chat_template(
        messages,
        tokenize=False,
        add_generation_prompt=True
    )
    
    image_data = processor(text, [image], return_tensors="pt", padding=True)
    
    outputs = model.generate(
        **image_data,
        max_new_tokens=128,
        do_sample=False
    )
    
    return processor.decode(outputs[0], skip_special_tokens=True)
```

### MiniCPM-V (2B-8B)
```bash
# Ultra-lightweight, good for mobile/edge
ollama pull minicpm-v

# Or use transformers
pip install transformers pillow
```

```python
from transformers import AutoModel, AutoTokenizer
from PIL import Image

def minicpm_analyze(image_path: str, prompt: str):
    model = AutoModel.from_pretrained(
        "openbmb/MiniCPM-V",
        trust_remote_code=True,
        torch_dtype="auto"
    ).to('cuda')
    tokenizer = AutoTokenizer.from_pretrained(
        "openbmb/MiniCPM-V",
        trust_remote_code=True
    )
    
    image = Image.open(image_path).convert('RGB')
    response = model.chat(
        image=image,
        msgs=[{"role": "user", "content": prompt}],
        tokenizer=tokenizer
    )
    
    return response
```

### Trade-offs Table

| Model | Size | Speed | Accuracy | Memory | Use Case |
|-------|------|-------|----------|--------|----------|
| **Phi-3-Vision** | 4.2B | Very Fast | Good | 8GB | General edge |
| **MiniCPM-V** | 2B-8B | Fastest | Decent | 4-8GB | Mobile/edge |
| **LLaVA-7B** | 7B | Fast | Good | 16GB | Balanced |
| **Qwen2-VL-7B** | 7B | Medium | Very Good | 16GB | CJK-optimized |

## 10. Best Practices

### Image Preprocessing
```python
from PIL import Image
import torchvision.transforms as transforms

def preprocess_image(image_path: str, target_size: int = 512):
    """Prepare image for VLM input"""
    img = Image.open(image_path).convert('RGB')
    
    # Resize maintaining aspect ratio
    img.thumbnail((target_size, target_size), Image.Resampling.LANCZOS)
    
    # Pad to square
    canvas = Image.new('RGB', (target_size, target_size), (255, 255, 255))
    offset = ((target_size - img.width) // 2, (target_size - img.height) // 2)
    canvas.paste(img, offset)
    
    return canvas
```

### Prompt Engineering for VLMs
```python
# GOOD: Specific, structured prompts
good_prompt = """Analyze this invoice and extract:
1. Invoice number
2. Date
3. Total amount
4. Line items (product, quantity, price)
5. Payment terms

Format as JSON."""

# POOR: Vague prompts
poor_prompt = "What's in this image?"

# EXCELLENT: Chain-of-thought
excellent_prompt = """Analyze this screenshot step-by-step:
1. Identify the application/platform
2. List all visible text content
3. Describe the layout structure
4. Note any error messages or warnings
5. Summarize the user's action context

Think through each step before responding."""
```

### Batch Processing Multiple Images
```python
from concurrent.futures import ThreadPoolExecutor
import time

def batch_analyze_images(image_paths: list, prompt: str, max_workers: int = 4):
    """Process multiple images efficiently"""
    results = {}
    
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {
            executor.submit(vlm.analyze, path, prompt): path
            for path in image_paths
        }
        
        for future in concurrent.futures.as_completed(futures):
            path = futures[future]
            try:
                results[path] = future.result()
            except Exception as e:
                results[path] = {"error": str(e)}
            
            # Rate limiting for cloud APIs
            time.sleep(0.1)
    
    return results
```

### Cost Optimization Strategy
```
High Volume, Lower Precision:
  → Use local VLMs (Ollama, vLLM)
  → Batch processing

High Precision, Lower Volume:
  → Use Claude/GPT-4o (API)
  → Per-request

Medium Volume, CJK Text:
  → Use Qwen-VL (local) + PaddleOCR
  → Cost-effective combination

Real-time Edge Deployment:
  → Phi-3-Vision or MiniCPM-V
  → Minimize network calls
```

### Error Handling & Validation
```python
def safe_vlm_analyze(image_path: str, prompt: str, retries: int = 3) -> dict:
    """Robust VLM analysis with error handling"""
    
    # Validate image exists and is readable
    try:
        img = Image.open(image_path)
        img.verify()
    except Exception as e:
        return {"error": f"Invalid image: {e}"}
    
    # Retry logic for API failures
    for attempt in range(retries):
        try:
            result = vlm.analyze(image_path, prompt)
            
            # Validate response structure
            if not result.get("answer"):
                raise ValueError("Empty response from VLM")
            
            return result
        
        except Exception as e:
            if attempt == retries - 1:
                return {"error": f"VLM analysis failed: {e}"}
            
            # Exponential backoff
            time.sleep(2 ** attempt)
    
    return {"error": "Max retries exceeded"}
```

---

## Quick Reference

### Installation Checklist
- [ ] Ollama installed for local VLMs
- [ ] PaddleOCR for CJK text extraction
- [ ] OpenCLIP for image embeddings
- [ ] Tesseract as fallback OCR
- [ ] torch/transformers for advanced setups

### Common Patterns
1. **Single Image**: Direct VLM call
2. **Multiple Images**: Batch via Ollama or vLLM
3. **Text Extraction**: PaddleOCR (CJK) or VLM (context-aware)
4. **Similarity Search**: OpenCLIP embeddings
5. **RAG**: LlamaIndex with multimodal support

### Model Selection Guide
- **Cloud, best quality**: GPT-4o, Claude Sonnet
- **Local, balanced**: LLaVA-13B, Qwen2-VL-7B
- **Local, fast**: Phi-3-Vision
- **Local, edge**: MiniCPM-V
