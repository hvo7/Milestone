# Testing and release policy

## Interface preferences

- Keep the interface concise. Do not add generic gray subtitles, motivational descriptions, or implementation explanations throughout the platform. Retain necessary labels, validation, and user-entered content.
- Production Life Vitals starts empty and lets the user define every area and factor. Never copy testing examples into production.
- Life Vitals should favor a manually chosen status, optional reason and next step, and a personal definition of On pace. Keep setup small; do not reintroduce numeric targets, tolerances, or tracking modes.

- All new features go into the isolated Milestone Testing window first.
- Use `npm run testing`. Its build is `dist-testing`; private data stays in `.testing`.
- Never launch the production entry point, patch an installed app, publish, push to a deployment branch, or dispatch a release without the user's explicit approval for that feature batch.
- Batch features for review. Record pending features in TESTING.md. Approval for one batch does not authorize the next.
- Whenever approved changes go live in production, commit and push the corresponding source, tests, and release notes to `https://github.com/hvo7/Milestone.git`. The user has authorized this as part of every production update. Exclude local profiles, personal data, credentials, and generated build/release output.
- Never sync testing data to production or copy the testing profile back. Seed testing only from a read-only backup copy, retaining no connection credentials.
- Preserve unrelated work in this shared checkout.
- For conversation reviews, run `npm run testing -- --browser` and open `http://127.0.0.1:4174/` in this conversation's right-side browser panel. Use the working testing app for element annotations, not an inline mockup. Keep this dedicated origin stable so browser test edits persist; never copy them to production.

## GitHub publishing and detailed documentation

- Standing user instruction (2026-11-10): push every testing and production change made in this conversation to `hvo7/Milestone`, including its source, relevant tests, and documentation. Complete the push in the same work session and verify the remote branch head. Do not claim publication if it failed; record the blocker and remaining action.
- Testing-only work goes to a descriptive `testing/<batch-or-feature>` branch. Keep unapproved behavior out of production and production deployment branches. Include follow-up fixes and documentation updates on that branch. Production promotion still requires explicit approval for the feature batch; once approved, publish the corresponding changes to `main` as part of the production update. Documentation-only policy changes may go directly to `main`.
- Before publishing, inspect the remote branch and workflows so the push does not trigger an unapproved deployment. Preserve unrelated changes, do not force-push, and reconcile concurrent remote changes before retrying. If local Git metadata is read-only, use the connected GitHub tools with an expected-head check and disclose any remaining local metadata mismatch.
- Document every batch in detail in `TESTING.md`: request and scope, user-visible behavior, important implementation decisions and affected files, storage/migration implications, testing-versus-production boundaries, exact validation commands and results, manual verification, known limitations, pending work, and approval/release status. Distinguish historical observations from current results; never imply an unrun check passed.
- Update `CHANGELOG.md` for production releases and relevant engineering/setup documentation when architecture, configuration, or workflows change. Include reproduction/access steps, compatibility considerations, and recovery or rollback instructions where relevant. Keep detailed technical notes in repository documentation, not filler text in the product UI.
- Commit messages must identify the batch or release, summarize what changed and why, and state validation and material limitations. Final handoffs must identify the GitHub branch/commit link, testing or production status, and unresolved issues. Keep documentation current as work evolves rather than leaving conflicting release claims.
- Never publish credentials, personal snapshots, local profiles, `.testing` data, or generated build/release outputs. Synthetic test fixtures and their source code may be committed. GitHub publication is source versioning; do not describe it as a hosted deployment or binary release unless that separate action actually occurred.

