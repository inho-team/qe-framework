---
name: Qlangchain-specialist
description: "LangChain and LlamaIndex framework specialist. Covers chains, agents, tools, memory, retrievers, callbacks, and production patterns. Use for LangChain setup, agent building, tool integration, LlamaIndex, AI application development."
invocation_trigger: "When building AI applications with LangChain or LlamaIndex, creating agents with tools, or setting up AI chains/pipelines."
recommendedModel: sonnet
---

# Qlangchain-specialist Skill

## 1. LangChain Core Concepts

### LLM Wrappers
LangChain abstracts different LLM providers through consistent interfaces. Common implementations:

```python
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_ollama import ChatOllama

# Anthropic Claude
llm = ChatAnthropic(
    model="claude-3-5-sonnet-20241022",
    temperature=0.7,
    max_tokens=1024
)

# OpenAI GPT
llm = ChatOpenAI(
    model="gpt-4-turbo",
    temperature=0.7,
    api_key="..."
)

# Local Ollama
llm = ChatOllama(
    model="mistral",
    base_url="http://localhost:11434"
)
```

### Prompt Templates
Use ChatPromptTemplate to compose dynamic prompts with variables:

```python
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

# Simple template
prompt = ChatPromptTemplate.from_template(
    "You are a helpful assistant. Answer: {question}"
)

# With message history
prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    MessagesPlaceholder(variable_name="chat_history"),
    ("human", "{question}")
])

# Formatted message
formatted = prompt.format(question="What is Python?", chat_history=[])
```

### Output Parsers
Parse LLM output into structured data:

```python
from langchain_core.output_parsers import (
    StrOutputParser,
    JsonOutputParser,
    PydanticOutputParser
)
from pydantic import BaseModel

# String output
parser = StrOutputParser()

# JSON output
parser = JsonOutputParser()

# Pydantic model output
class Person(BaseModel):
    name: str
    age: int
    skills: list[str]

parser = PydanticOutputParser(pydantic_object=Person)
prompt = ChatPromptTemplate.from_template(
    "Extract person info from: {text}\n{format_instructions}"
)
chain = prompt | llm | parser
```

### LCEL (LangChain Expression Language)
LCEL uses the pipe operator `|` to chain components declaratively:

```python
# Simple chain
chain = prompt | llm | StrOutputParser()

# With input preprocessing
chain = (
    {"text": RunnablePassthrough()}
    | prompt
    | llm
    | StrOutputParser()
)

# Invoke chain
result = chain.invoke({"question": "What is AI?"})

# Async stream
async for chunk in chain.astream({"question": "Explain AI"}):
    print(chunk, end="", flush=True)
```

---

## 2. Chains

### Simple Linear Chain
The most basic chain: prompt → model → parser

```python
from langchain_core.prompts import ChatPromptTemplate
from langchain_core.output_parsers import StrOutputParser
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")
prompt = ChatPromptTemplate.from_template("Summarize: {text}")
chain = prompt | llm | StrOutputParser()

result = chain.invoke({"text": "Long article here..."})
```

### Sequential Chain (RunnableSequence)
Chain multiple steps in sequence:

```python
from langchain_core.runnables import RunnableSequence

step1 = ChatPromptTemplate.from_template("Summarize: {text}") | llm | StrOutputParser()
step2 = ChatPromptTemplate.from_template("Translate to French: {summary}") | llm | StrOutputParser()

chain = step1 | step2
result = chain.invoke({"text": "Original text"})
```

### Parallel Chain (RunnableParallel)
Execute multiple branches and combine results:

```python
from langchain_core.runnables import RunnableParallel

parallel_chain = RunnableParallel(
    summary=ChatPromptTemplate.from_template("Summarize: {text}") | llm | StrOutputParser(),
    sentiment=ChatPromptTemplate.from_template("Analyze sentiment: {text}") | llm | StrOutputParser(),
    length=ChatPromptTemplate.from_template("Count words in: {text}") | llm | StrOutputParser()
)

result = parallel_chain.invoke({"text": "Your text"})
# result = {"summary": "...", "sentiment": "...", "length": "..."}
```

### Branching Chain (RunnableBranch)
Conditional routing based on input:

```python
from langchain_core.runnables import RunnableBranch

def route_by_length(x):
    return len(x.get("text", "")) > 500

chain = RunnableBranch(
    (lambda x: len(x["text"]) > 500, long_text_chain),
    (lambda x: len(x["text"]) > 100, medium_text_chain),
    short_text_chain  # default
)

result = chain.invoke({"text": "Your text"})
```

