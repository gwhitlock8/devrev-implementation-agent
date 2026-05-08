# DevRev OpenAPI spec

The developer portal references OpenAPI 3.0 downloads, but automated fetch may return HTTP 403 from some mirrors.

To audit endpoints locally:

1. Download the public (or beta) OpenAPI spec from [DevRev — For Developers](https://developer.devrev.ai/beta/about/for-developers) using a browser.
2. Save it as `scripts/devrev.openapi.yaml` (gitignored).
3. Search for operations such as `sprints`, `rev-users`, and `works.list`.

This package implements calls aligned with the published REST paths under `https://api.devrev.ai/` (for example `works.create`, `parts.list`, `incidents.list`).
