---
name: Qprompt-engineer
description: "Writes, refactors, and evaluates prompts for LLMs — generating optimized prompt templates, structured output schemas, evaluation rubrics, and test suites. Covers zero-shot, few-shot, CoT, ReAct, RCCF framework, JSON/function-calling schemas, system prompts with personas and guardrails, A/B testing, and LLM-as-Judge evaluation. Use for prompt design, prompt optimization, few-shot, chain-of-thought, prompt testing, prompt evaluation, structured outputs."
invocation_trigger: "When designing prompts, optimizing LLM outputs, setting up prompt testing, or evaluating prompt quality."
recommendedModel: sonnet
---

# Qprompt-engineer Skill

Comprehensive guide to prompt engineering patterns, optimization techniques, and evaluation frameworks for LLM applications.

## 1. Core Patterns

### Zero-Shot Prompting
Direct instruction without examples. Effective when the task is straightforward and the model has sufficient training data.

**When to use:**
- Task is well-defined in natural language
- No ambiguity in expected output
- Task is common (code generation, summarization, classification)

**Example:**
```
Classify the sentiment of this product review: "This laptop is incredibly fast and the battery life is exceptional."
Answer with one word: positive, negative, or neutral.
```

### Few-Shot Prompting
Provide 2-5 examples demonstrating the task. Dramatically improves format adherence and task understanding.

**When to use:**
- Task requires specific output format
- Model is unfamiliar with the task domain
- You need consistent, structured outputs
- Task has nuanced or domain-specific requirements

**Example:**
```
Classify reviews as positive or negative.

Examples:
Review: "Fastest delivery ever!"
Category: positive

Review: "Product arrived broken."
Category: negative

Review: "It's okay, nothing special."
Category: neutral

Now classify this:
Review: "The quality exceeded my expectations."
Category:
```

**Best practices:**
- Use 2-5 examples (diminishing returns beyond 5)
- Ensure examples span the output space
- Include edge cases or ambiguous examples
- Keep examples concise

### Chain-of-Thought (CoT)
Encourage step-by-step reasoning. Less critical on modern models (Claude 3.5+) for basic tasks, but still valuable for complex reasoning.

**When to use:**
- Multi-step reasoning required
- Mathematical or logical problems
- Tasks requiring intermediate justification
- When you need to debug model reasoning

**Example:**
```
Solve this step-by-step:
If a store has 50 apples and sells 12 apples per hour for 3 hours, how many apples remain?

Step 1: Calculate total apples sold
Step 2: Subtract from initial count
Step 3: State final answer
```

### Self-Consistency
Run the same prompt multiple times (5-15 runs) and take the majority vote. Typically provides 5-15% accuracy improvement.

**Implementation:**
```python
def self_consistency_voting(prompt, n_runs=5, model="claude"):
    results = []
    for _ in range(n_runs):
        response = call_model(prompt, model)
        results.append(extract_answer(response))
    
    # Return most common answer
    return max(set(results), key=results.count)
```

**When to use:**
- High-stakes decision making
- Mathematical or logic problems
- When accuracy improvement justifies cost

### Tree-of-Thought
Explore multiple reasoning paths in parallel, evaluate each, and backtrack if needed.

**Example:**
```
Think about this problem from multiple angles:

Approach 1: [Direct path]
Evaluate: strengths/weaknesses

Approach 2: [Alternative path]
Evaluate: strengths/weaknesses

Approach 3: [Creative path]
Evaluate: strengths/weaknesses

Choose the best approach and explain why.
```

## 2. Advanced Patterns

### ReAct (Reasoning + Acting)
Interleave Thought → Action → Observation cycles for complex problem solving.

**Example flow:**
```
Thought: I need to find the capital of France.
Action: Search for "capital of France"
Observation: The search returned "Paris is the capital of France."
Thought: I have the answer.
Final Answer: Paris
```