---

## 3. Agents

### ReAct Agent (Reasoning + Acting)
Think-act-observe loop for complex tasks:

```python
from langchain import hub
from langchain.agents import create_react_agent, AgentExecutor
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")

# Define tools
tools = [search_tool, calculator_tool, retriever_tool]

# Load prompt template
prompt = hub.pull("hwchase17/react")

# Create agent
agent = create_react_agent(llm, tools, prompt)

# Execute with limits
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    max_iterations=5,
    handle_parsing_errors=True,
    verbose=True
)

result = executor.invoke({"input": "What is 25 * 4 and search the web for..."})
```

### Tool-Calling Agent (Modern approach, native function calling)
Uses native LLM function calling instead of ReAct prompting:

```python
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")
tools = [search_tool, calculator_tool]

agent = create_tool_calling_agent(llm, tools, prompt)

executor = AgentExecutor(
    agent=agent,
    tools=tools,
    verbose=True
)

result = executor.invoke({"input": "Complex task requiring multiple tools"})
```

### Custom Tools
Define tools with the `@tool` decorator or Tool class:

```python
from langchain_core.tools import tool
from pydantic import BaseModel, Field

# Decorator approach
@tool
def multiply(a: int, b: int) -> int:
    """Multiply two numbers."""
    return a * b

# Class approach with Pydantic
from langchain_core.tools import StructuredTool

class CalculatorInput(BaseModel):
    a: int = Field(description="First number")
    b: int = Field(description="Second number")
    operation: str = Field(description="Operation: add, subtract, multiply, divide")

def calculator(a: int, b: int, operation: str) -> float:
    """Perform arithmetic operation."""
    ops = {
        "add": lambda x, y: x + y,
        "subtract": lambda x, y: x - y,
        "multiply": lambda x, y: x * y,
        "divide": lambda x, y: x / y
    }
    return ops[operation](a, b)

tool = StructuredTool.from_function(
    func=calculator,
    name="calculator",
    description="Performs arithmetic operations",
    args_schema=CalculatorInput
)
```

### AgentExecutor Configuration
Control agent behavior:

```python
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    max_iterations=10,           # Max steps before stopping
    max_execution_time=60,       # Timeout in seconds
    handle_parsing_errors=True,  # Don't crash on parse errors
    return_intermediate_steps=True,  # Include reasoning steps
    verbose=True,                # Print debugging info
    early_stopping_method="force"  # Stop on max iterations
)

result = executor.invoke({"input": "..."})
result["intermediate_steps"]  # Access reasoning chain
```

### Complete Agent Example
Full working example:

```python
from langchain_anthropic import ChatAnthropic
from langchain.agents import create_tool_calling_agent, AgentExecutor
from langchain_core.tools import tool
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")

@tool
def weather(location: str) -> str:
    """Get weather for a location."""
    return f"Sunny in {location}, 72F"

@tool
def calculate(expression: str) -> float:
    """Evaluate a math expression."""
    return eval(expression)

tools = [weather, calculate]

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a helpful assistant."),
    MessagesPlaceholder(variable_name="chat_history"),
    ("human", "{input}"),
    MessagesPlaceholder(variable_name="agent_scratchpad")
])

agent = create_tool_calling_agent(llm, tools, prompt)
executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

# Run
result = executor.invoke({"input": "What's the weather in NYC and what's 15+25?"})
```

---

## 4. Memory & State

### ConversationBufferMemory
Keeps entire conversation history. Simple but grows unbounded:

```python
from langchain.memory import ConversationBufferMemory

memory = ConversationBufferMemory(
    memory_key="chat_history",
    return_messages=True  # Return as message objects
)

memory.save_context(
    {"input": "Hi there!"},
    {"output": "Hello! How can I help?"}
)

memory.load_memory_variables({})  # {"chat_history": [...]}
```

### ConversationSummaryMemory
Summarizes old messages to keep context bounded:

```python
from langchain.memory import ConversationSummaryMemory
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")

memory = ConversationSummaryMemory(
    llm=llm,
    memory_key="chat_history",
    return_messages=True
)
```

### ConversationBufferWindowMemory
Keeps only the last N interactions:

```python
from langchain.memory import ConversationBufferWindowMemory

memory = ConversationBufferWindowMemory(
    k=5,  # Keep last 5 exchanges
    memory_key="chat_history",
    return_messages=True
)
```

### RunnableWithMessageHistory (LCEL Native)
Modern approach using LCEL instead of legacy memory classes:

