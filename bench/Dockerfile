# QE bench clean-room — Claude Code on a minimal Node base.
#
# SECURITY: no secrets are baked in. ANTHROPIC_API_KEY is injected ONLY at
# `docker run` time via -e. There is intentionally no ARG/ENV for any key.
FROM node:lts-slim

# Minimal tools Claude Code + the bench need.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git curl ca-certificates ripgrep \
 && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally (pin to major 2 for reproducibility).
RUN npm install -g @anthropic-ai/claude-code@2

# Prove the install at build time — a broken CLI fails the image build.
# `--version` is offline, so this needs no API key.
RUN claude --version

# Non-root runtime user.
RUN useradd -m -s /bin/bash bench
USER bench
WORKDIR /home/bench/work

CMD ["bash"]
