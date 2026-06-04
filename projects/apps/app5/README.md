# App 5 — HTTP Client

Interactive networking demo using real public APIs — no local server required.

## What it demonstrates

| Card | API | Operators |
|------|-----|-----------|
| GET /posts | JSONPlaceholder | `readJson` + `useTimeout` + `useFallback` |
| POST /posts | JSONPlaceholder | `readJson` + `useHeader` |
| GET /users | JSONPlaceholder | `readJson` + `useTimeout` |
| GET /pokemon | PokeAPI | `readJson` |
| GET /random dog | Dog CEO API | `readJson` |
| 404 Not Found | JSONPlaceholder | `catchError` |
| Redirects | httpbin.org | `useRedirect` |
| Timeout | httpbin.org | `useTimeout` + `catchError` |

## Run

```bash
ng serve app5
```

All requests hit real public APIs. No local server or API keys needed.