```python
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory

# Create a simple in-memory history store
history_store = {}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in history_store:
        history_store[session_id] = ChatMessageHistory()
    return history_store[session_id]

# Wrap your chain with history
chain_with_history = RunnableWithMessageHistory(
    chain,
    get_session_history,
    input_messages_key="question",
    history_messages_key="chat_history",
    history_factory_config=[ConfigurableFieldSpec(
        id="session_id",
        name="Session ID",
        description="Session identifier"
    )]
)

# Invoke with session tracking
result = chain_with_history.invoke(
    {"question": "What is AI?"},
    config={"configurable": {"session_id": "user_123"}}
)
```

### When to Use Which
- **BufferMemory**: Short conversations, demos
- **SummaryMemory**: Long conversations where quality summary is important
- **BufferWindowMemory**: Conversational agents, cost-sensitive
- **RunnableWithMessageHistory**: Production apps, LCEL-native, flexible backends

---

## 5. Retrievers

### VectorStoreRetriever
Search semantic embeddings for relevant documents:

```python
from langchain_community.vectorstores import FAISS
from langchain_openai import OpenAIEmbeddings
from langchain.retrievers import VectorStoreRetriever

embeddings = OpenAIEmbeddings()
vectorstore = FAISS.from_documents(docs, embeddings)
retriever = vectorstore.as_retriever(
    search_type="similarity",
    search_kwargs={"k": 5}  # Return top 5
)

results = retriever.invoke("What is machine learning?")
```

### MultiQueryRetriever
Generates multiple query variations automatically to improve recall:

```python
from langchain.retrievers.multi_query import MultiQueryRetriever
from langchain_anthropic import ChatAnthropic

llm = ChatAnthropic(model="claude-3-5-sonnet-20241022")

retriever = MultiQueryRetriever.from_llm(
    retriever=base_retriever,
    llm=llm,
    prompt=custom_prompt  # Optional
)

results = retriever.invoke("What is deep learning?")
# Internally generates: "What is deep learning?", "Explain neural networks", etc.
```

### SelfQueryRetriever
Extracts metadata filters from natural language queries:

```python
from langchain.retrievers.self_query.base import SelfQueryRetriever
from langchain_core.structured_query import AttributeInfo

metadata_field_info = [
    AttributeInfo(name="year", description="Publication year", type="integer"),
    AttributeInfo(name="author", description="Document author", type="string"),
    AttributeInfo(name="rating", description="User rating 1-5", type="integer")
]

retriever = SelfQueryRetriever.from_llm(
    llm,
    vectorstore,
    "Document content",
    metadata_field_info,
    enable_limit=True
)

# Query like "Papers by Alice after 2020 with high rating"
# Automatically filters metadata while searching semantically
results = retriever.invoke("Papers by Alice after 2020 with rating > 4")
```

### ParentDocumentRetriever
Retrieves small chunks but returns full parent documents for context:

```python
from langchain.retrievers import ParentDocumentRetriever
from langchain_text_splitters import RecursiveCharacterTextSplitter

child_splitter = RecursiveCharacterTextSplitter(chunk_size=400)
parent_splitter = RecursiveCharacterTextSplitter(chunk_size=2000)

retriever = ParentDocumentRetriever(
    vectorstore=vectorstore,
    docstore=InMemoryStore(),
    child_splitter=child_splitter,
    parent_splitter=parent_splitter
)

# Returns full parent docs even though indexed on small chunks
results = retriever.invoke("Your query")
```

### EnsembleRetriever
Combines multiple retrieval strategies (hybrid search):

```python
from langchain.retrievers import EnsembleRetriever

bm25_retriever = BM25Retriever.from_documents(docs)
vector_retriever = vectorstore.as_retriever()

ensemble = EnsembleRetriever(
    retrievers=[bm25_retriever, vector_retriever],
    weights=[0.4, 0.6]  # Weighted combination
)

results = ensemble.invoke("Your query")
```

### ContextualCompressionRetriever
Reranks and filters retrieved documents for relevance:

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain.retrievers.document_compressors import LLMListwiseReranker

compressor = LLMListwiseReranker.from_llm(
    llm=llm,
    user_prompt="Rank by relevance to: {query}"
)

retriever = ContextualCompressionRetriever(
    base_compressor=compressor,
    base_retriever=base_retriever
)