**Implementation in prompt:**
```
Answer questions by following this pattern:
Thought: [Reasoning about what to do]
Action: [Specific action to take - search, calculate, lookup, code]
Observation: [Result of action]
(repeat as needed)
Final Answer: [Your conclusion]

Question: [User question]
```

### Prompt Chaining
Sequential prompts where output of one feeds into the next. Reduces token usage and improves consistency.

**Example:**
```
Step 1: Summarize the document
summarize_prompt = "Summarize this document in 3 sentences: {document}"
summary = call_model(summarize_prompt)

Step 2: Extract key claims
extract_prompt = "From this summary, extract key factual claims: {summary}"
claims = call_model(extract_prompt)

Step 3: Verify claims
verify_prompt = "For each claim, rate confidence (high/medium/low): {claims}"
verified = call_model(verify_prompt)
```

### Meta-Prompting
Ask the model to write or improve its own prompt. Surprisingly effective.

**Example:**
```
You are a prompt engineering expert. I need to create a prompt that:
1. Extracts named entities from legal documents
2. Categorizes them (person, organization, location, date)
3. Returns JSON format

Write a high-quality prompt for this task. The prompt should include examples.
```

### Constitutional AI / Self-Critique
Ask the model to critique and improve its own response.

**Example:**
```
First, answer the question: [question]

Then, critique your answer using these principles:
1. Is it factually accurate?
2. Is it complete?
3. Are there edge cases I missed?
4. How could it be improved?

Finally, provide a revised answer based on your critique.
```

## 3. The RCCF Framework (2026 Best Practice)

**R**ole → **C**ontext → **C**onstraint → **F**ormat

A structured approach to prompt design that consistently produces better results.

### Structure:
```
[ROLE]
You are a [specific role/expertise level].

[CONTEXT]
[Background information, examples, domain knowledge the model needs]

[CONSTRAINT]
[Specific requirements, limitations, what NOT to do]

[FORMAT]
[Explicit output structure]
```

### Full Example:
```
Role:
You are a senior code reviewer specializing in Python performance optimization.

Context:
You review code for issues including algorithmic inefficiency, memory leaks, 
unnecessary allocations, and N+1 query patterns. You understand both 
theoretical computer science and practical performance profiling.

Examples of inefficiency you catch:
- Iterating a list inside a loop when a set lookup would work
- Creating intermediate lists when generators would suffice
- Repeated calculations that could be cached

Constraint:
- Do not suggest refactoring for readability alone unless performance is unaffected
- Do not recommend external libraries if built-in solutions exist
- Flag any changes that would alter API contracts
- Assume Python 3.11+

Format:
Provide your review as JSON:
{
  "issues": [
    {
      "line": number,
      "severity": "critical|high|medium",
      "problem": "description",
      "suggestion": "specific code change",
      "impact": "estimated performance improvement"
    }
  ],
  "overall_assessment": "summary"
}
```

## 4. Model-Specific Tips

| Aspect | Claude | GPT-4o | Open-Source (Llama 2/3) |
|--------|--------|--------|-------------------------|
| **Structure** | XML tags preferred; native to training | Markdown lists, numbered; works with XML | Plain text, markdown; XML less reliable |
| **Persona/Tone** | Responds well to collaborative tone; avoid aggressive emphasis | Aggressive "YOU MUST" can work but diminishing returns | Responds better to direct commands |
| **Chain-of-Thought** | Excellent for complex reasoning; <reasoning> tags effective | Native CoT support; good with "think step by step" | Often needs explicit examples more than CoT |
| **Context Window** | 200K (Opus), 100K (Sonnet); handles long documents well | 128K; efficient summarization recommended | 4-8K (Llama 2), 8K (Llama 3); plan for summary chains |
| **JSON Mode** | Native JSON output support | Native JSON mode (gpt-4-turbo) | Text-based JSON; validate output |
| **Self-Correction** | Very responsive to "reconsider" or "you missed" | Good; can be explicit about error patterns | Works with examples of corrections |
| **Long Outputs** | Handles naturally; ~2K token outputs common | Can be verbose; explicit brevity instruction helps | Tends shorter; request specific length |

