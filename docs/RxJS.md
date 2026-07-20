# Chronicles #31 — From RxJS to Streamix: Changing the Mental Model

Moving from RxJS to Streamix is not primarily an API migration.

It is a change in how we describe reactive applications.

At first, the two libraries can appear to occupy similar territory. Both work with changing values, asynchronous processes, composition, cancellation, and state that evolves over time.

That resemblance is real.

But the underlying models are different enough that translating RxJS code operator by operator usually produces the wrong result.

The important question is not:

> What is the Streamix equivalent of this RxJS operator?

It is:

> Why did this value become an Observable in the first place?

That question changes almost everything.

---

## The RxJS Starting Point

RxJS begins with streams.

A value that changes over time is represented as an `Observable`.

A user selection may be an Observable.

A loading flag may be an Observable.

A search query may be an Observable.

The current user may be an Observable.

The result of combining several pieces of state may be another Observable.

```ts
const query$ = new BehaviorSubject("");
const page$ = new BehaviorSubject(1);

const results$ = combineLatest([query$, page$]).pipe(
  debounceTime(300),
  switchMap(([query, page]) =>
    search({ query, page }).pipe(
      catchError(() => of([]))
    )
  ),
  shareReplay(1)
);
```

This is a valid and familiar RxJS design.

Everything participates in the same stream vocabulary:

* state is emitted;
* dependencies are combined;
* asynchronous work is flattened;
* errors are transformed;
* results are replayed;
* consumers subscribe.

The strength of RxJS is that nearly everything can be expressed as stream composition.

Its weakness is exactly the same.

Nearly everything ends up expressed as stream composition.

---

## When Every Value Becomes a Stream

A stream is an excellent model for events and sequences.

Mouse clicks are a sequence.

WebSocket messages are a sequence.

Incoming server events are a sequence.

A file being read in chunks is a sequence.

But many things in an application are not naturally sequences.

The current search query is not primarily a sequence. It is a value.

The selected page is a value.

The loading state is a value.

The current result set is a value.

They may change, but their identity is still:

> What is the value now?

RxJS can represent this using `BehaviorSubject`, `ReplaySubject(1)`, `shareReplay(1)`, or a state-store abstraction built on top of Observables.

But once ordinary state is represented as a stream, reading it becomes indirect.

Instead of:

```ts
console.log(app.query);
```

we have:

```ts
app.query$.subscribe(query => {
  console.log(query);
});
```

Or:

```ts
const query = await firstValueFrom(app.query$);
```

Or some framework-specific bridge that unwraps the Observable for us.

The value exists, but it must first pass through a consumption mechanism.

Streamix starts from the opposite direction.

A current value should behave like a current value.

```ts
const app = scope({
  query: "",
  page: 1,
});

console.log(app.query);
```

It remains reactive internally, but its public meaning is not “a stream that emits queries.”

Its public meaning is simply:

> The current query.

---

## The Migration Begins by Separating Categories

The first step away from RxJS is not replacing `Observable` with `flow`.

That would preserve the old model under a new name.

Instead, we separate concepts that RxJS often expresses through one universal abstraction.

In Streamix, application logic usually falls into four categories:

* writable state;
* derived state;
* asynchronous processes;
* events or sequences.

They can interact, but they are not forced to pretend they are the same thing.

Consider this RxJS state:

```ts
const firstName$ = new BehaviorSubject("Ada");
const lastName$ = new BehaviorSubject("Lovelace");

const fullName$ = combineLatest([
  firstName$,
  lastName$
]).pipe(
  map(([firstName, lastName]) =>
    `${firstName} ${lastName}`
  )
);
```

The Streamix version is not another combination pipeline:

```ts
const user = scope({
  firstName: "Ada",
  lastName: "Lovelace",

  fullName: self =>
    `${self.firstName} ${self.lastName}`,
});
```

The difference is not merely syntax.

In the RxJS version, `fullName$` is a stream created by combining two streams.

In Streamix, `fullName` is a formula.

That distinction affects how the code is read.

RxJS says:

> Listen to both sources, combine their latest emissions, map the tuple, and emit another value.

Streamix says:

> A full name is the first name and last name joined together.

The second description is much closer to the business rule.

---

## Stop Manually Transporting State

A large part of RxJS application code is devoted to moving values into the right pipeline.

Suppose a request depends on a query, page number, sorting mode, and authenticated user.

