# 🚀 Scheduler

Hey there! This is a super handy task scheduler that keeps things in order with FIFO (First-In-First-Out) execution. It handles regular tasks, async ones, generators, and even async generators. Let's make your code life easier! 😊

## 📝 Quick Overview

This scheduler runs tasks one by one, in the order you add them. It plays nice with long-running tasks by letting them "yield" control, so others can jump in without everything grinding to a halt. No blocking the queue! 🛡️

## ✨ Cool Features

- **FIFO Style**: Tasks run in the exact order you enqueue them—one at a time. 📋
- **Task Variety**: Works with sync functions, async functions, generators, and async generators. Mix and match! 🔄
- **Error-Proof**: If one task crashes, it just rejects its own promise— the queue keeps chugging along. 🚧
- **Smart Flushing**: `flush()` waits until the queue is truly empty, even checking after microtasks to avoid sneaky races. ⏱️
- **Friendly Yielding**: Generators can pause and let others run in between steps. Teamwork! 🤝
- **Speedy Design**: Built with efficiency in mind—uses arrays to save memory and keeps things lightweight. ⚡

## 🛠️ How to Use It

### `createScheduler()`

 Whip up a new scheduler like this:

```typescript
const scheduler = createScheduler();
```

Easy peasy! 🍋

### `enqueue<T>(fn)`

Add a task to the line-up. It can be sync, async, a generator, or an async generator. For generators, each `yield` lets other tasks sneak in.

**What to Pass:**
- `fn`: Your function that returns a value, a promise, a generator, or an async generator.

**What You Get:** A `Promise<T>` that resolves with the final result.

**Fun Examples:**

```typescript
// Quick sync task
await scheduler.enqueue(() => 42);

// Async adventure
await scheduler.enqueue(async () => {
  const data = await fetch('/api/data');
  return data.json();
});

// Generator magic (pauses for others)
await scheduler.enqueue(function* () {
  yield; // Hey, take a break!
  const step1 = doWork();
  yield; // Your turn, other tasks!
  const step2 = doMoreWork();
  return step1 + step2;
});

// Async generator vibes
await scheduler.enqueue(async function* () {
  const data = await fetchData();
  yield; // Pause and play nice
  const processed = await processData(data);
  return processed;
});
```

### `flush()`

Chill until the scheduler is totally idle—no more tasks, even after a microtask check. Perfect for avoiding timing gotchas! 🕰️

**What You Get:** `Promise<void>`

**Example:**

```typescript
scheduler.enqueue(() => console.log('Task 1'));
scheduler.enqueue(() => console.log('Task 2'));

await scheduler.flush(); // All done? Yep!
console.log('All tasks complete 🎉');
```

### `delay(ms, callback?)`

Get a promise that waits a bit. You can add a callback to run after the delay—through the scheduler, of course!

**Heads Up:** This doesn't block the queue. Other tasks keep going during the wait. But if you `await` it inside a task, that task (and queue) will pause—try to avoid that! ⛔

**What to Pass:**
- `ms`: How long to wait (in milliseconds).
- `callback`: Optional function to run post-delay.

**What You Get:** `Promise<void>`

**Examples:**

```typescript
// Delayed callback, no blocking!
scheduler.delay(1000, () => console.log('After 1 second ⏳'));

// Others run right away
scheduler.enqueue(() => console.log('This runs right away 🚀'));

// Inside a task? It blocks—use sparingly!
scheduler.enqueue(async () => {
  await scheduler.delay(1000); // Queue waits too 😴
  console.log('After delay');
});
```

## 🧰 Extra Tools

### `delayStep(ms)`

A special marker for generators to pause without blocking the whole queue. Sweet for timed breaks! ⏲️

**What to Pass:**
- `ms`: Delay time in milliseconds.

**What You Get:** A `DelayStep` object to yield.

**Example:**

```typescript
scheduler.enqueue(function* () {
  console.log('Step 1');
  yield delayStep(100); // Snooze for 100ms, others keep going!
  console.log('Step 2 (after 100ms)');
  yield; // Quick pause
  console.log('Step 3');
  return 'done 🎊';
});

// Sneaky task during the delay
scheduler.enqueue(() => console.log('This runs during the delay 😎'));
```

## 🌟 Ways to Use It

### One After Another

```typescript
const result1 = await scheduler.enqueue(() => task1());
const result2 = await scheduler.enqueue(() => task2(result1));
const result3 = await scheduler.enqueue(() => task3(result2));
```

Chain 'em up! 🔗

### Long Tasks That Play Nice

```typescript
scheduler.enqueue(function* () {
  for (let i = 0; i < 1000; i++) {
    processItem(i);
    
    // Yield every 10 to share the spotlight
    if (i % 10 === 0) {
      yield;
    }
  }
  return 'processed 1000 items 🏆';
});
```

### Wait for Quiet Time

```typescript
// Load up tasks
scheduler.enqueue(() => task1());
scheduler.enqueue(() => task2());
scheduler.enqueue(() => task3());

// Hang tight
await scheduler.flush();
console.log('All tasks finished 🙌');
```

### Delay Without Drama

```typescript
// Callback after delay, no hold-ups
scheduler.delay(1000, () => {
  console.log('Executed after 1 second ✨');
});

// Instant action
scheduler.enqueue(() => console.log('Runs immediately ⚡'));
```

## 🚨 Handling Oops Moments

If a task throws an error, its promise rejects—but the queue marches on! Catch it like a pro.

```typescript
scheduler.enqueue(() => {
  throw new Error('Task failed');
}).catch(err => {
  console.error('Caught error:', err);
});

// Keeps going strong
scheduler.enqueue(() => {
  console.log('Still running 💪');
});
```

## 🌍 Global Scheduler

We've got a ready-to-go global one for you:

```typescript
import { scheduler } from './scheduler';

await scheduler.enqueue(() => myTask());
```

Convenient, right? 👍

## 📈 Performance Tips

- Smart arrays cut down on memory use.
- Only one "pump" runs at once.
- Yields keep the event loop happy.
- Microtasks ensure things happen in order.

## 💡 Pro Tips

1. **Generators for Big Jobs**: Chunk your work with `yield` to stay responsive. 🧩
2. **Skip `await delay()` in Tasks**: Go for `delayStep()` in generators to avoid blocks. 🚫
3. **Catch Those Errors**: Use try-catch or `.catch()` on promises. 🛡️
4. **Flush for Sync**: Great for waiting on multiple things. ⏳
5. **Global is Golden**: Stick with the exported `scheduler` unless you need something separate. 🌟