### Concrete Tips by Model:

**Claude (Haiku, Sonnet, Opus):**
- Use XML tags for structure: `<task>, <examples>, <format>`
- Avoid imperative all-caps ("YOU MUST") — it slightly decreases performance
- Takes collaborative tone well: "Help me..." works better than "Do this..."
- Excellent at tracking state across long conversations

**GPT-4o:**
- Works well with "think step by step" prefix
- Handles lists naturally; numbered instructions are processed well
- Good at following JSON schemas; use `schema=` parameter if available
- Slightly more sensitive to prompt length; truncate irrelevant examples

**Open-Source (Llama 3, Mistral):**
- Needs more explicit examples; few-shot is often required for tasks Claude handles zero-shot
- Prefers plain text instructions over XML
- Chain-of-thought improves results significantly
- Shorter context windows; use summarization chains for long documents

## 5. Anti-Patterns

### 1. Aggressive Emphasis
```
❌ BAD:
"YOU MUST output valid JSON. CRITICAL: ensure no trailing commas!"

✓ GOOD:
"Output valid JSON. Double-check for trailing commas."
```
**Why:** Modern models respond better to clear instruction than to urgency. Aggressive language can paradoxically reduce compliance.

### 2. Redundant Chain-of-Thought
```
❌ BAD: "Let's think step by step" for basic classification tasks

✓ GOOD: Use CoT only for reasoning, math, or multi-step logic
```

### 3. Context Overload
```
❌ BAD: Providing 50 examples and 2000 lines of background

✓ GOOD: 3-5 representative examples + essential context only
```

### 4. Instruction Conflicts
```
❌ BAD:
"Output JSON. Also be conversational. Also keep it under 100 tokens."

✓ GOOD:
"Output JSON in this exact format. Be concise (100 tokens max)."
```

### 5. Model-Agnostic Prompting
```
❌ BAD: Assuming same prompt works identically on Claude, GPT-4, and Llama

✓ GOOD: Test on target model; adjust structure for model-specific preferences
```

### 6. No Output Format Specification
```
❌ BAD: "Analyze this code."

✓ GOOD: "Analyze this code. Output a JSON object with keys: issues, severity, fix."
```

## 6. Evaluation Framework

### LLM-as-Judge Pattern

Use the model itself to evaluate outputs. Highly effective for subjective tasks.

**Scoring Prompt Template:**
```
You are an expert evaluator assessing [task type] outputs.

Rubric:
- Accuracy (0-10): Does it answer the question correctly?
- Completeness (0-10): Does it cover all required aspects?
- Clarity (0-10): Is the explanation easy to follow?
- Relevance (0-10): Does it stay focused on the question?

Reference Answer (for context): [correct answer or expected output]

Output to evaluate: [candidate output]

Provide scores and brief justification for each criterion.
Return as JSON: {"accuracy": X, "completeness": X, "clarity": X, "relevance": X, "overall": X}
```

**Implementation:**
```python
def evaluate_with_llm_judge(output, reference, rubric, model="claude"):
    prompt = f"""
    Rubric: {rubric}
    Reference: {reference}
    Output: {output}
    
    Score and justify each criterion.
    Return JSON with scores.
    """
    
    response = call_model(prompt, model)
    scores = parse_json(response)
    return scores
```

### A/B Testing Methodology

1. **Define Rubric:** Specify scoring criteria (accuracy, tone, length, etc.)
2. **Create Test Set:** 10-30 representative test cases
3. **Run Both Prompts:** Generate outputs for each variant
4. **Score with LLM-as-Judge:** Use consistent evaluator
5. **Calculate Statistics:** Mean, std dev, 95% CI for each variant
6. **Significance Test:** Use paired t-test (n ≥ 20) or bootstrap (n < 20)