In RxJS, those values must somehow enter the stream:

```ts
const request$ = combineLatest([
  query$,
  page$,
  sort$,
  currentUser$
]).pipe(
  debounceTime(300),
  switchMap(([query, page, sort, user]) =>
    api.search({
      query,
      page,
      sort,
      userId: user.id
    })
  )
);
```

As the number of inputs grows, the tuple grows.

Then the destructuring grows.

Then another value is needed and must be added to the source list, the tuple type, and the callback parameters.

This is not accidental boilerplate.

It follows from the RxJS model: dependencies must be transported through the stream graph.

Streamix allows computations to read the state they need directly:

```ts
const app = scope({
  query: "",
  page: 1,
  sort: "relevance",
  currentUser: null,

  results: self => flow(async function* () {
    if (!self.currentUser) {
      yield [];
      return;
    }

    yield await api.search({
      query: self.query,
      page: self.page,
      sort: self.sort,
      userId: self.currentUser.id,
    });
  }),
});
```

The computation expresses its dependencies by using them.

There is no dependency tuple to construct and transport.

The request is connected to `query`, `page`, `sort`, and `currentUser` because those values are read by the computation.

This resembles the way ordinary code works.

A function depends on the values it reads.

Streamix makes that relationship reactive.

---

## From Operators to Language Constructs

RxJS applications often develop an operator-first style of reasoning.

We ask:

* Should this be `switchMap` or `concatMap`?
* Should we use `withLatestFrom` or `combineLatest`?
* Do we need `share`, `shareReplay`, or `publishReplay`?
* Should the error be caught inside or outside the flattening operator?
* Does `startWith` belong before or after `distinctUntilChanged`?
* Will this pipeline resubscribe to the source?

These are legitimate questions.

But many of them are orchestration questions rather than application questions.

Streamix tries to move common cases back into ordinary language structures.

### Mapping a Value

RxJS:

```ts
const doubled$ = count$.pipe(
  map(count => count * 2)
);
```

Streamix:

```ts
const app = scope({
  count: 0,
  doubled: self => self.count * 2,
});
```

### Filtering Optional State

RxJS:

```ts
const activeUser$ = user$.pipe(
  filter((user): user is User => user !== null)
);
```

Streamix may simply use a condition:

```ts
const app = scope({
  user: null,

  profile: self => {
    if (!self.user) return null;
    return buildProfile(self.user);
  },
});
```

### Combining Values

RxJS:

```ts
const total$ = combineLatest([
  price$,
  quantity$
]).pipe(
  map(([price, quantity]) => price * quantity)
);
```

Streamix:

```ts
const order = scope({
  price: 0,
  quantity: 0,

  total: self => self.price * self.quantity,
});
```

### Conditional Asynchronous Work

RxJS:

```ts
const details$ = selectedId$.pipe(
  switchMap(id =>
    id === null
      ? of(null)
      : loadDetails(id)
  )
);
```

Streamix:

```ts
const app = scope({
  selectedId: null,

  details: self => flow(async function* () {
    if (self.selectedId === null) {
      yield null;
      return;
    }

    yield await loadDetails(self.selectedId);
  }),
});
```

This does not mean operators disappear.

Operators remain valuable when we are genuinely processing a sequence.

The change is that we no longer reach for a sequence operator to describe every state relationship.

---

## `switchMap` Was Often Solving Two Problems

`switchMap` is one of the most useful RxJS operators because applications constantly start work that becomes obsolete.

A user types a query.

A request begins.

The user types again.

The old request should no longer matter.

```ts
const results$ = query$.pipe(
  debounceTime(300),
  switchMap(query => search(query))
);
```

There are two distinct ideas here:

1. the query is state;
2. the search is a process whose identity depends on that state.

RxJS combines both ideas in a pipeline.

Streamix separates them:

```ts
const app = scope({
  query: "",

  results: self => flow(async function* (signal) {
    const query = self.query.trim();

    if (!query) {
      yield [];
      return;
    }

    yield await search(query, { signal });
  }),
});
```

When `query` changes, the previous reactive computation becomes obsolete.

The previous process can be cancelled, and a new one can begin using the latest state.

Conceptually, this is similar to `switchMap`.

But it is attached to the lifecycle of a process rather than expressed as a flattening strategy inside a generic stream pipeline.

That change matters.

The code is no longer saying:

> Map each query emission to an inner Observable and switch to the latest one.

It says:

> These results are produced by a search process based on the current query.

The behavior is similar.

The explanation is simpler.

---

## Not Every `Observable` Becomes a `flow`

This is the most important migration rule.

An RxJS `Observable<T>` can represent many different things:

* current state;
* derived state;
* an event;
* an asynchronous result;
* a long-running process;
* a finite collection;
* an interval;
* a resource;
* a command;
* a notification channel.

A Streamix `flow` should not automatically replace all of them.

Consider:

```ts
const count$ = new BehaviorSubject(0);
```

This is state.

It should usually become:

```ts
count: 0
```

Consider:

```ts
const doubled$ = count$.pipe(
  map(value => value * 2)
);
```

This is derived state.

It should usually become:

```ts
doubled: self => self.count * 2
```

Consider:

```ts
const saveClicks$ = fromEvent(
  button,
  "click"
);
```

This is an event sequence.

Keeping it as a stream or async iterable may be perfectly appropriate.

Consider:

```ts
const messages$ = webSocket(url);
```

This is a long-lived external source.

It may become a flow, but its restart semantics must be considered carefully.

Consider:

```ts
const user$ = http.get<User>("/user");
```

This may be a one-time asynchronous operation, a resource, or a process that should rerun when dependencies change.

Its correct Streamix form depends on its meaning, not merely its TypeScript type.

Migration therefore begins with classification.

Before converting an Observable, ask:

> Is this a value, a formula, an event sequence, or an owned process?

Only then choose the Streamix abstraction.

---

## Subscriptions Are No Longer the Architecture

In RxJS, subscriptions are where an Observable becomes active.

That creates an important architectural concern:

> Who subscribes?

Then another:

> Who unsubscribes?

Then another:

> Is the pipeline cold or shared?

Then:

> What happens when the final subscriber leaves?

Application architecture can gradually become organized around subscription ownership.

A component subscribes.

A service shares.

A store replays.

A destroy signal terminates.

A helper collects subscriptions.

A framework adapter converts streams to signals.

A lifecycle hook cleans everything up.

This can be made reliable, but the lifecycle remains spread across several mechanisms.

Streamix makes ownership explicit through scopes.

```ts
const page = scope({
  query: "",

  results: self => flow(async function* (signal) {
    yield await search(self.query, { signal });
  }),
});
```

The scope owns the state and the process.

When the scope is disposed, the owned work is disposed with it.

```ts
page.dispose();
```

The central question is no longer:

> Where is the matching unsubscribe?

It becomes:

> Which scope owns this work?

That is a stronger architectural question because it applies to more than subscriptions.

The same owner may control:

* atoms;
* derived computations;
* flows;
* timers;
* requests;
* iterators;
* nested scopes;
* background tasks.

The lifecycle is attached to a domain boundary rather than scattered among individual consumers.

---

## From Consumer Ownership to Structural Ownership

RxJS often ties lifetime to consumption.

A cold Observable starts when subscribed.

A shared Observable remains alive while subscribers exist.

When the final subscriber leaves, ref-counting may stop the source.

This is powerful, especially for reusable event sources.

But application processes are not always best owned by their current consumers.

Imagine a dashboard with several widgets using the same data.

Should the network synchronization process belong to whichever widget happened to subscribe first?

Should it stop because all widgets temporarily disappeared?

Should navigation recreate it?

Sometimes yes.

Sometimes no.

The real answer depends on application structure.

Streamix encourages us to create the process inside the scope that logically owns it:

```ts
const workspace = scope({
  connectionStatus: "offline",

  updates: self => flow(async function* (signal) {
    for await (const update of connectToWorkspace(signal)) {
      yield update;
    }
  }),

  dashboard: {
    selectedPanel: "overview",
  },
});
```

The workspace owns the connection.

A nested dashboard may consume its output, but it does not accidentally define the connection's lifetime.

This is structural ownership.

It makes lifecycle a deliberate part of architecture rather than an emergent property of subscription counts.

---

## The Disappearance of `shareReplay(1)`

`shareReplay(1)` appears frequently in RxJS applications because it solves several practical problems:

* avoiding repeated expensive work;
* sharing one subscription;
* exposing the latest result to late subscribers;
* turning a cold pipeline into something state-like.

```ts
const user$ = loadUser().pipe(
  shareReplay({
    bufferSize: 1,
    refCount: true
  })
);
```

