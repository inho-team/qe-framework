---
name: Qrails-expert
description: Rails 7+ specialist that optimizes Active Record queries with includes/eager_load, implements Turbo Frames and Turbo Streams for partial page updates, configures Action Cable for WebSocket connections, sets up Sidekiq workers for background job processing, and writes comprehensive RSpec test suites. Use when building Rails 7+ web applications with Hotwire, real-time features, or background job processing. Invoke for Active Record optimization, Turbo Frames/Streams, Action Cable, Sidekiq, RSpec Rails.
license: MIT
metadata: 
author: "https://github.com/Jeffallan"
version: 1.1.0
domain: backend
triggers: Rails, Ruby on Rails, Hotwire, Turbo Frames, Turbo Streams, Action Cable, Active Record, Sidekiq, RSpec Rails
role: specialist
scope: implementation
output-format: code
related-skills: fullstack-guardian, database-optimizer
invocation_trigger: When specialized language or framework best practices are needed.
recommendedModel: haiku
---

# Rails Expert

## Core Workflow

1. **Analyze requirements** — Identify models, routes, real-time needs, background jobs
2. **Scaffold resources** — `rails generate model User name:string email:string`, `rails generate controller Users`
3. **Run migrations** — `rails db:migrate` and verify schema with `rails db:schema:dump`
   - If migration fails: inspect `db/schema.rb` for conflicts, rollback with `rails db:rollback`, fix and retry
4. **Implement** — Write controllers, models, add Hotwire (see Reference Guide below)
5. **Validate** — `bundle exec rspec` must pass; `bundle exec rubocop` for style
   - If specs fail: check error output, fix failing examples, re-run with `--format documentation` for detail
   - If N+1 queries surface during review: add `includes`/`eager_load` (see Common Patterns) and re-run specs
6. **Optimize** — Audit for N+1 queries, add missing indexes, add caching

## Reference Guide

Load detailed guidance based on context:

| Topic | Reference | Load When |
|-------|-----------|-----------|
| Hotwire/Turbo | `references/hotwire-turbo.md` | Turbo Frames, Streams, Stimulus controllers |
| Active Record | `references/active-record.md` | Models, associations, queries, performance |
| Background Jobs | `references/background-jobs.md` | Sidekiq, job design, queues, error handling |
| Testing | `references/rspec-testing.md` | Model/request/system specs, factories |
| API Development | `references/api-development.md` | API-only mode, serialization, authentication |

## Code Patterns

### Basic: Controller Action with YARD Docs

```ruby
# app/controllers/posts_controller.rb
class PostsController < ApplicationController
  # Display all published posts with pagination.
  # @param [Integer] page Page number for results (default: 1)
  # @return [Array<Post>] Posts for the requested page
  def index
    @posts = Post.where(published: true).includes(:author).page(params[:page])
  end
end
```

### Error Handling: rescue_from + Custom Error Pages

```ruby
class ApplicationController < ActionController::Base
  rescue_from ActiveRecord::RecordNotFound, with: :handle_not_found
  rescue_from StandardError, with: :handle_server_error

  # @param [Exception] exception The caught exception
  # @return [void]
  private def handle_not_found(exception)
    render "errors/not_found", status: :not_found
  end

  private def handle_server_error(exception)
    Rails.logger.error("Server error: #{exception.message}")
    render "errors/server_error", status: :internal_server_error
  end
end
```

### Advanced: Active Record Scope + Concern

```ruby
# app/models/concerns/publishable.rb
module Publishable
  extend ActiveSupport::Concern

  # @return [ActiveRecord::Relation] Published records ordered by date
  scope :published, -> { where(published: true).order(published_at: :desc) }

  # @return [Boolean] True if published and not expired
  def available?
    published? && published_at <= Time.current
  end
end

# app/models/post.rb
class Post < ApplicationRecord
  include Publishable
end
```

## Comment Template (YARD)

```ruby
# @param [Type] param_name Description of parameter
# @return [Type] Description of return value
# @raise [ErrorClass] Description of error condition
def method_name(param_name)
  # implementation
end
```

## Lint Rules

- **rubocop**: Run `bundle exec rubocop` for style violations; auto-fix with `rubocop -a`
- **Config**: `.rubocop.yml` — enforce line length, method length, block nesting
- **brakeman**: Security scanner — run `brakeman -z` for high/medium severity issues

## Security Checklist (5+)

1. **Mass Assignment** — Use `strong_params` to whitelist input (never `permit!`)
2. **SQL Injection** — Always use parameterized queries; ActiveRecord prevents this by default
3. **XSS (Cross-Site Scripting)** — ERB auto-escapes HTML; use `html_safe` only on trusted output
4. **CSRF (Cross-Site Request Forgery)** — Include `authenticity_token` in all forms; `verify_authenticity_token` is automatic
5. **Session Fixation** — Regenerate session on login with `reset_session`
6. **File Upload Validation** — Validate MIME type, file size, and store outside web root

## Anti-Patterns (5 Wrong vs. Correct)

| Wrong | Correct |
|-------|---------|
| Business logic in controller actions | Extract to service objects or concerns |
| N+1 queries: `Post.all.map { \|p\| p.author.name }` | Use `includes(:author)` before the loop |
| Business logic in ActiveRecord callbacks | Use service objects or job queues instead |
| No database indexes on WHERE/ORDER BY columns | Add indexes: `add_index :posts, :user_id` |
| `skip_before_action` to bypass auth | Refactor; don't disable security middleware |

## Constraints

### MUST DO
- Prevent N+1 queries with `includes`/`eager_load` on every collection query involving associations
- Write comprehensive specs targeting >95% coverage
- Use service objects for complex business logic; keep controllers thin
- Add database indexes for every column used in `WHERE`, `ORDER BY`, or `JOIN`
- Offload slow operations to Sidekiq — never run them synchronously in a request cycle

### MUST NOT DO
- Skip migrations for schema changes
- Use raw SQL without sanitization (`sanitize_sql` or parameterized queries only)
- Expose internal IDs in URLs without consideration

## Output Templates

When implementing Rails features, provide:
1. Migration file (if schema changes needed)
2. Model file with associations and validations
3. Controller with RESTful actions and strong parameters
4. View files or Hotwire setup
5. Spec files for models and requests
6. Brief explanation of architectural decisions