**Example A/B Test:**
```python
def ab_test_prompts(test_cases, prompt_a, prompt_b, n_trials=30):
    """
    Compare two prompts using A/B testing.
    """
    results = {"a": [], "b": []}
    
    for case in test_cases:
        # Run prompt A multiple times (self-consistency)
        scores_a = []
        for _ in range(n_trials):
            output = call_model(prompt_a.format(case=case))
            score = evaluate_output(output, case["expected"])
            scores_a.append(score)
        
        results["a"].append(mean(scores_a))
        
        # Run prompt B multiple times
        scores_b = []
        for _ in range(n_trials):
            output = call_model(prompt_b.format(case=case))
            score = evaluate_output(output, case["expected"])
            scores_b.append(score)
        
        results["b"].append(mean(scores_b))
    
    # Calculate statistics
    mean_a = mean(results["a"])
    mean_b = mean(results["b"])
    std_a = stdev(results["a"])
    std_b = stdev(results["b"])
    
    # Paired t-test
    t_stat, p_value = ttest_rel(results["a"], results["b"])
    
    return {
        "prompt_a_mean": mean_a,
        "prompt_b_mean": mean_b,
        "difference": mean_b - mean_a,
        "p_value": p_value,
        "significant": p_value < 0.05
    }
```

## 7. Prompt Templates

### 1. Classification Prompt (RCCF)

```
Role:
You are an expert text classifier with 10+ years of experience categorizing documents.

Context:
You classify support tickets into priority categories. High priority tickets 
require immediate action (security, data loss, service down). Medium priority 
includes performance issues and bug reports. Low priority is feature requests 
and documentation questions.

Examples:
Ticket: "Our database is returning 500 errors on all queries."
Priority: high

Ticket: "Can you add dark mode to the dashboard?"
Priority: low

Constraint:
- Classify based on impact, not emotional language
- If ambiguous, ask clarifying questions in your reasoning
- Do not assign priority based on seniority of requester

Format:
Output JSON:
{
  "priority": "high|medium|low",
  "reasoning": "why you chose this priority",
  "confidence": 0.0-1.0,
  "clarification_needed": [questions if ambiguous]
}

Ticket to classify: [ticket text]
```

### 2. Extraction Prompt (RCCF)

```
Role:
You are a subject matter expert in extracting structured data from unstructured text.

Context:
You extract named entities from customer contracts, identifying:
- Party names (organization names)
- Key dates (start, end, renewal)
- Payment terms (amount, frequency)
- Service description

Example contract excerpt:
"Acme Corp (the Company) agrees to provide consulting services to Smith & Co. 
(the Client) starting January 1, 2024 through December 31, 2025. Payment of 
$50,000 annually, due on January 1st each year."

Extracted:
{
  "party_1": "Acme Corp",
  "party_2": "Smith & Co",
  "start_date": "2024-01-01",
  "end_date": "2025-12-31",
  "payment": {"amount": 50000, "currency": "USD", "frequency": "annual"},
  "service": "consulting services"
}

Constraint:
- Extract only what's explicitly stated; do not infer
- Use ISO 8601 for dates
- Preserve original entity names exactly as written
- Mark missing fields as null

Format:
Return only valid JSON with the structure above.

Contract text: [contract text]
```

### 3. Summarization Prompt (RCCF)

```
Role:
You are a technical summarization expert who distills complex information 
into clear, actionable summaries.

Context:
You summarize technical incidents for executive stakeholders. Your summaries 
must capture:
- What happened
- Why it happened
- Customer impact (how many users, duration)
- Resolution
- Prevention measures

Key principle: A non-technical executive should understand the summary after reading it.

Constraint:
- 3-5 sentences maximum
- No jargon without explanation (if you use "database replication lag", explain in parentheses)
- Focus on business impact, not technical minutiae
- No recommendations; only facts about what happened

Format:
[Summary text]

Impact: [Number of users affected]
Duration: [How long the incident lasted]
Root cause: [One-line root cause]

Incident: [Full incident report]
```

### 4. Code Review Prompt (RCCF)

