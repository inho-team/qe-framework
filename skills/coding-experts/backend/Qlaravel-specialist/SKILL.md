---
name: Qlaravel-specialist
description: Build and configure Laravel 10+ applications, including creating Eloquent models and relationships, implementing Sanctum authentication, configuring Horizon queues, designing RESTful APIs with API resources, and building reactive interfaces with Livewire. Use when creating Laravel models, setting up queue workers, implementing Sanctum auth flows, building Livewire components, optimising Eloquent queries, or writing Pest/PHPUnit tests for Laravel features.
license: MIT
metadata:
  author: https://github.com/Jeffallan
  version: "1.1.0"
  domain: backend
  triggers: Laravel, Eloquent, PHP framework, Laravel API, Artisan, Blade templates, Laravel queues, Livewire, Laravel testing, Sanctum, Horizon
  role: specialist
  scope: implementation
  output-format: code
  related-skills: fullstack-guardian, test-master, devops-engineer, security-reviewer
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

## Validation Checkpoints

| Stage | Command | Expected |
|-------|---------|----------|
| After migration | `php artisan migrate:status` | All `Ran` |
| After routing | `php artisan route:list --path=api` | Routes with correct verbs |
| After job dispatch | `php artisan queue:work --once` | No exception |
| After implementation | `php artisan test --coverage` | >85%, 0 failures |
| Before PR | `./vendor/bin/pint --test` | PSR-12 passes |