But these responsibilities are not always the same responsibility.

Do we need to share a running process?

Do we need to store its latest value?

Do we need lazy startup?

Do we need ref-counted teardown?

Do we need replay after completion?

`shareReplay` can bundle these questions together.

In Streamix, the current value and the process producing it are understood separately.

A flow belongs to a scope and exposes its current reactive state through the scope model.

Consumers do not need to rebuild the process merely to read its latest result.

The common pattern:

```ts
source.pipe(
  shareReplay(1)
)
```

often disappears because values are already represented as values, and ownership is already represented by scopes.

That does not make replay universally unnecessary.

It means replay is no longer required just to make an asynchronous result behave like application state.

---

## Error Handling Becomes Domain Handling

RxJS errors travel through the Observable channel.

An unhandled error terminates the stream.

This is consistent with the Observable contract, but application state often needs a richer model.

A failed request may need to produce:

* an error message;
* retained previous data;
* retry availability;
* loading state;
* offline status;
* a non-terminal failure;
* a terminal failure.

In RxJS, this often becomes material encoded into the stream:

```ts
const result$ = request$.pipe(
  map(data => ({
    status: "success" as const,
    data,
    error: null
  })),
  startWith({
    status: "loading" as const,
    data: null,
    error: null
  }),
  catchError(error =>
    of({
      status: "error" as const,
      data: null,
      error
    })
  )
);
```

This is a reasonable pattern, but notice what happened.

The Observable error channel was unsuitable for recoverable application failure, so the error became ordinary data.

Streamix treats this less as stream recovery and more as state design.

```ts
const app = scope({
  user: null,
  error: null,
  status: "idle",

  loadUser: method(async self => {
    self.status = "loading";
    self.error = null;

    try {
      self.user = await fetchUser();
      self.status = "success";
    } catch (error) {
      self.error = error;
      self.status = "error";
    }
  }),
});
```

Alternatively, the failure may belong directly to an atom or flow when that model is appropriate.

The point is not that `catchError` is bad.

The point is that application errors should be represented according to their domain meaning, not automatically according to stream termination semantics.

---

## Events Still Deserve Streams

Moving away from RxJS does not mean pretending sequences no longer exist.

Some problems are fundamentally stream-shaped.

```ts
pointerMoves.pipe(
  throttleTime(16),
  pairwise(),
  map(([previous, current]) => ({
    dx: current.x - previous.x,
    dy: current.y - previous.y
  }))
);
```

This is a real sequence transformation.

Replacing it with a collection of atoms and derived values may make it worse.

Likewise:

* message queues;
* logs;
* telemetry;
* keyboard input;
* drag gestures;
* streamed responses;
* ordered server events;
* data pipelines.

These are naturally consumed over time.

Streamix still provides flows and composable operators for this work.

The modern approach is not:

> Streams are obsolete.

It is:

> Use streams for sequences, not as the mandatory container for every changing value.

RxJS gives us one extremely expressive abstraction.

Streamix gives us several narrower abstractions and asks us to choose according to meaning.

---

## From Pipes to Scopes

An RxJS pipeline describes how emissions travel.

```ts
const viewModel$ = combineLatest([
  user$,
  permissions$,
  notifications$
]).pipe(
  map(([user, permissions, notifications]) => ({
    user,
    permissions,
    unreadCount: notifications.filter(
      item => !item.read
    ).length
  })),
  shareReplay(1)
);
```

A Streamix scope describes a living piece of application state:

```ts
const viewModel = scope({
  user: null,
  permissions: [],
  notifications: [],

  unreadCount: self =>
    self.notifications.filter(
      item => !item.read
    ).length,

  canEdit: self =>
    self.permissions.includes("edit"),
});
```

The pipeline emphasizes movement.

The scope emphasizes relationships.

The RxJS version asks:

> How should these emissions be combined?

The Streamix version asks:

> What belongs together, and how are these values related?

This is one of the deepest differences between the two approaches.

RxJS naturally produces graphs of producers and consumers.

Streamix naturally produces trees of ownership containing reactive graphs internally.

The graph still exists.

It is simply no longer the primary shape of application architecture.

---

## Imperative Actions Are Allowed Again

RxJS-heavy designs sometimes try to express actions as streams because streams are the main abstraction available.

```ts
const increment$ = new Subject<void>();

const count$ = increment$.pipe(
  scan(count => count + 1, 0),
  startWith(0),
  shareReplay(1)
);
```