```
Role:
You are a senior software engineer with expertise in Python best practices, 
performance optimization, and design patterns.

Context:
You review code pull requests to ensure:
1. Correctness (no bugs, handles edge cases)
2. Performance (no N+1 queries, efficient algorithms)
3. Maintainability (clear variable names, follows conventions)
4. Security (no SQL injection, secrets in code, unvalidated inputs)

You are thorough but not pedantic; you focus on issues that matter.

Constraint:
- Do not nitpick style unless it affects readability
- Do not recommend refactoring for readability alone unless performance improves
- Assume Python 3.11+ and modern frameworks
- Flag any security concerns immediately

Format:
Return JSON:
{
  "summary": "overall assessment",
  "issues": [
    {"line": number, "severity": "critical|high|medium|low", "issue": "...", "suggestion": "..."}
  ],
  "strengths": ["what the author did well"],
  "approved": true|false
}

Code: [code to review]
```

## 8. Prompt Version Management

### Metadata Structure:
```json
{
  "name": "classify_support_ticket",
  "version": "2.3",
  "created_at": "2024-01-15",
  "modified_at": "2026-04-15",
  "model": "claude-3.5-sonnet",
  "description": "Classify support tickets by priority",
  "performance": {
    "accuracy": 0.94,
    "test_set_size": 50,
    "last_evaluated": "2026-04-10"
  }
}
```

### Changelog:
```markdown
## Version History

### v2.3 (2026-04-15)
- Improved handling of ambiguous edge cases
- Added clarification_needed field
- Performance: accuracy 0.94 (+2% from v2.2)

### v2.2 (2026-03-01)
- Changed from 5 to 3 priority levels
- Simplified constraint language

### v2.1 (2026-01-20)
- Initial few-shot examples added
- Moved to RCCF structure

### v1.0 (2024-01-15)
- Zero-shot classification baseline
```

### Rollback Strategy:
```python
def load_prompt_version(name, version="latest"):
    """Load a specific prompt version from version control."""
    if version == "latest":
        version = get_latest_version(name)
    
    prompt_file = f"prompts/{name}/v{version}.md"
    return read_file(prompt_file)

def compare_versions(name, v1, v2):
    """Compare two prompt versions and show performance difference."""
    p1 = load_prompt_version(name, v1)
    p2 = load_prompt_version(name, v2)
    
    perf1 = test_prompt(p1, test_set)
    perf2 = test_prompt(p2, test_set)
    
    return {
        "version_1": {**p1.metadata, "performance": perf1},
        "version_2": {**p2.metadata, "performance": perf2},
        "improvement": perf2["accuracy"] - perf1["accuracy"]
    }
```

### Best Practices:
- **Version every prompt in production.** Use semantic versioning (major.minor.patch).
- **Track performance metrics with each version.** Measure before/after on consistent test set.
- **Store prompts in version control.** Keep JSON metadata + prompt text together.
- **Document changes in CHANGELOG.** Brief note of what changed and why.
- **Never delete old versions.** Keep ability to rollback if new version underperforms.
- **Tag stable versions.** Mark versions approved for production.

---

## Quick Reference Checklist

- [ ] Define Role (what expertise should the model assume?)
- [ ] Provide Context (background, examples, domain knowledge)
- [ ] State Constraints (what NOT to do)
- [ ] Specify Format (exactly how should output be structured?)
- [ ] Test on target model (prompts are model-specific)
- [ ] Use few-shot examples (2-5) for complex tasks
- [ ] Evaluate with LLM-as-Judge on test set (10+ examples)
- [ ] Track version and performance metrics
- [ ] Avoid aggressive emphasis and overload

## Further Reading
- OpenAI Prompt Engineering Guide
- Anthropic Prompt Engineering Guide: https://docs.anthropic.com/en/docs/build-a-claude-app/prompt-engineering
- "The Art and Science of Prompt Engineering" (research papers on self-consistency, tree-of-thought)