results = retriever.invoke("Your query")
```

---

## 6. LlamaIndex

### Key Differences from LangChain
- **LangChain**: Chain-centric, composition-focused
- **LlamaIndex**: Index-centric, retrieval-focused
- LlamaIndex is better for RAG applications with structured data indexing

### VectorStoreIndex
Index documents into vector store:

```python
from llama_index.core import VectorStoreIndex, Document

documents = [Document(text="..."), Document(text="...")]
index = VectorStoreIndex.from_documents(documents)

# Query
query_engine = index.as_query_engine()
response = query_engine.query("What is X?")
print(response)
```

### SummaryIndex
Index documents as a summary tree for navigation:

```python
from llama_index.core import SummaryIndex

summary_index = SummaryIndex.from_documents(documents)
query_engine = summary_index.as_query_engine()
response = query_engine.query("Topic overview")
```

### TreeIndex
Create hierarchical document tree:

```python
from llama_index.core import TreeIndex

tree_index = TreeIndex.from_documents(documents)
query_engine = tree_index.as_query_engine()
response = query_engine.query("Hierarchical search")
```

### QueryEngine vs ChatEngine
- **QueryEngine**: Single-turn question answering
- **ChatEngine**: Multi-turn conversation with memory

```python
# Query (single turn)
query_engine = index.as_query_engine()
response = query_engine.query("What is AI?")

# Chat (multi-turn)
chat_engine = index.as_chat_engine()
response = chat_engine.chat("What is AI?")
response = chat_engine.chat("Tell me more about neural networks")
```

### Custom Retriever
Implement custom retrieval logic:

```python
from llama_index.core.retrievers import BaseRetriever
from llama_index.core.schema import NodeWithScore

class CustomRetriever(BaseRetriever):
    def _retrieve(self, query_str, **kwargs):
        # Your custom retrieval logic
        results = your_search_logic(query_str)
        return [NodeWithScore(node=node, score=score) for node, score in results]

retriever = CustomRetriever()
query_engine = index.as_query_engine(retriever=retriever)
```

### When to Choose LlamaIndex
- Building production RAG systems
- Need structured document indexing
- Complex multi-index scenarios
- Metadata filtering from natural language

---

## 7. Production Patterns

### Streaming
Stream responses token-by-token for better UX:

```python
# Sync streaming
for chunk in chain.stream({"question": "Explain quantum computing"}):
    print(chunk, end="", flush=True)

# Async streaming
async for chunk in chain.astream({"question": "..."}):
    print(chunk, end="", flush=True)

# Streaming with agent
executor = AgentExecutor(agent=agent, tools=tools)
async for chunk in executor.astream({"input": "..."}):
    if "actions" in chunk:
        print(f"Agent thinking: {chunk['actions']}")
    if "steps" in chunk:
        print(f"Step output: {chunk['steps']}")
```

### Callbacks (Tracing and Custom Handlers)
Monitor LLM calls and chain execution:

```python
from langchain_core.callbacks import BaseCallbackHandler
from langchain.callbacks.tracers.langsmith import LangSmithTracer

# LangSmith integration (cloud tracing)
os.environ["LANGSMITH_API_KEY"] = "..."
tracer = LangSmithTracer(project_name="my-project")

result = chain.invoke(
    {"input": "..."},
    config={"callbacks": [tracer]}
)

# Custom callback handler
class MyCallbackHandler(BaseCallbackHandler):
    def on_llm_start(self, serialized, prompts, **kwargs):
        print(f"LLM called with {len(prompts)} prompts")
    
    def on_llm_end(self, response, **kwargs):
        print(f"LLM generated {len(response.generations)} responses")

result = chain.invoke(
    {"input": "..."},
    config={"callbacks": [MyCallbackHandler()]}
)
```

### Caching
Cache LLM calls to reduce costs and latency:

```python
from langchain_core.caches import InMemoryCache, SQLiteCache
import langchain_core

# In-memory cache (fast, not persistent)
langchain_core.globals.set_llm_cache(InMemoryCache())

# SQLite cache (persistent)
langchain_core.globals.set_llm_cache(
    SQLiteCache(database_path=".langchain.db")
)

# Calls with identical prompts will hit cache
result1 = llm.invoke("What is AI?")
result2 = llm.invoke("What is AI?")  # Uses cache
```

### Rate Limiting and Retry
Handle API limits gracefully:

```python
from langchain_core.rate_limiters import InMemoryRateLimiter
from tenacity import retry, stop_after_attempt, wait_exponential

rate_limiter = InMemoryRateLimiter(
    requests_per_second=2,
    check_every_n_seconds=0.1
)

llm = ChatAnthropic(
    model="claude-3-5-sonnet-20241022",
    rate_limiter=rate_limiter
)

