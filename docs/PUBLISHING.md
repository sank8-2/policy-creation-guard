# Publishing

## GitHub

```bash
node scripts/release-pack.mjs --dry-run
node scripts/release-pack.mjs
```

Install: `failproofai policies add sank8-2/policy-creation-guard`

## Cloud

```bash
fp policies publish policy-creation-guard policies/policy-creation-guard.mjs \
  --description "Require user approval before agents create/publish/deploy policies"
fp fleet deploy <machine-id> --add policy-creation-guard -y
```
