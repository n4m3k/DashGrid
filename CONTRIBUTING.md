# Contributing to Dashgrid

Use Node.js 22.16 or newer. `.nvmrc` selects the supported Node.js 22 release line.

```bash
npm ci
npm run dev
```

The React app runs on port 5173 and proxies API requests to port 8080. Local
dashboard data is stored in `data/dashgrid.sqlite`.

## Before submitting changes

```bash
npm run format
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Browser tests use an isolated, in-memory dashboard. Screenshots and traces are
written to `test-results/`.

Keep API validation in `shared/model.ts`, threshold decisions in
`server/thresholds.ts`, and HTTP collection in `server/collector.ts`. Add regression
coverage for behavior changes and document API changes in the README or the
interactive OpenAPI documentation.

Use synthetic values for examples and screenshots. Keep local environment files,
SQLite databases, backups, and deployment notes out of contributions.

Contributions are licensed under the project's [MIT license](LICENSE).
