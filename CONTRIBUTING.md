# Contributing

Thanks for helping improve `dsh-reasoning-cn`.

Before opening a pull request, run the complete credential-free check suite:

```sh
npm ci
npm run verify
```

Keep changes focused, add regression tests for behavior changes, and do not
commit local `file:` dependencies, provider credentials, or unredacted
reasoning. Changes that affect what is sent to a provider must update the
privacy notes in `README.md`.

`npm run verify:real` is an optional maintainer integration check. It requires
an explicitly configured provider and may send reasoning to that provider; do
not run it in CI or add its credentials to the repository.

Version, lockfile, and changelog changes belong in a focused release pull
request. See [RELEASING.md](./RELEASING.md) for the protected release, tagging,
and npm publishing process.
