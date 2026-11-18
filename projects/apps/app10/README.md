# App 10 — One Sentence Each

A single-player fiction broadsheet, integrated from the Quiz sibling project.
Each month a serial is commissioned from three pitches, then advanced one
sentence at a time: draft a handful of candidate continuations, choose one to
canonize, and finish the issue over its run. Each serial carries a thematic
word cloud; clicking motifs locks them for the day, highlights them in
candidate drafts, and sends them with the generation request. There are no
ballots, vote tallies, or progress counters — the editor is the only reader.
Finished issues stay in a browsable archive.

Vue 3 + TypeScript + Tailwind CSS v4, with Streamix owning the small reactive
surface:

- `commissionGenreAtom` is a standalone Streamix atom read through
  `useWritable`, so the commission desk's genre choice survives view switches.
- The midnight countdown is an async-generator flow read through `useIterable`;
  Vue renders the latest emission while Streamix owns the ticking producer.
- The inspector discovers the atom and the internal iterable source in
  development builds.

## Run

```bash
npx ng serve app10
```

```bash
npx ng build app10
```

The build delegates to Vite through the Streamix Vue builder. Tailwind is wired
through `@tailwindcss/vite`; the plate images referenced as
`/src/assets/images/...` are served from the virtual project in development and
copied to the same path in the build output.

## Live AI generation

The sibling project ships an Express server with two Gemini-backed endpoints
(`/api/volume/commission`, `/api/candidates/generate`). The Angular CLI target
is a static client build, so those endpoints are not hosted here:

- Commission requests automatically fall back to the built-in demo pitches when
  the endpoint is absent, so the monthly ritual — including **Surprise me** —
  works without a server.
- Daily AI drafts report an error; seeded drafts and manual submission keep the
  daily loop working.

Running the sibling's `server.ts` next to this app restores live free-tier
generation.
