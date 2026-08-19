# Releasing `dsh-reasoning-cn`

This document defines the maintainer workflow for publishing this package.

## Release policy

- `main` must always be releasable: changes land through a pull request with
  required CI and CodeQL checks passing.
- The package follows [Semantic Versioning](https://semver.org/). Use a patch
  release for compatible fixes, a minor release for compatible features, and a
  major release for breaking changes.
- Each release is prepared in a focused release pull request. It must update
  `package.json`, `package-lock.json`, and `CHANGELOG.md` together.
- Do not publish manually from a local checkout. A protected `v*` tag on
  `main` is the only release trigger.

## Prepare a release

1. Start from an up-to-date `main` and use a clean working tree.
2. Review the changes since the previous release for compatibility, privacy,
   and dependency impact.
3. Set the next SemVer version with `npm version <version> --no-git-tag-version`.
   Review the resulting `package.json` and `package-lock.json` changes.
4. Move notable user-visible changes from `Unreleased` into a dated section of
   `CHANGELOG.md`.
5. Run the release checks locally:

   ```sh
   npm ci
   npm run verify
   npm pack --dry-run
   ```

6. Open and merge the release pull request only after its required GitHub
   checks, including CodeQL, are green.

## Publish

1. Confirm the merge commit is on `main` and `package.json` contains the
   intended version.
2. Create an annotated tag whose name exactly matches that version:

   ```sh
   git switch main
   git pull --ff-only origin main
   git tag -a v<version> -m "v<version>"
   git push origin v<version>
   ```

3. The release workflow verifies that the tag is exactly
   `v${package.json.version}`, runs `npm run verify`, then publishes with npm
   provenance through OIDC.
4. After the workflow succeeds, create a GitHub Release for the same tag and
   use the corresponding changelog section as its notes.
5. Verify the published tarball in a fresh temporary directory before
   announcing it.

## npm bootstrap and trusted publishing

The first publication requires an npm account with permission to create or
maintain the `dsh-reasoning-cn` package. Sign in locally only when needed:

```sh
npm login
npm whoami
```

Do not commit credentials, tokens, or `.npmrc`. Before the first tag-triggered
publish, configure npm Trusted Publishing with these values:

- Provider: GitHub Actions
- Organization or user: `William123666`
- Repository: `dsh-reasoning-cn`
- Workflow filename: `release.yml`
- Environment: `npm`
- Allowed action: `npm publish`

The GitHub workflow uses OIDC and intentionally does not consume an npm token.
It installs the pinned npm `11.11.0` release because trusted publishing
requires npm `11.5.1` or newer; Node.js `22.19.0` bundles an older npm client.

## Corrections, rollback, and security fixes

- Prefer a fast follow-up patch release for a faulty published version.
- Use `npm deprecate` with a clear replacement version when users need to move
  away from a release. Do not unpublish a public version except for an urgent,
  confirmed security or legal reason and only after assessing downstream use.
- For a security fix, follow `SECURITY.md` for coordinated disclosure, prepare
  a minimal patch release, and document the fixed version in the GitHub
  Security Advisory and changelog when disclosure is appropriate.