This is elegant as a demonstration of accumulation.

But an application action is often more clearly expressed as an action:

```ts
const counter = scope({
  count: 0,

  increment: method(self => {
    self.count += 1;
  }),
});
```

There is nothing unreactive about this.

The state is reactive.

Derived values depending on `count` update reactively.

Subscribers can still observe changes.

The fact that the mutation was initiated by a method does not weaken the reactive model.

It strengthens the application model because the code now says exactly what happens.

```ts
counter.increment();
```

Instead of:

```ts
increment$.next();
```

The first is a domain operation.

The second is an emission into an infrastructure channel.

Subjects remain useful for genuine event broadcasting.

They are less convincing as universal command buses.

---

## The Difference Between an Event and a Command

RxJS makes it easy to blur events and commands because both can be sent through a `Subject`.

```ts
save$.next(document);
```

But semantically, this may mean one of two things.

An event:

> A document was saved.

A command:

> Save this document.

Those are not equivalent.

An event reports something that happened.

A command requests work and may fail, be cancelled, or return a result.

In Streamix, a command can usually remain a method:

```ts
const editor = scope({
  saving: false,

  save: method(async (self, document) => {
    self.saving = true;

    try {
      await persist(document);
    } finally {
      self.saving = false;
    }
  }),
});
```

A stream can then represent actual events produced by the process when that is useful.

This keeps causality visible.

Methods perform operations.

State records current facts.

Derived values express relationships.

Flows represent evolving processes.

Streams represent sequences.

The categories cooperate without collapsing into one another.

---

## Migration by Deletion

A successful move from RxJS to Streamix may involve deleting more code than translating.

Suppose we begin with:

```ts
const query$ = new BehaviorSubject("");
const page$ = new BehaviorSubject(1);

const request$ = combineLatest([
  query$,
  page$
]).pipe(
  debounceTime(300),
  switchMap(([query, page]) =>
    search(query, page).pipe(
      map(data => ({
        status: "success",
        data
      })),
      startWith({
        status: "loading",
        data: []
      }),
      catchError(error =>
        of({
          status: "error",
          data: [],
          error
        })
      )
    )
  ),
  shareReplay({
    bufferSize: 1,
    refCount: true
  })
);
```

A literal migration might try to reproduce:

* two subjects;
* latest-value combination;
* debouncing;
* latest-only cancellation;
* status emissions;
* replay;
* sharing;
* teardown.

But the Streamix design may simply be:

```ts
const searchPage = scope({
  query: "",
  page: 1,
  status: "idle",
  results: [],
  error: null,

  search: method(async self => {
    self.status = "loading";
    self.error = null;

    try {
      self.results = await search(
        self.query,
        self.page
      );

      self.status = "success";
    } catch (error) {
      self.error = error;
      self.status = "error";
    }
  }),
});
```

Or, when the search should react automatically:

```ts
const searchPage = scope({
  query: "",
  page: 1,

  results: self => flow(async function* (signal) {
    const query = self.query;
    const page = self.page;

    await delay(300, signal);

    yield await search(query, page, {
      signal
    });
  }),
});
```

The exact version depends on the desired UX.

Should searching happen automatically when state changes?

Should it happen only after submitting?

Should previous results remain visible?

Should pagination append or replace?

Should errors terminate the process?

Those are product decisions.

A direct operator-by-operator conversion would hide them.

Migration is the moment to make them explicit.

---

## Do Not Rebuild RxJS Inside Streamix

The most common migration mistake is preserving the old architecture too faithfully.

For example:

```ts
const app = scope({
  query$: atom(""),
  page$: atom(1),
  results$: flow(...),
});
```

The dollar suffix is not the real problem.

The deeper problem is retaining the assumption that every reactive thing is fundamentally a stream endpoint.

Another warning sign is building large chains that continuously package and unpack tuples:

```ts
pipe(
  combineLatest(...),
  map(([a, b, c]) => ...),
  switchMap(...),
  shareReplay(...)
)
```

Streamix supports composition, but it should not be used merely to recreate the transport graph that scopes and direct dependency tracking already remove.

A useful rule is:

> If a pipeline exists only to move current values into a computation, it probably wants to become a scope formula or flow.

Keep the pipeline when the ordering of events matters.

Remove it when it merely simulates access to state.

---

