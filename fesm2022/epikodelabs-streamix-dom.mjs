import { createSubject, createAsyncIterator, createStream, isPromiseLike } from '@epikodelabs/streamix';

/**
 * Creates a reactive stream that emits the time delta (in milliseconds) between
 * consecutive animation frames.
 *
 * This stream is driven by `requestAnimationFrame` when available, with a
 * timer-based fallback for non-browser environments.
 *
 * **Behavior:**
 * - A shared RAF loop starts when the first subscriber subscribes.
 * - Emits the delta between consecutive frames.
 * - Stops the RAF loop when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<number>} A stream emitting frame-to-frame time deltas.
 */
function onAnimationFrame() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let rafId = null;
    let lastTime = 0;
    let cancelFrame = null;
    const startLoop = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / non-browser guard
        if (typeof globalThis.performance === "undefined")
            return;
        const hasRaf = typeof globalThis.requestAnimationFrame === "function";
        const raf = typeof globalThis.requestAnimationFrame === "function"
            ? globalThis.requestAnimationFrame.bind(globalThis)
            : ((cb) => globalThis.setTimeout(() => cb(globalThis.performance.now()), 16));
        // Pick the corresponding cancellation function.
        // Prefer `cancelAnimationFrame` when RAF is used, but fall back to `clearTimeout`
        // for environments where RAF is timer-based or cancelAnimationFrame is missing.
        if (hasRaf && typeof globalThis.cancelAnimationFrame === "function") {
            cancelFrame = globalThis.cancelAnimationFrame.bind(globalThis);
        }
        else {
            cancelFrame = globalThis.clearTimeout.bind(globalThis);
        }
        const tick = (now) => {
            if (stopped)
                return;
            // Some RAF polyfills can provide non-monotonic timestamps; clamp to 0.
            // Also treat the first tick as a 0-delta frame.
            let delta = 0;
            if (lastTime > 0 && now >= lastTime) {
                delta = now - lastTime;
            }
            if (now >= lastTime) {
                lastTime = now;
            }
            subject.next(delta);
            rafId = raf(tick);
        };
        lastTime = 0;
        rafId = raf(tick);
    };
    const stopLoop = () => {
        if (stopped)
            return;
        stopped = true;
        if (rafId !== null) {
            cancelFrame?.(rafId);
            rafId = null;
        }
        cancelFrame = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            startLoop();
        }
    };
    subject.subscribe = (callback) => {
        const subscription = originalSubscribe.call(subject, callback);
        scheduleStart();
        const baseUnsubscribe = subscription.unsubscribe.bind(subscription);
        let cleaned = false;
        subscription.unsubscribe = () => {
            if (!cleaned) {
                cleaned = true;
                subscriberCount = Math.max(0, subscriberCount - 1);
                if (subscriberCount === 0) {
                    stopLoop();
                }
                // Some specs expect teardown to run synchronously.
                const teardown = subscription.teardown;
                subscription.teardown = undefined;
                try {
                    teardown?.();
                }
                catch {
                }
            }
            return baseUnsubscribe();
        };
        return subscription;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onAnimationFrame";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits battery state changes.
 *
 * Uses the Battery Status API when available.
 *
 * **Behavior:**
 * - Emits an initial battery snapshot on start.
 * - Emits on charging, level, and time changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<BatteryState>}
 */
