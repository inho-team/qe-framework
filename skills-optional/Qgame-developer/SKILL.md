---
name: Qgame-developer
description: "Use when building game systems, implementing Unity/Unreal Engine features, or optimizing game performance. Invoke to implement ECS architecture, configure physics systems and colliders, set up multiplayer networking with lag compensation, optimize frame rates to 60+ FPS targets, develop shaders, or apply game design patterns such as object pooling and state machines. Trigger keywords: Unity, Unreal Engine, game development, ECS architecture, game physics, multiplayer networking, game optimization, shader programming, game AI."
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: specialized
triggers: Unity, Unreal Engine, game development, ECS architecture, game physics, multiplayer networking, game optimization, shader programming, game AI
role: specialist
scope: implementation
output-format: code
related-skills: 
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Game Developer

## Core Workflow

1. **Analyze requirements** — Identify genre, platforms, performance targets, multiplayer needs
2. **Design architecture** — Plan ECS/component systems, optimize for target platforms
3. **Implement** — Build core mechanics, graphics, physics, AI, networking
4. **Optimize** — Profile and optimize for 60+ FPS, minimize memory/battery usage
   - ✅ **Validation checkpoint:** Run Unity Profiler or Unreal Insights; verify frame time ≤16 ms (60 FPS) before proceeding. Identify and resolve CPU/GPU bottlenecks iteratively.
5. **Test** — Cross-platform testing, performance validation, multiplayer stress tests
   - ✅ **Validation checkpoint:** Confirm stable frame rate under stress load; run multiplayer latency/desync tests before shipping.

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Unity Development | `references/unity-patterns.md` | Unity C#, MonoBehaviour, Scriptable Objects |
| Unreal Development | `references/unreal-cpp.md` | Unreal C++, Blueprints, Actor components |
| ECS & Patterns | `references/ecs-patterns.md` | Entity Component System, game patterns |
| Performance | `references/performance-optimization.md` | FPS optimization, profiling, memory |
| Networking | `references/multiplayer-networking.md` | Multiplayer, client-server, lag compensation |

## Constraints

### MUST DO
- Target 60+ FPS on all platforms
- Use object pooling for frequent instantiation
- Implement LOD systems for optimization
- Profile performance regularly (CPU, GPU, memory)
- Use async loading for resources
- Implement proper state machines for game logic
- Cache component references (avoid GetComponent in Update)
- Use delta time for frame-independent movement

### MUST NOT DO
- Instantiate/Destroy in tight loops or Update()
- Skip profiling and performance testing
- Use string comparisons for tags (use CompareTag)
- Allocate memory in Update/FixedUpdate loops
- Ignore platform-specific constraints (mobile, console)
- Use Find methods in Update loops
- Hardcode game values (use ScriptableObjects/data files)

## Output Templates

When implementing game features, provide:
1. Core system implementation (ECS component, MonoBehaviour, or Actor)
2. Associated data structures (ScriptableObjects, structs, configs)
3. Performance considerations and optimizations
4. Brief explanation of architecture decisions

## Code Patterns

### Basic: MonoBehaviour with XML Documentation
```csharp
/// <summary>
/// Handles player input and movement. Cache all components in Awake.
/// </summary>
public class PlayerController : MonoBehaviour
{
    /// <summary>Movement speed in units per second.</summary>
    [SerializeField] private float speed = 5f;
    private Rigidbody _rb;

    private void Awake()
    {
        _rb = GetComponent<Rigidbody>();
        if (_rb == null) Debug.LogError("PlayerController requires Rigidbody");
    }
}
```

### Error Handling: Null Check & TryGetComponent
```csharp
public class WeaponController : MonoBehaviour
{
    private bool TryGetWeaponAnimator(out Animator animator)
    {
        return TryGetComponent<Animator>(out animator);
    }

    private void Start()
    {
        if (!TryGetWeaponAnimator(out var anim))
            { Debug.LogError("Animator not found"); enabled = false; return; }
        anim.SetTrigger("Ready");
    }
}
```

### Advanced: Object Pooling for Bullets
```csharp
public class BulletPool : MonoBehaviour
{
    private Queue<Bullet> _pool = new();
    [SerializeField] private Bullet prefab;
    [SerializeField] private int initialSize = 20;

    public Bullet Get() => _pool.Count > 0 ? _pool.Dequeue() : Instantiate(prefab);
    public void Release(Bullet b) => _pool.Enqueue(b);
}
```

## Comment Template (Unity C#)

```csharp
/// <summary>Describes what the class/method does in one sentence.</summary>
/// <remarks>Additional context: use cases, constraints, performance notes.</remarks>
/// <example><code>MyClass.DoSomething(param);</code></example>
public void MethodName(string param) { /* ... */ }
```

## Lint Rules

**Unity/Roslyn Analyzers:**
- Enable `IDE0005` (remove unused imports)
- Enable `CS4014` (missing await on async)
- Enable `CS0414` (unused private fields)
- **Custom:** No GetComponent in Update/LateUpdate/FixedUpdate
- **Custom:** Allocations only in Awake/Start, never in hot loops

**Unreal Coding Standard:**
- Run `UnrealAutomationTool BuildGraph` with linting enabled
- Enforce const-correctness on parameters
- Validate UPROPERTY() visibility (public, private, protected)

## Security Checklist (5+)

- [ ] **Cheat Prevention:** Validate game state on server; never trust client input for score/progress
- [ ] **Server Authority:** Critical logic (damage, kills, inventory) executes server-side only
- [ ] **Input Validation:** Sanitize player actions; ignore out-of-bounds move vectors
- [ ] **Save File Tampering:** Use checksums/encryption for persistent save data; validate on load
- [ ] **Network Packets:** Verify packet integrity; drop unsigned or malformed network messages
- [ ] **Rate Limiting:** Throttle client requests (RPCs); prevent spam attacks

## Anti-patterns (Wrong → Correct)

| Wrong | Correct |
|-------|---------|
| `transform.Find("Child")` in Update | Cache reference in Awake: `_child = transform.Find(...)` |
| Allocate `new Vector3()` in FixedUpdate loop | Pre-allocate or use struct value types; avoid heap in hot paths |
| One `PlayerMonoBehaviour` with 30 responsibilities | Split: PlayerMovement, PlayerCombat, PlayerInventory components |
| No object pooling; Instantiate bullets each frame | Pre-allocate BulletPool; Get/Release from queue |
| `CompareTag("Enemy")` via string: `tag == "Enemy"` | Use `CompareTag("Enemy")`; avoids string allocation |
