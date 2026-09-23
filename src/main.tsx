import './testing/bootstrap'
// A separate import boundary guarantees seeding precedes all store hydration,
// including when the production bundler puts stores into shared chunks.
void import('./renderApp')