function onBattery() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let battery = null;
    const snapshot = () => ({
        charging: battery.charging,
        level: battery.level,
        chargingTime: battery.chargingTime,
        dischargingTime: battery.dischargingTime
    });
    const emit = () => {
        subject.next(snapshot());
    };
    const start = async () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / unsupported API guard
        if (typeof navigator === "undefined" || !navigator.getBattery) {
            return;
        }
        try {
            battery = await navigator.getBattery();
            if (stopped || subscriberCount === 0)
                return;
            // Defer initial emission to allow subscription variable assignment
            if (!stopped)
                emit();
            battery.addEventListener("chargingchange", emit);
            battery.addEventListener("levelchange", emit);
            battery.addEventListener("chargingtimechange", emit);
            battery.addEventListener("dischargingtimechange", emit);
        }
        catch (err) {
            // getBattery() rejected - silently fail (e.g., permission denied)
            stopped = true;
        }
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        if (!battery)
            return;
        battery.removeEventListener("chargingchange", emit);
        battery.removeEventListener("levelchange", emit);
        battery.removeEventListener("chargingtimechange", emit);
        battery.removeEventListener("dischargingtimechange", emit);
        battery = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            void start(); // Always async due to getBattery API
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const baseUnsubscribe = sub.unsubscribe.bind(sub);
        let cleaned = false;
        sub.unsubscribe = () => {
            if (!cleaned) {
                cleaned = true;
                subscriberCount = Math.max(0, subscriberCount - 1);
                if (subscriberCount === 0) {
                    stop();
                }
                // Some DOM specs expect the teardown callback to run synchronously.
                const teardown = sub.teardown;
                sub.teardown = undefined;
                try {
                    teardown?.();
                }
                catch {
                }
            }
            return baseUnsubscribe();
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onBattery";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits fullscreen state changes.
 *
 * Emits `true` when entering fullscreen and `false` when exiting.
 *
 * **Behavior:**
 * - Emits the initial fullscreen state on start.
 * - Emits on every fullscreen change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Supports vendor-prefixed implementations.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<boolean>}
 */
