# Testing and release policy

- All new features go into the isolated Milestone Testing window first.
- Use `npm run testing`. Its build is `dist-testing`; private data stays in `.testing`.
- Never launch the production entry point, patch an installed app, publish, push to a deployment branch, or dispatch a release without the user's explicit approval for that feature batch.
- Batch features for review. Record pending features in TESTING.md. Approval for one batch does not authorize the next.
- Never sync testing data to production or copy the testing profile back. Seed testing only from a read-only backup copy, retaining no connection credentials.
- Preserve unrelated work in this shared checkout.
