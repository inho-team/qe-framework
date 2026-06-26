---
name: Qlaravel-specialist
description: Build and configure Laravel 10+ applications, including creating Eloquent models and relationships, implementing Sanctum authentication, configuring Horizon queues, designing RESTful APIs with API resources, and building reactive interfaces with Livewire. Use when creating Laravel models, setting up queue workers, implementing Sanctum auth flows, building Livewire components, optimising Eloquent queries, or writing Pest/PHPUnit tests for Laravel features.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: backend
triggers: Laravel, Eloquent, PHP framework, Laravel API, Artisan, Blade templates, Laravel queues, Livewire, Laravel testing, Sanctum, Horizon
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, test-master, devops-engineer, security-reviewer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Laravel Specialist

Senior Laravel specialist — Laravel 10+, Eloquent ORM, PHP 8.2+.

## Core Workflow

1. **Analyse requirements** — Identify models, relationships, APIs, queue needs
2. **Design architecture** — Plan schema, service layers, job queues
3. **Implement models** — Eloquent models with relationships, scopes, casts; verify with `php artisan migrate:status`
4. **Build features** — Controllers, services, API resources, jobs; verify with `php artisan route:list`
5. **Test thoroughly** — Feature and unit tests; `php artisan test` before any step is complete (>85% coverage)

## Reference Guide

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Eloquent ORM | `references/eloquent.md` | Models, relationships, scopes, query optimization |
| Routing & APIs | `references/routing.md` | Routes, controllers, middleware, API resources |
| Queue System | `references/queues.md` | Jobs, workers, Horizon, failed jobs, batching |
| Livewire | `references/livewire.md` | Components, wire:model, actions, real-time |
| Testing | `references/testing.md` | Feature tests, factories, mocking, Pest PHP |

## Constraints

**MUST DO:**
- PHP 8.2+ features (readonly, enums, typed properties)
- Type hint all parameters and return types
- Eager loading (avoid N+1)
- API resources for data transformation
- Queue long-running tasks
- Tests >85% coverage
- Service containers and dependency injection
- PSR-12 coding standards

**MUST NOT DO:**
- Raw queries without protection (SQL injection)
- Skip eager loading
- Store sensitive data unencrypted
- Business logic in controllers
- Hardcode configuration values
- Skip input validation
- Use deprecated Laravel features
- Ignore queue failures

## Code Templates

### Eloquent Model

```php
<?php
declare(strict_types=1);
namespace App\Models;

use Illuminate\Database\Eloquent\{Factories\HasFactory, Model, SoftDeletes};
use Illuminate\Database\Eloquent\Relations\{BelongsTo, HasMany};

final class Post extends Model
{
    use HasFactory, SoftDeletes;

    protected $fillable = ['title', 'body', 'status', 'user_id'];
    protected $casts = ['status' => PostStatus::class, 'published_at' => 'immutable_datetime'];

    public function author(): BelongsTo { return $this->belongsTo(User::class, 'user_id'); }
    public function comments(): HasMany { return $this->hasMany(Comment::class); }
    public function scopePublished(Builder $query): Builder { return $query->where('status', PostStatus::Published); }
}
```

### Migration

```php
<?php
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration {
    public function up(): void {
        Schema::create('posts', function (Blueprint $table): void {
            $table->id();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('title');
            $table->text('body');
            $table->string('status')->default('draft');
            $table->timestamp('published_at')->nullable();
            $table->softDeletes();
            $table->timestamps();
        });
    }
    public function down(): void { Schema::dropIfExists('posts'); }
};
```

### API Resource

```php
<?php
declare(strict_types=1);
namespace App\Http\Resources;

use Illuminate\Http\{Request, Resources\Json\JsonResource};

final class PostResource extends JsonResource {
    public function toArray(Request $request): array {
        return [
            'id' => $this->id, 'title' => $this->title, 'body' => $this->body,
            'status' => $this->status->value,
            'published_at' => $this->published_at?->toIso8601String(),
            'author' => new UserResource($this->whenLoaded('author')),
            'comments' => CommentResource::collection($this->whenLoaded('comments')),
        ];
    }
}
```

### Queued Job

```php
<?php
declare(strict_types=1);
namespace App\Jobs;

use App\Models\Post;
use Illuminate\Bus\Queueable;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Illuminate\Queue\{InteractsWithQueue, SerializesModels};

final class PublishPost implements ShouldQueue {
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;
    public int $tries = 3;
    public int $backoff = 60;

    public function __construct(private readonly Post $post) {}
    public function handle(): void {
        $this->post->update(['status' => PostStatus::Published, 'published_at' => now()]);
    }
    public function failed(\Throwable $e): void {
        logger()->error('PublishPost failed', ['post' => $this->post->id, 'error' => $e->getMessage()]);
    }
}
```

### Feature Test (Pest)

```php
<?php
use App\Models\{Post, User};

it('returns a published post for authenticated users', function (): void {
    $user = User::factory()->create();
    $post = Post::factory()->published()->for($user, 'author')->create();
    $this->actingAs($user)->getJson("/api/posts/{$post->id}")
        ->assertOk()->assertJsonPath('data.status', 'published');
});
```

## Code Patterns

### Basic: Controller + FormRequest with PHPDoc

