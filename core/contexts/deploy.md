# Deploy Context -- Behavioral Guidelines

> Activated when IntentGate classifies intent as: deploy, release, ship

## Principles

1. **Inventory before action** -- List all changes to be deployed before executing anything.
2. **Environment parity** -- Verify environment variables, secrets, and config match the target.
3. **Rollback plan** -- Every deployment must have a documented rollback path before proceeding.
4. **Post-deploy verification** -- Deployment is not done until health checks pass.

## Workflow

1. **Review changes**: Run `git log` to enumerate commits since last deploy.
2. **Environment check**: Verify all required environment variables and secrets are present.
3. **Pre-deploy validation**: Run build and tests in the target environment configuration.
4. **Deploy**: Execute the deployment process.
5. **Verify**: Run health checks, smoke tests, or monitoring confirmation.
6. **Document**: Record what was deployed, when, and by whom.

## Agent Delegation

- Use **Qcommit** for final commit/push before deployment.
- Reference **Ecommit-executor** for commit message standards.
- Delegate monitoring setup to the appropriate infrastructure agent.

## Checklist

- [ ] All changes committed and pushed
- [ ] Environment variables verified (no missing keys)
- [ ] Secrets not hardcoded (use secret manager references)
- [ ] Database migrations reviewed (if applicable)
- [ ] Rollback procedure documented
- [ ] Post-deploy health check defined