# Or use Tenacity for retry
@retry(
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=2, max=10)
)
def call_llm(prompt):
    return llm.invoke(prompt)
```

### Error Handling with Fallbacks
Graceful degradation:

```python
from langchain_core.runnables import RunnableLambda

# Fallback chain if primary fails
fallback_chain = ChatPromptTemplate.from_template("Default: {input}") | llm

primary_chain = (
    ChatPromptTemplate.from_template("Primary: {input}")
    | llm
).with_fallbacks([fallback_chain])

# Try-except wrapper
def safe_invoke(chain, input_data):
    try:
        return chain.invoke(input_data)
    except Exception as e:
        return f"Error: {str(e)}"
```

---

## 8. Common Pitfalls

### 1. Over-engineering Chains
**Problem**: Creating complex chains with many steps when simpler solutions work.

**Solution**: Start with minimal viable chain, add complexity only when needed.

```python
# Don't do this
chain = (
    prompt1 | llm1 | parser1 |
    prompt2 | llm2 | parser2 |
    prompt3 | llm3 | parser3
)

# Start simple
chain = prompt | llm | StrOutputParser()
# Add steps only if necessary
```

### 2. Not Using LCEL
**Problem**: Using deprecated chain classes like LLMChain, SequentialChain.

**Solution**: Use LCEL (pipe operator) for all new code.

```python
# Don't do this (deprecated)
from langchain.chains import LLMChain
chain = LLMChain(llm=llm, prompt=prompt)

# Do this (modern LCEL)
chain = prompt | llm | StrOutputParser()
```

### 3. Ignoring Token Limits in Memory
**Problem**: Conversation history grows unbounded, exceeding context window.

**Solution**: Use BufferWindowMemory or SummaryMemory with limits.

```python
# Don't do this
memory = ConversationBufferMemory()  # Unbounded growth

# Do this
memory = ConversationBufferWindowMemory(k=5)  # Keep last 5 turns
# Or
memory = ConversationSummaryMemory(llm=llm)  # Summarize old messages
```

### 4. Not Testing Agents with Diverse Inputs
**Problem**: Agents fail on edge cases in production.

**Solution**: Test with varied inputs and monitor execution.

```python
test_cases = [
    "Simple question?",
    "Complex multi-step task requiring tools",
    "Question the agent can't answer",
    "Ambiguous or confusing input",
    "Extremely long input text" * 100
]

for test in test_cases:
    try:
        result = executor.invoke({"input": test})
        print(f"✓ {test[:50]}")
    except Exception as e:
        print(f"✗ {test[:50]}: {e}")
```

### 5. Forgetting to Configure Tool Execution Limits
**Problem**: Agents loop infinitely or take too long.

**Solution**: Set max_iterations, timeout, and handle_parsing_errors.

```python
# Always configure limits
executor = AgentExecutor(
    agent=agent,
    tools=tools,
    max_iterations=10,        # Required
    max_execution_time=60,    # Required
    handle_parsing_errors=True  # Recommended
)
```

### 6. Not Handling Streaming in Agents
**Problem**: Streaming not working with AgentExecutor.

**Solution**: Agent streaming is limited; use callbacks for intermediate output.

```python
# Agent streaming is partial
async for chunk in executor.astream({"input": "..."}):
    print(chunk)

# Better: use callbacks for full visibility
from langchain_core.callbacks import BaseCallbackHandler

class DebugHandler(BaseCallbackHandler):
    def on_tool_end(self, output, **kwargs):
        print(f"Tool output: {output}")

executor.invoke(
    {"input": "..."},
    config={"callbacks": [DebugHandler()]}
)
```

---

## Summary Table: When to Use What

| Component | Use When | Example |
|-----------|----------|---------|
| **Simple Chain** | Single LLM call needed | Summarization, classification |
| **Agent** | Multiple tools required | Research, calculation, decision |
| **BufferWindowMemory** | Multi-turn conversation | Chatbot, assistant |
| **VectorStoreRetriever** | Semantic search | RAG, QA systems |
| **ParentDocumentRetriever** | Need chunk + context | Long document analysis |
| **EnsembleRetriever** | Hybrid search needed | When one retriever insufficient |
| **LlamaIndex** | Complex RAG system | Multi-index, metadata filtering |
| **LangChain** | Flexible chain composition | Agents, streaming, custom logic |
| **Streaming** | Real-time UX required | Chat, long responses |
| **LangSmith** | Production monitoring | Tracing, debugging, metrics |
