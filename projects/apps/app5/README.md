# App 5 — HTTP Client

Interactive networking demo using real public APIs — no local server required.

## What it demonstrates

| Card | API | Operators |
|------|-----|-----------|
| GET /posts | JSONPlaceholder | `readJson` + `useTimeout` + `useFallback` |
| POST /posts | JSONPlaceholder | `readJson` + `useRequest` (custom header) |
| GET /users | JSONPlaceholder | `readText` + `useTimeout` |
| GET /pokemon | PokeAPI | `readJson` |
| GET /random dog | Dog CEO API | `readJson` |
| 404 Not Found | JSONPlaceholder | `catchError` |
| Redirects | httpbin.org | `readStatus` + `redirect: 'follow'` |
| Timeout | JSONPlaceholder | `useTimeout` + `catchError` |

## Run

```bash
ng serve app5
```

All requests hit real public APIs. No local server or API keys needed.
