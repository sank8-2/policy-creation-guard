# Policy Creation Guard

> **Agents that can publish policies can change what every other agent is allowed to do.**

Failproof pack that **denies unattended policy creation, publish, install, and fleet deploy**. Explicit user approval (`user_approved`, `approval_id`, or `confirmed_policy_publish`) is required. Dry-runs stay allowed.

## Policies

| Policy | Default | Gate |
|---|---|---|
| `block-unattended-policy-publish` | on | Deny `failproofai publish`, `fp policies publish`, `fp fleet deploy`, `policies add/remove` without approval |
| `block-unattended-policy-source-edit` | on | Deny Write/Edit of `policies/*.mjs` / pack manifests without approval |
| `instruct-review-policy-before-publish` | on | After approval, instruct: review source, effect, and target before running |

## Install (GitHub pack)

```bash
failproofai policies add sank8-2/policy-creation-guard
# or:
failproofai policies add sank8-2/policy-creation-guard --all
```

## Cloud

```bash
fp policies publish policy-creation-guard ./policies/policy-creation-guard.mjs \
  --description "Require user approval before agents create/publish/deploy policies"
fp fleet deploy <machine> --add policy-creation-guard -y
```

## Local test

```bash
npm install && npm test
fp policies test ./policies/policy-creation-guard.mjs \
  --tool Bash \
  --command 'fp policies publish x ./x.mjs'
```

## License

MIT
