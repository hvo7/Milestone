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