function onFullscreen() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    /**
     * Checks whether the document is currently in fullscreen mode.
     */
    const isFullscreen = () => {
        if (typeof document === "undefined")
            return false;
        return !!(document.fullscreenElement ||
            document.webkitFullscreenElement ||
            document.mozFullScreenElement ||
            document.msFullscreenElement);
    };
    const emit = () => {
        subject.next(isFullscreen());
    };
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR guard
        if (typeof document === "undefined")
            return;
        document.addEventListener("fullscreenchange", emit);
        document.addEventListener("webkitfullscreenchange", emit);
        document.addEventListener("mozfullscreenchange", emit);
        document.addEventListener("MSFullscreenChange", emit);
        // Emit initial value immediately
        emit();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        if (typeof document === "undefined")
            return;
        document.removeEventListener("fullscreenchange", emit);
        document.removeEventListener("webkitfullscreenchange", emit);
        document.removeEventListener("mozfullscreenchange", emit);
        document.removeEventListener("MSFullscreenChange", emit);
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        // Create subscription first
        const sub = originalSubscribe.call(subject, cb);
        // Now if start() emits synchronously, the subscription variable is assigned
        scheduleStart();
        const baseUnsubscribe = sub.unsubscribe.bind(sub);
        let cleaned = false;
        sub.unsubscribe = () => {
            if (!cleaned) {
                cleaned = true;
                subscriberCount = Math.max(0, subscriberCount - 1);
                if (subscriberCount === 0) {
                    stop();
                }
                // Some DOM specs expect the teardown callback to run synchronously.
                const teardown = sub.teardown;
                sub.teardown = undefined;
                try {
                    teardown?.();
                }
                catch {
                }
            }
            return baseUnsubscribe();
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onFullscreen";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits `IdleDeadline` objects whenever
 * the browser enters an idle period.
 *
 * This stream is useful for scheduling low-priority work such as:
 * - background computations
 * - prefetching
 * - cache warming
 * - non-urgent state updates
 *
 * **Behavior:**
 * - Starts a shared idle loop when the first subscriber subscribes.
 * - Emits the `IdleDeadline` object provided by `requestIdleCallback`.
 * - Continues scheduling idle callbacks until all subscribers unsubscribe.
 * - Falls back to `setTimeout` when `requestIdleCallback` is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param timeout Optional timeout (ms) after which idle callback must fire.
 * @returns {Stream<IdleDeadline>} A stream emitting idle deadlines.
 */
function onIdle(timeout) {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let idleId = null;
    const startLoop = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / non-browser guard
        if (typeof setTimeout !== "function")
            return;
        const ric = typeof requestIdleCallback === "function"
            ? requestIdleCallback
            : ((cb) => setTimeout(() => cb({
                didTimeout: false,
                timeRemaining: () => 0
            }), 0));
        const tick = (deadline) => {
            if (stopped)
                return;
            subject.next(deadline);
            idleId = ric(tick, timeout != null ? { timeout } : undefined);
        };
        idleId = ric(tick, timeout != null ? { timeout } : undefined);
    };
    const stopLoop = () => {
        if (stopped)
            return;
        stopped = true;
        if (idleId !== null) {
            if (typeof cancelIdleCallback === "function") {
                cancelIdleCallback(idleId);
            }
            else {
                clearTimeout(idleId);
            }
            idleId = null;
        }
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            startLoop();
        }
    };
    subject.subscribe = (callback) => {
        const subscription = originalSubscribe.call(subject, callback);
        scheduleStart();
        const originalOnUnsubscribe = subscription.teardown;
        subscription.teardown = () => {
            if (--subscriberCount === 0) {
                stopLoop();
            }
            originalOnUnsubscribe?.call(subscription);
        };
        return subscription;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onIdle";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits `true` when a given element enters
 * the viewport and `false` when it leaves.
 *
 * This stream is a wrapper around the `IntersectionObserver` API and is useful
 * for lazy loading, visibility tracking, and viewport-aware effects.
 *
 * **Behavior:**
 * - Resolves the element and options once on first subscription.
 * - Emits the current intersection state whenever it changes.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional IntersectionObserver options (or promise).
 * @returns {Stream<boolean>} A stream emitting intersection state.
 */
function onIntersection(element, options) {
    return createStream("onIntersection", async function* (signal) {
        if (typeof IntersectionObserver === "undefined" ||
            typeof document === "undefined") {
            return;
        }
        const el = (isPromiseLike(element) ? await element : element) ?? null;
        const resolvedOptions = isPromiseLike(options) ? await options : options;
        if (signal?.aborted || !el)
            return;
        let done = false;
        let pending = null;
        const queue = [];
        const notify = () => {
            const r = pending;
            pending = null;
            r?.();
        };
        let last;
        const emit = (v) => {
            if (done)
                return;
            if (last === v)
                return;
            last = v;
            queue.push(v);
            notify();
        };
        const computeInitial = () => {
            if (typeof window === "undefined")
                return false;
            const rect = el.getBoundingClientRect();
            return rect.top < window.innerHeight && rect.bottom > 0;
        };
        let io = null;
        let mo = null;
        let hasEmitted = false;
        const stop = () => {
            if (done)
                return;
            done = true;
            try {
                io?.disconnect();
            }
            catch { }
            try {
                mo?.disconnect();
            }
            catch { }
            io = null;
            mo = null;
            notify();
        };
        const abortPromise = signal &&
            new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
        try {
            io = new IntersectionObserver((entries) => {
                hasEmitted = true;
                emit(entries[0]?.isIntersecting ?? false);
            }, resolvedOptions);
            io.observe(el);
            if (!hasEmitted) {
                emit(computeInitial());
            }
            if (typeof MutationObserver !== "undefined") {
                mo = new MutationObserver(() => {
                    if (!document.body.contains(el)) {
                        stop();
                    }
                });
                mo.observe(document.body, { childList: true, subtree: true });
            }
            while (!done && !signal?.aborted) {
                if (queue.length === 0) {
                    const wait = new Promise((resolve) => {
                        pending = resolve;
                    });
                    if (abortPromise) {
                        await Promise.race([wait, abortPromise]);
                    }
                    else {
                        await wait;
                    }
                    continue;
                }
                yield queue.shift();
            }
        }
        finally {
            stop();
        }
    });
}

/**
 * Creates a reactive stream that emits `true` or `false` whenever a CSS media
 * query matches or stops matching.
 *
 * This stream is useful for reacting to viewport size changes, orientation
 * changes, or other media feature conditions.
 *
 * **Behavior:**
 * - Resolves the media query once on first subscription.
 * - Emits the initial match state on start.
 * - Emits on every media query change.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param mediaQueryString A CSS media query string (or promise).
 * @returns {Stream<boolean>} A stream emitting match state.
 */
function onMediaQuery(query) {
    const subject = createSubject();
    let subscriberCount = 0;
    let active = false;
    let mql = null;
    let listener = null;
    /* -------------------------------------------------- */
    /* Immediate environment check (required by tests)    */
    /* -------------------------------------------------- */
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
        console.warn('matchMedia is not supported in this environment');
        return subject;
    }
    /* -------------------------------------------------- */
    /* Lifecycle                                          */
    /* -------------------------------------------------- */
    const start = () => {
        if (active)
            return;
        active = true;
        if (isPromiseLike(query)) {
            // Async path for promise query
            subject.next(false); // Emit false immediately
            void (async () => {
                const q = await query;
                if (!active)
                    return;
                mql = window.matchMedia(q);
                subject.next(mql.matches);
                listener = (e) => {
                    subject.next(e.matches);
                };
                if (typeof mql.addEventListener === 'function') {
                    mql.addEventListener('change', listener);
                }
                else if (typeof mql.addListener === 'function') {
                    mql.addListener(listener);
                }
            })();
        }
        else {
            // Synchronous path for immediate query
            mql = window.matchMedia(query);
            listener = (e) => {
                subject.next(e.matches);
            };
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', listener);
            }
            else if (typeof mql.addListener === 'function') {
                mql.addListener(listener);
            }
            if (active && mql)
                subject.next(mql.matches);
        }
    };
    const stop = () => {
        if (!active)
            return;
        active = false;
        if (mql && listener) {
            if (typeof mql.removeEventListener === 'function') {
                mql.removeEventListener('change', listener);
            }
            else if (typeof mql.removeListener === 'function') {
                mql.removeListener(listener);
            }
        }
        mql = null;
        listener = null;
    };
    /* -------------------------------------------------- */
    /* Ref-counted subscribe override                     */
    /* -------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const prev = sub.teardown;
        sub.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            prev?.call(sub);
        };
        return sub;
    };
    /* -------------------------------------------------- */
    /* Async iteration support                            */
    /* -------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (r) => subject.subscribe(r) })();
    subject.name = 'onMediaQuery';
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits arrays of `MutationRecord` objects
 * whenever mutations are observed on a given DOM element.
 *
 * This stream is a wrapper around the `MutationObserver` API and is useful
 * for reacting to DOM structure or attribute changes.
 *
 * **Behavior:**
 * - Resolves the target element and options once on first subscription.
 * - Emits mutation records whenever changes occur.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @param options Optional MutationObserver options (or promise).
 * @returns {Stream<MutationRecord[]>} A stream of mutation records.
 */