## A Practical Conversion Table

When reading existing RxJS code, these translations are useful starting points.

| RxJS pattern                        | First Streamix question                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| `BehaviorSubject<T>`                | Is this ordinary writable state?                                              |
| `ReplaySubject<T>(1)`               | Is this a current value or genuinely replayed history?                        |
| `combineLatest(...).pipe(map(...))` | Is this simply derived state?                                                 |
| `switchMap(...)`                    | Is this a process that becomes obsolete when dependencies change?             |
| `concatMap(...)`                    | Must every operation complete in order?                                       |
| `mergeMap(...)`                     | Are these truly concurrent processes or just independent commands?            |
| `shareReplay(1)`                    | Why must this source be shared, cached, or replayed?                          |
| `Subject<void>` used as an action   | Would a method express the command more clearly?                              |
| `takeUntil(destroy$)`               | Which scope should own this work?                                             |
| `withLatestFrom(...)`               | Why is current state being transported through an event pipeline?             |
| `scan(...)`                         | Is this sequence accumulation or simply mutable state?                        |
| `startWith(...)`                    | Is this an initial state value?                                               |
| `catchError(...)`                   | Is this stream termination or recoverable application state?                  |
| `distinctUntilChanged()`            | Is duplicate suppression required, or should the state layer handle equality? |
| `defer(...)`                        | What lifecycle should create this resource?                                   |

This is not a mechanical mapping table.

Each row is a prompt to recover the original meaning of the code.

---

## Preserve RxJS Where It Is Strongest

A migration does not have to be ideological.

RxJS remains excellent for sophisticated event processing.

A mature application may keep RxJS at integration boundaries while using Streamix for application state and lifecycle.

For example:

```ts
const pointer$ = fromEvent<PointerEvent>(
  canvas,
  "pointermove"
).pipe(
  throttleTime(16),
  map(event => ({
    x: event.clientX,
    y: event.clientY
  }))
);
```

That stream can feed a Streamix-owned process or state model.

Similarly, an existing library may already expose Observables.

There is no need to immediately wrap every source in a new abstraction solely for visual consistency.

The goal is not to remove every Observable.

The goal is to stop making the entire application think in Observables when much of the application is actually state, formulas, actions, and owned processes.

---

## The Architectural Shift

The movement from RxJS to Streamix can be summarized like this.

### RxJS

```text
source
  ↓
operator
  ↓
operator
  ↓
operator
  ↓
subscription
```

The central structure is the pipeline.

### Streamix

```text
scope
├── state
├── derived values
├── methods
├── flows
└── nested scopes
```

The central structure is ownership.

Inside a flow, there may still be pipelines.

Inside an integration boundary, there may still be streams.

But the application is no longer organized around the journey of every emission.

It is organized around things that exist, things that are calculated, things that happen, and the scopes that own them.

---

## What We Gain

The benefit is not merely fewer operators.

We gain code that uses the vocabulary of the application.

```ts
app.query = "reactive programming";
app.nextPage();

console.log(app.results);
```

We gain formulas that look like formulas:

```ts
total: self =>
  self.items.reduce(
    (sum, item) => sum + item.price,
    0
  )
```

We gain processes with explicit owners:

```ts
sync: self => flow(async function* (signal) {
  yield* synchronize(self.workspaceId, signal);
})
```

We gain cleanup attached to structure:

```ts
workspace.dispose();
```

And we gain the ability to use streams where they are genuinely the clearest abstraction, without requiring every current value and every application action to become one.

---

## What We Give Up

A model with several primitives is less mathematically uniform than a model where everything is an Observable.

There is no longer one universal answer to every problem.

Developers must distinguish between:

* state and events;
* formulas and transformations;
* commands and notifications;
* current values and histories;
* processes and their outputs.

That requires judgment.

But applications already contain these distinctions.

A universal stream abstraction does not remove them.

It merely allows us to postpone naming them.

Streamix chooses to make them visible.

---

## Crossing the Rubicon

Moving from RxJS to Streamix means giving up a comforting idea:

> If everything is a stream, everything composes in the same way.

In return, we get a different idea:

> Everything should be represented according to what it actually is.

A value should be a value.

A formula should be a formula.

An action should be an action.

A sequence should be a sequence.

A process should have an owner.

That is the modern approach Streamix proposes.

Not reactive programming without streams.

Reactive programming without forcing the whole application through one.