```php
<?php
declare(strict_types=1);
namespace App\Http\Controllers;

use App\Http\Requests\StorePostRequest;
use App\Http\Resources\PostResource;
use App\Models\Post;
use Illuminate\Http\JsonResponse;

final class PostController extends Controller {
    /**
     * Store a newly created post.
     * @param StorePostRequest $request Validated request containing post data
     * @return JsonResponse The created post resource
     */
    public function store(StorePostRequest $request): JsonResponse {
        $post = Post::create($request->validated());
        return response()->json(new PostResource($post), 201);
    }
}

// FormRequest with validation rules and authorization
final class StorePostRequest extends FormRequest {
    /** @return bool User authorization check */
    public function authorize(): bool { return auth()->check(); }
    
    /** @return array Validation rules */
    public function rules(): array {
        return ['title' => 'required|string|max:255', 'body' => 'required|string'];
    }
}
```

### Error Handling: Custom Exception + Handler

```php
<?php
namespace App\Exceptions;

use Exception;
use Illuminate\Http\JsonResponse;

final class InvalidPostException extends Exception {
    public static function unpublishable(int $postId): self {
        return new self("Post {$postId} cannot be published");
    }
    public function render(): JsonResponse {
        return response()->json(['error' => $this->message], 422);
    }
}
```

### Advanced: Eloquent Scope + Relationship + Event

```php
<?php
namespace App\Models;

use Illuminate\Database\Eloquent\{Builder, Relations\BelongsTo};
use App\Events\PostPublished;

final class Post extends Model {
    protected $dispatchesEvents = ['updated' => PostPublished::class];
    
    /** Scope: filter published posts with author eagerly loaded */
    public function scopePublishedWithAuthor(Builder $query): Builder {
        return $query->where('status', 'published')->with('author');
    }
    
    public function author(): BelongsTo { return $this->belongsTo(User::class); }
}

// Listener fires after post is updated
final class PostPublished {
    public function __construct(public Post $post) {}
}
```

## Comment Template (PHPDoc)

```php
/**
 * Brief description (imperative, one line).
 *
 * Detailed explanation if needed. Reference related classes/methods.
 *
 * @param string $title Post title, max 255 chars
 * @param int $userId Foreign key to users table
 * @return array Status with 'published_at' timestamp
 * @throws InvalidPostException If post cannot transition to published state
 * @see PostPublished Event triggered on publish
 */
public function publish(string $title, int $userId): array { }
```

## Lint Rules

**PHPCodeSniffer (phpcs/phpcbf)** — PSR-12 code style
**PHPStan** — Static analysis, strict types, null safety
**Config files:**
```
// phpcs.xml: PSR-12 + no unused imports
<rule ref="PSR12"/>
<rule ref="PSR1.Files.SideEffects.FoundWithSymbols">
  <exclude-pattern>*/config/*</exclude-pattern>
</rule>

// phpstan.neon: Level 9, strict mode
includes:
  - phpstan-strict-rules.neon
parameters:
  level: 9
  checkMissingIterableValueType: true
```

## Security Checklist

1. **SQL Injection** — Use Eloquent query builder (safe) or DB::prepare() with placeholders. Never use DB::raw() with user input.
2. **XSS** — Blade auto-escapes `{{ $var }}`. Use `{!! $html !!}` only for trusted HTML; sanitize with Purify.
3. **CSRF** — Include `@csrf` in all POST/PUT/DELETE forms; middleware checks X-CSRF-TOKEN header.
4. **Mass Assignment** — Define `$fillable` or `$guarded` on models. Use `request()->validate()` before `Model::create()`.
5. **File Upload** — Validate MIME types (`mimetypes:image/jpeg`), store in `/storage/`, never in web root.
6. **Authentication** — Use `auth()->check()` in controllers/middleware; Sanctum for APIs with token rotation.

## Anti-patterns (Wrong vs Correct)

**1. Fat Controllers**
```php
// WRONG: Business logic in controller
public function store(Request $request) {
    $validated = $request->validate([...]);
    $post = Post::create($validated);
    // Payment, notifications, cache invalidation HERE
}

// CORRECT: Delegate to service
public function store(StorePostRequest $request, PostService $service) {
    return response()->json($service->create($request->validated()), 201);
}
```

**2. N+1 Query Problem**
```php
// WRONG: Loop loads author for each post
foreach(Post::all() as $post) { echo $post->author->name; }

// CORRECT: Eager load author
foreach(Post::with('author')->get() as $post) { echo $post->author->name; }
```

**3. Raw Queries**
```php
// WRONG: SQL injection risk
$posts = DB::select("SELECT * FROM posts WHERE user_id = {$userId}");

// CORRECT: Use parameterized query or Eloquent
$posts = Post::where('user_id', $userId)->get();
```

**4. No Input Validation**
```php
// WRONG: Unvalidated input
public function store(Request $request) { Post::create($request->all()); }

// CORRECT: Validate before store
public function store(StorePostRequest $request) { Post::create($request->validated()); }
```

**5. Business Logic in Routes**
```php
// WRONG: Logic in route closure
Route::post('/publish', fn() => Post::find(request('id'))->update(['status' => 'published']));

// CORRECT: Use controller method
Route::post('/posts/{post}/publish', [PostController::class, 'publish']);
```

## Validation Checkpoints

| Stage | Command | Expected |
|-------|---------|----------|
| After migration | `php artisan migrate:status` | All `Ran` |
| After routing | `php artisan route:list --path=api` | Routes with correct verbs |
| After job dispatch | `php artisan queue:work --once` | No exception |
| After implementation | `php artisan test --coverage` | >85%, 0 failures |
| Before PR | `./vendor/bin/pint --test` | PSR-12 passes |