function onMutation(element, options) {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let resolvedElement = null;
    let resolvedOptions;
    let observer = null;
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / unsupported guard
        if (typeof MutationObserver === "undefined")
            return;
        if (isPromiseLike(element) || isPromiseLike(options)) {
            // Async path for promise element/options
            void (async () => {
                resolvedElement = isPromiseLike(element) ? await element : element;
                resolvedOptions = isPromiseLike(options) ? await options : options;
                if (stopped || !resolvedElement)
                    return;
                observer = new MutationObserver(mutations => {
                    subject.next([...mutations]);
                });
                observer.observe(resolvedElement, resolvedOptions);
            })();
        }
        else {
            // Synchronous path for immediate element/options
            resolvedElement = element;
            resolvedOptions = options;
            observer = new MutationObserver(mutations => {
                subject.next([...mutations]);
            });
            observer.observe(resolvedElement, resolvedOptions);
        }
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        observer?.disconnect();
        observer = null;
        resolvedElement = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const o = sub.teardown;
        sub.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            o?.call(sub);
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onMutation";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits network connectivity changes.
 *
 * This stream combines:
 * - `online` / `offline` events
 * - Network Information API (when available)
 *
 * **Behavior:**
 * - Emits an initial snapshot on start.
 * - Emits whenever connectivity or connection quality changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Gracefully degrades when Network Information API is unavailable.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<NetworkState>}
 */
function onNetwork() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let connection = null;
    const snapshot = () => ({
        online: typeof navigator !== "undefined" ? navigator.onLine : false,
        type: connection?.type,
        effectiveType: connection?.effectiveType,
        downlink: connection?.downlink,
        rtt: connection?.rtt,
        saveData: connection?.saveData
    });
    const emit = () => {
        subject.next(snapshot());
    };
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / unsupported guard
        if (typeof window === "undefined" || typeof navigator === "undefined") {
            return;
        }
        connection = navigator.connection ?? null;
        window.addEventListener("online", emit);
        window.addEventListener("offline", emit);
        connection?.addEventListener?.("change", emit);
        emit();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        if (typeof window === "undefined")
            return;
        window.removeEventListener("online", emit);
        window.removeEventListener("offline", emit);
        connection?.removeEventListener?.("change", emit);
        connection = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const o = sub.teardown;
        sub.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            o?.call(sub);
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onNetwork";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits the current screen orientation,
 * either `"portrait"` or `"landscape"`, whenever it changes.
 *
 * **Behavior:**
 * - Emits the initial orientation on start.
 * - Emits whenever the orientation changes.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<"portrait" | "landscape">}
 */
