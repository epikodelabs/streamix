# ✨ Streamix and RxJS: A Deliberate Connection

**Streamix deliberately builds on RxJS.** The operator names, conceptual models, and vocabulary of reactive programming are borrowed intentionally. This document explains why that foundation matters and where Streamix charts its own path.

## ✨ A Shared Vocabulary

If you've written code like this:

```typescript
source.pipe(
  debounceTime(300),
  switchMap(fetchData)
)
```

You're already familiar with reactive programming concepts that have become industry standard. Streamix uses this same vocabulary because **shared language makes adoption easier.**

This approach follows established precedent. Just as `map` and `filter` appear across JavaScript, Python, and Ruby, successful patterns naturally become common language. RxJS established the reactive programming lexicon, and Streamix benefits from that foundation.

## ✨ Different Under the Hood

While Streamix shares RxJS's operator vocabulary, the underlying execution model differs significantly:

**RxJS:**
- Push-based execution (source controls emission timing)
- Scheduler-driven coordination
- Subscription-centric model
- ~50KB+ minified

**Streamix:**
- Pull-based execution (consumer controls pace)
- Built on async generators
- Iterator-first approach (`for await...of`)
- ~9KB minified

The familiar operators work differently inside, optimized for different use cases.

## ✨ When to Choose Streamix

RxJS excels at complex reactive scenarios with multiple subscribers, sophisticated scheduling, and framework integration. It's the right choice for many applications.

Streamix offers an alternative when you need:
- Smaller bundle sizes
- Pull-based semantics aligned with async/await patterns
- Simpler mental models for sequential async flows
- Native integration with modern JavaScript features

Both libraries address real requirements. The choice depends on your specific needs.

## ✨ Building on a Strong Foundation

RxJS demonstrated how to design intuitive APIs for reactive programming. It solved fundamental problems around async flow composition, cancellation, and error handling.

Streamix takes that proven vocabulary and reimplements it with different trade-offs:
- Reduced bundle size
- Pull-based semantics
- Native async/await integration
- Simplified execution model

This isn't about replacing RxJS—it's about providing alternatives for different constraints.

## ✨ In Summary

Streamix uses RxJS's vocabulary because it's well-designed and widely understood. The implementation differs to serve different priorities: smaller bundles, pull-based execution, and closer alignment with native JavaScript async features.

Both libraries have value. Both solve real problems. Choose based on your application's requirements.

<p align="center">
  <strong>Streamix: Familiar reactive patterns, generator-powered implementation.</strong><br><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> ·
  <a href="https://github.com/epikodelabs/streamix">Star on GitHub</a> ·
  <a href="https://epikodelabs.github.io/streamix">Read the Docs</a>
</p>

**Acknowledgments:** Built on concepts pioneered by RxJS and enabled by TC39's async generator specification.
