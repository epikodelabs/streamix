# ✨ Same Engine. Different Tune.

**Streamix is not an original idea.** It deliberately borrows from RxJS—operator names, conceptual models, the entire vocabulary of reactive programming. This was conscious, intentional, and the right choice.

This isn't an apology. It's an explanation of why RxJS was the correct foundation, and where Streamix diverges to become something distinct.

---

## ✨ You Don't Reinvent the Language

If you've written this:

```typescript
source.pipe(
  debounceTime(300),
  switchMap(fetchData)
)
```

You've internalized a vocabulary that's now standard across the industry. Pretending it doesn't exist—or renaming everything to look "original"—would force developers to relearn concepts they already understand.

RxJS established the lexicon. Streamix uses it because **shared vocabulary reduces friction.**

This isn't plagiarism. It's the same reason `map` and `reduce` exist across JavaScript, Python, and Ruby. Good patterns become common language.

---

## ✨ Where the Fork Happens

What Streamix **doesn't** copy is the engine:

**RxJS:**
- Push-based (source controls emission)
- Scheduler-driven (invisible timing coordination)
- Subscription-centric
- ~50KB+ minified

**Streamix:**
- Pull-based (consumer controls pace)
- Built on async generators
- Iterator-first (`for await...of`)
- ~9KB minified

**Same operators. Different execution model.**

---

## ✨ Why Not Just Use RxJS?

I did, for years. But I kept hitting the same walls:
- **Schedulers** were powerful but opaque
- **Backpressure** required understanding hot/cold, multicast/unicast
- **React integration** felt like bolting two paradigms together
- **Cancellation** required patterns instead of being built-in

I wanted the same vocabulary with:
- Fewer moving parts
- Native async generators
- Pull semantics
- Modern JavaScript alignment

So I kept the interface, rebuilt the machinery.

---

## ✨ Standing on Shoulders

Streamix exists because RxJS exists. RxJS taught a generation how to think about async flows, cancellation, and composition. It got the API design right.

Streamix builds on that foundation, then optimizes for:
- Smaller bundles
- Pull-based semantics  
- Native async/await integration
- Less ceremony

**Use Streamix** if you want reactive patterns with minimal overhead and generator-native workflows.

Both libraries are valid. Both have their place.

---

## ✨ Final Word

Streamix borrows heavily from RxJS because RxJS got the vocabulary right. Where it differs is implementation: pull vs push, generators vs observers, simplicity vs power.

Good ideas should be borrowed, adapted, and evolved—not locked behind whoever thought of them first.

---

<p align="center">
  <strong>Streamix: RxJS-inspired, generator-powered, intentionally minimal.</strong><br><br>
  <a href="https://www.npmjs.com/package/@epikodelabs/streamix">Install from NPM</a> ·
  <a href="https://github.com/epikodelabs/streamix">Star on GitHub</a> ·
  <a href="https://epikodelabs.github.io/streamix">Read the Docs</a>
</p>

**Acknowledgments:** RxJS for the vocabulary. TC39 for async generators. Every developer who's struggled with bundle sizes.

*Standing on the shoulders of giants isn't plagiarism. It's progress.*