function onOrientation() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let orientation = null;
    const getOrientation = () => {
        if (typeof window === "undefined" ||
            !window.screen ||
            !window.screen.orientation) {
            return "portrait";
        }
        const angle = window.screen.orientation.angle;
        return angle === 0 || angle === 180 ? "portrait" : "landscape";
    };
    const emit = () => {
        subject.next(getOrientation());
    };
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        if (typeof window === "undefined" || !window.screen) {
            return;
        }
        // If the Orientation API is unavailable, still emit a sane default once.
        if (!window.screen.orientation) {
            emit();
            return;
        }
        orientation = window.screen.orientation;
        orientation.addEventListener("change", emit);
        emit();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        orientation?.removeEventListener("change", emit);
        orientation = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const baseUnsubscribe = sub.unsubscribe.bind(sub);
        let cleaned = false;
        sub.unsubscribe = () => {
            if (!cleaned) {
                cleaned = true;
                subscriberCount = Math.max(0, subscriberCount - 1);
                if (subscriberCount === 0) {
                    stop();
                }
                // Some DOM specs expect the teardown callback to run synchronously.
                const teardown = sub.teardown;
                sub.teardown = undefined;
                try {
                    teardown?.();
                }
                catch {
                }
            }
            return baseUnsubscribe();
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onOrientation";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits the dimensions of a given DOM element
 * whenever it is resized.
 *
 * This stream is a wrapper around the `ResizeObserver` API.
 *
 * **Behavior:**
 * - Resolves the element once on first subscription.
 * - Emits the current width and height whenever the element is resized.
 * - Emits the initial size on start.
 * - Starts observing on first subscriber.
 * - Stops observing when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @param element The DOM element (or promise) to observe.
 * @returns {Stream<{ width: number; height: number }>}
 */
function onResize(element) {
    const subject = createSubject();
    let subscriberCount = 0;
    let active = false;
    let resolvedElement = null;
    let observer = null;
    /* -------------------------------------------------- */
    /* Helpers                                            */
    /* -------------------------------------------------- */
    const emit = (entry) => {
        if (!resolvedElement)
            return;
        // Prefer contentBoxSize over deprecated contentRect for modern browsers.
        // contentBoxSize is a FrozenArray<ResizeObserverSize>, use the first entry.
        let width;
        let height;
        if (entry?.contentBoxSize?.length) {
            const boxSize = entry.contentBoxSize[0];
            width = Math.round(boxSize.inlineSize);
            height = Math.round(boxSize.blockSize);
        }
        else if (entry?.contentRect) {
            // Fallback to contentRect for older browsers
            width = Math.round(entry.contentRect.width);
            height = Math.round(entry.contentRect.height);
        }
        else {
            const rect = resolvedElement.getBoundingClientRect();
            width = Math.round(rect.width);
            height = Math.round(rect.height);
        }
        subject.next({ width, height });
    };
    /* -------------------------------------------------- */
    /* Lifecycle                                          */
    /* -------------------------------------------------- */
    const start = () => {
        if (active)
            return;
        active = true;
        // SSR / unsupported
        if (typeof ResizeObserver === "undefined") {
            active = false;
            return;
        }
        if (isPromiseLike(element)) {
            // Async: wait for element resolution
            void (async () => {
                const el = await element;
                if (!active || !el)
                    return;
                resolvedElement = el;
                observer = new ResizeObserver(entries => emit(entries[0]));
                observer.observe(resolvedElement);
                if (active)
                    emit();
            })();
        }
        else {
            // Sync: setup immediately, defer emission
            resolvedElement = element;
            observer = new ResizeObserver(entries => emit(entries[0]));
            observer.observe(resolvedElement);
            if (active)
                emit();
        }
    };
    const stop = () => {
        if (!active)
            return;
        active = false;
        observer?.disconnect();
        observer = null;
        resolvedElement = null;
    };
    /* -------------------------------------------------- */
    /* Ref-counted subscription override                  */
    /* -------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const baseUnsubscribe = sub.unsubscribe.bind(sub);
        let cleaned = false;
        sub.unsubscribe = () => {
            if (!cleaned) {
                cleaned = true;
                subscriberCount = Math.max(0, subscriberCount - 1);
                if (subscriberCount === 0) {
                    stop();
                }
                // Some DOM specs expect the teardown callback to run synchronously.
                const teardown = sub.teardown;
                sub.teardown = undefined;
                try {
                    teardown?.();
                }
                catch {
                }
            }
            return baseUnsubscribe();
        };
        return sub;
    };
    /* -------------------------------------------------- */
    /* Async iteration support                            */
    /* -------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onResize";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits changes to the visual viewport.
 *
 * Uses `visualViewport` when available, falling back to `window`.
 *
 * **Behavior:**
 * - Emits initial viewport metrics on start.
 * - Emits on resize, scroll, and zoom.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<ViewportState>}
 */
function onViewportChange() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    let target = null;
    const snapshot = () => {
        if (typeof window === "undefined") {
            return {
                width: 0,
                height: 0,
                scale: 1,
                offsetLeft: 0,
                offsetTop: 0
            };
        }
        if (window.visualViewport) {
            const vp = window.visualViewport;
            return {
                width: vp.width,
                height: vp.height,
                scale: vp.scale,
                offsetLeft: vp.offsetLeft,
                offsetTop: vp.offsetTop
            };
        }
        return {
            width: window.innerWidth,
            height: window.innerHeight,
            scale: 1,
            offsetLeft: 0,
            offsetTop: 0
        };
    };
    const emit = () => {
        subject.next(snapshot());
    };
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR guard
        if (typeof window === "undefined")
            return;
        target = window.visualViewport ?? window;
        target.addEventListener("resize", emit);
        target.addEventListener("scroll", emit);
        emit();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        if (!target)
            return;
        target.removeEventListener("resize", emit);
        target.removeEventListener("scroll", emit);
        target = null;
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const o = sub.teardown;
        sub.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            o?.call(sub);
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onViewportChange";
    subject.type = "stream";
    return subject;
}

/**
 * Creates a reactive stream that emits the document's visibility state
 * whenever it changes.
 *
 * This stream is useful for:
 * - pausing animations or polling when the page is hidden
 * - throttling background work
 * - detecting tab switching or minimization
 *
 * **Behavior:**
 * - Emits the current visibility state on start.
 * - Emits on every `visibilitychange` event.
 * - Starts listening on first subscriber.
 * - Stops listening when the last subscriber unsubscribes.
 * - Safe to import and subscribe in SSR (no-op).
 * - Fully compatible with async iteration.
 *
 * @returns {Stream<DocumentVisibilityState>}
 */
function onVisibilityChange() {
    const subject = createSubject();
    let subscriberCount = 0;
    let stopped = true;
    const getState = () => {
        if (typeof document === "undefined") {
            return "visible";
        }
        const state = document.visibilityState;
        if (state === "visible" || state === "hidden") {
            return state;
        }
        return "visible";
    };
    const emit = () => {
        subject.next(getState());
    };
    const start = () => {
        if (!stopped)
            return;
        stopped = false;
        // SSR / unsupported guard
        if (typeof document === "undefined")
            return;
        document.addEventListener("visibilitychange", emit);
        emit();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        if (typeof document === "undefined")
            return;
        document.removeEventListener("visibilitychange", emit);
    };
    /* ------------------------------------------------------------------------
     * Ref-counted subscription handling
     * ---------------------------------------------------------------------- */
    const originalSubscribe = subject.subscribe;
    const scheduleStart = () => {
        subscriberCount += 1;
        if (subscriberCount === 1) {
            start();
        }
    };
    subject.subscribe = (cb) => {
        const sub = originalSubscribe.call(subject, cb);
        scheduleStart();
        const o = sub.teardown;
        sub.teardown = () => {
            if (--subscriberCount === 0) {
                stop();
            }
            o?.call(sub);
        };
        return sub;
    };
    /* ------------------------------------------------------------------------
     * Async iteration support
     * ---------------------------------------------------------------------- */
    subject[Symbol.asyncIterator] = () => createAsyncIterator({ register: (receiver) => subject.subscribe(receiver) })();
    subject.name = "onVisibilityChange";
    subject.type = "stream";
    return subject;
}

/*
 * Public API Surface of actionstack
 */

/**
 * Generated bundle index. Do not edit.
 */

export { onAnimationFrame, onBattery, onFullscreen, onIdle, onIntersection, onMediaQuery, onMutation, onNetwork, onOrientation, onResize, onViewportChange, onVisibilityChange };
//# sourceMappingURL=epikodelabs-streamix-dom.mjs.map
