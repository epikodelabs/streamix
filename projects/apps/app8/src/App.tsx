import { useCallback, useEffect, useRef, useState } from 'react';
import { atom, derived, fromPush, type PushSink, type Readable } from '@epikodelabs/streamix';
import { useAtom, useAtomValue } from '@epikodelabs/streamix/react';
import { Activity, ListOrdered, Settings2 } from 'lucide-react';
import type { QueueItem, ScenarioPreset, ProducerStatus, ConsumerStatus, PushMode, PushOverflow, SimulationStats } from './types';
import { TopBar } from './components/TopBar';
import { FifoBufferVisualizer } from './components/FifoBufferVisualizer';
import { SimulationControls } from './components/SimulationControls';
import { MetricsPanel } from './components/MetricsPanel';
import { ConsumptionHistory } from './components/ConsumptionHistory';
import { EducationalGuideModal } from './components/EducationalGuideModal';
import { sound } from './utils/audio';

const TRANSIT_MS = 480;
const TOKEN_COLORS = ['#6750a4', '#277bb5', '#0b937d', '#699f51', '#c58c40', '#b96948', '#ad5d83', '#7975c5'];
const initialStats = (): SimulationStats => ({
  totalProduced: 0, totalDelivered: 0, totalBlockedEvents: 0,
  totalDropped: 0, peakOccupancy: 0, averageDwellTimeMs: 0, pendingPromises: 0,
});

function makeToken(seq: number): QueueItem {
  return { id: seq, value: seq, producedAt: Date.now(),
    color: TOKEN_COLORS[(seq - 1) % TOKEN_COLORS.length], status: 'queued' };
}

/** A push whose `sink.next()` admission promise is still pending. */
interface PendingPush {
  item: QueueItem;
}

/**
 * A real `fromPush` source owns admission, the blocked-producer queue,
 * overflow policy, completion, and delivery. The visualizer keeps a
 * presentation mirror of accepted values so it can animate the bounded queue
 * slot by slot; pull delivery (`prefetch: false`) keeps that mirror aligned
 * with the source's single admission buffer instead of a second prefetch
 * backlog.
 *
 * The automatic producer awaits `sink.next()`, so it genuinely stalls while
 * the source is full. Manual and burst pushes deliberately ignore the
 * returned promise, which is how the blocked backlog grows.
 */
export default function App() {
  const [mode, setMode] = useState<PushMode>('discrete');
  const [overflow, setOverflow] = useState<PushOverflow>('block');
  const [capacity, setCapacity] = useState(8);
  const [producerRate, setProducerRate] = useState(1.0);
  const [consumerRate, setConsumerRate] = useState(3.0);
  const [speedMultiplier, setSpeedMultiplier] = useState(1);
  const [isAutoPlay, setIsAutoPlay] = useState(true);
  const [activeScenario, setActiveScenario] = useState<ScenarioPreset>('backpressure-block');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [sessionKey, setSessionKey] = useState(0);

  // Streamix-owned domain state: the inspector sees these atoms/derived.
  const itemsAtom = useAtom(() => atom<QueueItem[]>([]));
  const blockedAtom = useAtom(() => atom<QueueItem[]>([]));
  const reservedAtom = useAtom(() => atom(0));
  const statsAtom = useAtom(() => atom<SimulationStats>(initialStats()));
  const occupancyAtom = useAtom(() => derived(() => itemsAtom.value.length + reservedAtom.value));

  const items = useAtomValue(itemsAtom);
  const blockedItems = useAtomValue(blockedAtom);
  const stats = useAtomValue(statsAtom);
  const occupancy = useAtomValue(occupancyAtom);

  const [stagedProducerToken, setStagedProducerToken] = useState(() => makeToken(1));
  const [inTransitInToken, setInTransitInToken] = useState<QueueItem | null>(null);
  const [inTransitOutToken, setInTransitOutToken] = useState<QueueItem | null>(null);
  const [recentlyConsumedItem, setRecentlyConsumedItem] = useState<QueueItem | null>(null);
  const [isEmitting, setIsEmitting] = useState(false);
  const [isBursting, setIsBursting] = useState(false);
  const [burstRemaining, setBurstRemaining] = useState(0);
  const [subscriberValue, setSubscriberValue] = useState<QueueItem | null>(null);
  const [producerStatus, setProducerStatus] = useState<ProducerStatus>('idle');
  const [consumerStatus, setConsumerStatus] = useState<ConsumerStatus>('idle');
  const [isFinishing, setIsFinishing] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [consumptionHistory, setConsumptionHistory] = useState<QueueItem[]>([]);

  // Refs are authoritative inside independent timer callbacks; atoms publish
  // the same values to React without ever being mutated from a state updater.
  const seqRef = useRef(1);
  const queueRef = useRef<QueueItem[]>([]);
  const blockedRef = useRef<PendingPush[]>([]);
  const reservedRef = useRef<QueueItem[]>([]);
  const incomingRef = useRef(false);
  const outgoingRef = useRef(false);
  const finishingRef = useRef(false);
  const completedRef = useRef(false);
  const errorRef = useRef(false);
  const epochRef = useRef(0);
  const sessionEpochRef = useRef(0);
  const pendingAdmissionsRef = useRef(0);
  const inTransitIdRef = useRef<number | null>(null);
  const sourceRef = useRef<Readable<QueueItem> | null>(null);
  const sinkRef = useRef<PushSink<QueueItem> | null>(null);
  const iteratorRef = useRef<AsyncIterator<QueueItem> | null>(null);
  const incomingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outgoingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const launchInletRef = useRef<() => void>(() => {});
  const checkCompletionRef = useRef<() => void>(() => {});
  const abortRef = useRef<(reason: string) => void>(() => {});

  const updateStats = useCallback((updater: (previous: SimulationStats) => SimulationStats) => {
    statsAtom.next(updater(statsAtom.value));
  }, [statsAtom]);

  const commitItems = useCallback((next: QueueItem[]) => {
    queueRef.current = next;
    itemsAtom.next(next);
  }, [itemsAtom]);
  const commitBlocked = useCallback((next: PendingPush[]) => {
    blockedRef.current = next;
    blockedAtom.next(next.map(record => record.item));
  }, [blockedAtom]);

  useEffect(() => { sound.enabled = soundEnabled; }, [soundEnabled]);

  const checkCompletion = useCallback(() => {
    if (!finishingRef.current || completedRef.current || errorRef.current) return;
    if (pendingAdmissionsRef.current !== 0) return;
    if (queueRef.current.length !== 0 || blockedRef.current.length !== 0 ||
        reservedRef.current.length !== 0 || incomingRef.current || outgoingRef.current) return;
    completedRef.current = true;
    setIsCompleted(true);
    setConsumerStatus('completed');
    setProducerStatus('completed');
  }, []);
  checkCompletionRef.current = checkCompletion;

  const stopInlet = useCallback(() => {
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    incomingTimerRef.current = null;
    incomingRef.current = false;
    inTransitIdRef.current = null;
    setIsEmitting(false);
    setInTransitInToken(null);
  }, []);

  // At most one token is visually in transit, even when many buffer slots have
  // already been reserved. A reservation is not a visible buffered item.
  const launchInlet = useCallback(() => {
    if (incomingRef.current || completedRef.current || errorRef.current) return;
    const token = reservedRef.current[0];
    if (!token) { checkCompletionRef.current(); return; }
    incomingRef.current = true;
    inTransitIdRef.current = token.id;
    setIsEmitting(true);
    setInTransitInToken(token);
    setProducerStatus('producing');
    const epoch = epochRef.current;
    incomingTimerRef.current = setTimeout(() => {
      incomingTimerRef.current = null;
      if (epoch !== epochRef.current || errorRef.current) return;
      incomingRef.current = false;
      inTransitIdRef.current = null;
      setIsEmitting(false);
      setInTransitInToken(null);
      const index = reservedRef.current.findIndex(entry => entry.id === token.id);
      if (index < 0) {
        // The source dropped this reservation while it was in transit.
        launchInletRef.current();
        checkCompletionRef.current();
        return;
      }
      reservedRef.current.splice(index, 1);
      reservedAtom.next(reservedRef.current.length);
      if (queueRef.current.length >= capacity) {
        // The source admitted beyond the visible capacity; keep the mirror
        // bounded rather than rendering more tiles than slots.
        updateStats(previous => ({ ...previous, totalDropped: previous.totalDropped + 1 }));
      } else {
        commitItems([...queueRef.current, { ...token, enteredBufferAt: Date.now(), status: 'queued' }]);
        sound.playEnqueue();
      }
      launchInletRef.current();
      setProducerStatus(blockedRef.current.length ? 'blocked' : finishingRef.current ? 'completed' : 'idle');
      checkCompletionRef.current();
    }, TRANSIT_MS);
  }, [capacity, commitItems, reservedAtom, updateStats]);
  launchInletRef.current = launchInlet;

  /**
   * Removes the token the real source dropped. The head/tail position follows
   * fromPush's queue order: items are older admissions, reservations newer.
   */
  const dropQueuedToken = useCallback((position: 'head' | 'tail') => {
    if (queueRef.current.length > 0) {
      const next = position === 'head' ? queueRef.current.slice(1) : queueRef.current.slice(0, -1);
      commitItems(next);
      return;
    }
    if (reservedRef.current.length > 0) {
      const index = position === 'head' ? 0 : reservedRef.current.length - 1;
      const [removed] = reservedRef.current.splice(index, 1);
      reservedAtom.next(reservedRef.current.length);
      if (removed.id === inTransitIdRef.current) stopInlet();
    }
  }, [commitItems, reservedAtom, stopInlet]);

  const admitVisual = useCallback((item: QueueItem) => {
    reservedRef.current.push(item);
    reservedAtom.next(reservedRef.current.length);
    updateStats(previous => ({
      ...previous,
      peakOccupancy: Math.max(previous.peakOccupancy, queueRef.current.length + reservedRef.current.length),
    }));
    launchInletRef.current();
  }, [reservedAtom, updateStats]);

  // A source session per configuration. fromPush starts its lazy producer when
  // the iterator below is created; resetting bumps sessionKey and swaps it.
  useEffect(() => {
    const session = ++sessionEpochRef.current;
    let connectedSink: PushSink<QueueItem> | null = null;
    const source = fromPush<QueueItem>((sink) => {
      connectedSink = sink;
      sinkRef.current = sink;
      return () => {
        if (sinkRef.current === sink) sinkRef.current = null;
      };
    }, {
      name: 'app8-fifo',
      mode,
      capacity,
      // fromPush rejects blocking/error policies for analog sources.
      overflow: mode === 'analog' && (overflow === 'block' || overflow === 'error') ? 'drop-oldest' : overflow,
      prefetch: false,
    });
    sourceRef.current = source;
    const unsubscribeError = source.onError(error => {
      if (session !== sessionEpochRef.current) return;
      abortRef.current(error instanceof Error ? error.message : String(error));
    });
    const iterator = source[Symbol.asyncIterator]();
    iteratorRef.current = iterator;
    return () => {
      void unsubscribeError();
      source.dispose();
      if (sourceRef.current === source) sourceRef.current = null;
      if (iteratorRef.current === iterator) iteratorRef.current = null;
      if (connectedSink && sinkRef.current === connectedSink) sinkRef.current = null;
    };
  }, [mode, overflow, capacity, sessionKey]);

  const abortSimulation = useCallback((reason: string) => {
    if (errorRef.current) return;
    epochRef.current++;
    sessionEpochRef.current++;
    pendingAdmissionsRef.current = 0;
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    if (outgoingTimerRef.current) clearTimeout(outgoingTimerRef.current);
    incomingTimerRef.current = null;
    outgoingTimerRef.current = null;
    incomingRef.current = false;
    outgoingRef.current = false;
    inTransitIdRef.current = null;
    const source = sourceRef.current;
    sourceRef.current = null;
    sinkRef.current = null;
    iteratorRef.current = null;
    source?.dispose();
    reservedRef.current = [];
    reservedAtom.next(0);
    commitItems([]);
    commitBlocked([]);
    setInTransitInToken(null);
    setInTransitOutToken(null);
    setIsEmitting(false);
    setBurstRemaining(0);
    setIsBursting(false);
    finishingRef.current = true;
    completedRef.current = true;
    errorRef.current = true;
    setIsFinishing(true);
    setIsCompleted(true);
    setHasError(true);
    setErrorMessage(reason);
    setProducerStatus('error');
    setConsumerStatus('completed');
    sound.playBlocked();
  }, [commitBlocked, commitItems, reservedAtom]);
  abortRef.current = abortSimulation;

  const handleProduce = useCallback((): Promise<boolean> => {
    if (finishingRef.current || completedRef.current || errorRef.current) return Promise.resolve(false);
    const sink = sinkRef.current;
    if (!sink) return Promise.resolve(false);
    const epoch = epochRef.current;
    const session = sessionEpochRef.current;
    const token = makeToken(seqRef.current++);
    setStagedProducerToken(makeToken(seqRef.current));
    updateStats(previous => ({ ...previous, totalProduced: previous.totalProduced + 1 }));

    const full = queueRef.current.length + reservedRef.current.length >= capacity;
    const stillCurrent = () => epoch === epochRef.current && session === sessionEpochRef.current;
    const failFrom = (error: unknown) => {
      if (stillCurrent()) abortRef.current(error instanceof Error ? error.message : String(error));
    };
    const trackAdmission = (attempt: Promise<void>) => {
      pendingAdmissionsRef.current++;
      void attempt.then(() => {
        if (!stillCurrent()) return;
        pendingAdmissionsRef.current = Math.max(0, pendingAdmissionsRef.current - 1);
        admitVisual(token);
      }).catch(failFrom);
    };

    if (mode === 'analog') {
      if (full) {
        // Analog replaces the newest pending value; the prefix is retained.
        dropQueuedToken('tail');
        updateStats(previous => ({ ...previous, totalDropped: previous.totalDropped + 1 }));
      }
      const admission = sink.next(token);
      trackAdmission(admission);
      sound.playProduce();
      return admission.then(() => true);
    }

    if (overflow === 'block') {
      if (!full && blockedRef.current.length === 0) {
        const admission = sink.next(token);
        trackAdmission(admission);
        sound.playProduce();
        return admission.then(() => true);
      }
      // The source's own blocked queue now owns admission. Its promise stays
      // pending while the buffer is full and resolves when a pull frees a slot.
      const admission = sink.next(token);
      commitBlocked([...blockedRef.current, { item: { ...token, status: 'blocked' } }]);
      updateStats(previous => ({ ...previous, totalBlockedEvents: previous.totalBlockedEvents + 1 }));
      setProducerStatus('blocked');
      sound.playBlocked();
      void admission.then(() => {
        if (!stillCurrent()) return;
        commitBlocked(blockedRef.current.filter(record => record.item.id !== token.id));
        admitVisual(token);
        setProducerStatus(blockedRef.current.length ? 'blocked' : finishingRef.current ? 'completed' : 'idle');
      }).catch(failFrom);
      return admission.then(() => true);
    }

    if (full && overflow === 'error') {
      // The source fails itself; onError below reports the same condition.
      void sink.next(token);
      abortRef.current(`Buffer capacity exceeded (${capacity})`);
      return Promise.resolve(false);
    }

    if (full && overflow === 'drop-newest') {
      void sink.next(token);
      updateStats(previous => ({ ...previous, totalDropped: previous.totalDropped + 1 }));
      sound.playBlocked();
      return Promise.resolve(true);
    }

    if (full) {
      // drop-oldest: the source discards the head and admits the new value.
      dropQueuedToken('head');
      updateStats(previous => ({ ...previous, totalDropped: previous.totalDropped + 1 }));
    }
    const admission = sink.next(token);
    trackAdmission(admission);
    sound.playProduce();
    return admission.then(() => true);
  }, [capacity, mode, overflow, admitVisual, commitBlocked, dropQueuedToken, updateStats]);

  const handleConsume = useCallback((): boolean => {
    if (errorRef.current || outgoingRef.current || queueRef.current.length === 0) {
      if (!errorRef.current && queueRef.current.length === 0 && !finishingRef.current) setConsumerStatus('starved');
      return false;
    }
    const iterator = iteratorRef.current;
    if (!iterator) return false;
    const epoch = epochRef.current;
    const session = sessionEpochRef.current;
    const token = queueRef.current[0];
    outgoingRef.current = true;
    const departed: QueueItem = { ...token, status: 'delivered', consumedAt: Date.now(),
      dwellTimeMs: token.enteredBufferAt ? Date.now() - token.enteredBufferAt : 0 };
    commitItems(queueRef.current.slice(1));
    setInTransitOutToken(departed);
    setConsumerStatus('consuming');
    sound.playConsume();
    // Pull from the real iterator. This is the operation that frees source
    // capacity and lets fromPush admit a blocked producer.
    void iterator.next().catch(error => {
      if (epoch === epochRef.current && session === sessionEpochRef.current) {
        abortRef.current(error instanceof Error ? error.message : String(error));
      }
    });
    outgoingTimerRef.current = setTimeout(() => {
      outgoingTimerRef.current = null;
      if (epoch !== epochRef.current || errorRef.current) return;
      outgoingRef.current = false;
      setInTransitOutToken(null);
      setRecentlyConsumedItem(departed);
      setSubscriberValue(departed);
      setConsumptionHistory(previous => [departed, ...previous]);
      updateStats(previous => {
        const count = previous.totalDelivered + 1;
        return { ...previous, totalDelivered: count,
          averageDwellTimeMs: Math.round((previous.averageDwellTimeMs * previous.totalDelivered + (departed.dwellTimeMs || 0)) / count) };
      });
      setConsumerStatus('idle');
      checkCompletionRef.current();
    }, TRANSIT_MS);
    return true;
  }, [commitItems, updateStats]);

  const handleComplete = useCallback(() => {
    if (finishingRef.current || completedRef.current || errorRef.current) return;
    finishingRef.current = true;
    setIsFinishing(true);
    setProducerStatus('completed');
    setBurstRemaining(0);
    // The source admits already-blocked producers as pulls drain the buffer,
    // then completes once the accepted values are delivered.
    sinkRef.current?.complete();
    checkCompletionRef.current();
  }, []);

  const handleReset = useCallback(() => {
    epochRef.current++;
    // Invalidate source callbacks before the effect swaps in the next session.
    sessionEpochRef.current++;
    pendingAdmissionsRef.current = 0;
    if (incomingTimerRef.current) clearTimeout(incomingTimerRef.current);
    if (outgoingTimerRef.current) clearTimeout(outgoingTimerRef.current);
    incomingTimerRef.current = null;
    outgoingTimerRef.current = null;
    incomingRef.current = false;
    outgoingRef.current = false;
    inTransitIdRef.current = null;
    finishingRef.current = false;
    completedRef.current = false;
    errorRef.current = false;
    reservedRef.current = [];
    reservedAtom.next(0);
    seqRef.current = 1;
    commitItems([]);
    commitBlocked([]);
    setStagedProducerToken(makeToken(1));
    setInTransitInToken(null);
    setInTransitOutToken(null);
    setRecentlyConsumedItem(null);
    setSubscriberValue(null);
    setIsEmitting(false);
    setIsBursting(false);
    setBurstRemaining(0);
    setIsFinishing(false);
    setIsCompleted(false);
    setHasError(false);
    setErrorMessage(undefined);
    setProducerStatus('idle');
    setConsumerStatus('idle');
    statsAtom.next(initialStats());
    setConsumptionHistory([]);
    setSessionKey(previous => previous + 1);
  }, [commitBlocked, commitItems, reservedAtom, statsAtom]);

  const handleScenario = useCallback((preset: ScenarioPreset) => {
    handleReset();
    setActiveScenario(preset);
    switch (preset) {
      case 'backpressure-block': setMode('discrete'); setOverflow('block'); setCapacity(4); setProducerRate(1); setConsumerRate(3); setIsAutoPlay(true); break;
      case 'analog-coalescing': setMode('analog'); setOverflow('drop-oldest'); setCapacity(1); setProducerRate(.8); setConsumerRate(2.4); setIsAutoPlay(true); break;
      case 'drop-oldest': setMode('discrete'); setOverflow('drop-oldest'); setCapacity(4); setProducerRate(1); setConsumerRate(2.8); setIsAutoPlay(true); break;
      case 'drop-newest': setMode('discrete'); setOverflow('drop-newest'); setCapacity(4); setProducerRate(1); setConsumerRate(2.8); setIsAutoPlay(true); break;
      case 'overflow-error': setMode('discrete'); setOverflow('error'); setCapacity(4); setProducerRate(1); setConsumerRate(4); setIsAutoPlay(true); break;
      case 'balanced': setMode('discrete'); setOverflow('block'); setCapacity(6); setProducerRate(1.8); setConsumerRate(1.8); setIsAutoPlay(true); break;
      case 'burst': setMode('discrete'); setOverflow('block'); setCapacity(6); setProducerRate(.6); setConsumerRate(2.2); setIsAutoPlay(true); break;
      case 'manual': setIsAutoPlay(false); break;
    }
  }, [handleReset]);

  useEffect(() => {
    if (!isAutoPlay || isFinishing || isCompleted || hasError) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const intervalMs = Math.max(300, producerRate * 1000 / speedMultiplier);

    // A sequential source: it does not start a new emission until the previous
    // push is accepted. While the source is full the promise stays pending, so
    // the generator is genuinely stalled. A fire-and-forget timer source would
    // keep firing here and simply grow the blocked backlog instead.
    const tick = async () => {
      if (cancelled) return;
      const startedAt = Date.now();
      const accepted = await handleProduce();
      if (cancelled || !accepted) return;
      const wait = Math.max(0, intervalMs - (Date.now() - startedAt));
      timer = setTimeout(() => { void tick(); }, wait);
    };

    timer = setTimeout(() => { void tick(); }, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isAutoPlay, isFinishing, isCompleted, hasError, producerRate, speedMultiplier, handleProduce]);
  useEffect(() => {
    if (!isAutoPlay || isCompleted || hasError) return;
    const interval = setInterval(handleConsume, Math.max(300, consumerRate * 1000 / speedMultiplier));
    return () => clearInterval(interval);
  }, [isAutoPlay, isCompleted, hasError, consumerRate, speedMultiplier, handleConsume]);
  useEffect(() => {
    if (burstRemaining <= 0) { setIsBursting(false); return; }
    if (isFinishing || isCompleted || hasError) { setBurstRemaining(0); setIsBursting(false); return; }
    setIsBursting(true);
    const timer = setTimeout(() => {
      // Burst is the deliberate fire-and-forget case: the promise is ignored,
      // so pushes may pile up while the source is full.
      void handleProduce();
      setBurstRemaining(previous => Math.max(0, previous - 1));
    }, 160);
    return () => clearTimeout(timer);
  }, [burstRemaining, isFinishing, isCompleted, hasError, handleProduce]);

  const handleStep = () => {
    if (queueRef.current.length > 0) handleConsume();
    else void handleProduce();
  };
  const pendingValues = blockedItems.length;
  const isFull = occupancy >= capacity;
  const simulationStats = { ...stats, pendingPromises: pendingValues };

  return (
    <div className="focus-workbench">
      <TopBar onReset={handleReset} onOpenGuide={() => setIsGuideOpen(true)}
        soundEnabled={soundEnabled} onToggleSound={() => setSoundEnabled(previous => !previous)}
        activeSection="visualizer" onSelectSection={() => document.getElementById('visualizer')?.scrollIntoView({ behavior: 'smooth' })} />
      <main className="focus-main">
        <section className="focus-intro" aria-label="Session status">
          <div><h1>FIFO queue</h1><p>Push-to-pull flow control · FIFO buffer and backpressure</p></div>
          <div className={`focus-session-state${hasError ? ' is-error' : isCompleted ? ' is-done' : isFinishing ? ' is-draining' : ''}`}>
            {hasError ? 'Error' : isCompleted ? 'Completed' : isFinishing ? 'Draining' : isAutoPlay ? 'Running' : 'Paused'}
          </div>
        </section>
        <section id="visualizer" className="focus-live-section">
          <FifoBufferVisualizer mode={mode} overflow={overflow} capacity={capacity}
            items={items} blockedItems={blockedItems} stagedProducerToken={stagedProducerToken}
            recentlyConsumedItem={recentlyConsumedItem} inTransitInToken={inTransitInToken}
            inTransitOutToken={inTransitOutToken} isEmitting={isEmitting} isBursting={isBursting}
            producerStatus={producerStatus} consumerStatus={consumerStatus} isFull={isFull}
            isEmpty={items.length === 0} pendingPromisesCount={pendingValues}
            sessionState={{ isStopped: isCompleted || hasError, isFinishing, isCompleted, hasError, errorMessage }}
            subscriberValue={subscriberValue} subscriberCount={1}
            onManualProduce={handleProduce} onManualBurst={() => setBurstRemaining(previous => previous + 3)}
            onManualConsume={handleConsume} onSinkComplete={handleComplete}
            onSinkError={() => sinkRef.current?.error('Simulated source error')}
            onRestartSession={handleReset} isAutoPlay={isAutoPlay}
            onToggleAutoPlay={() => setIsAutoPlay(previous => !previous)} onStep={handleStep} onReset={handleReset} />
        </section>
        <section className="focus-secondary" aria-label="Additional tools">
          <details className="focus-panel" id="controls" open>
            <summary><Settings2 size={16} /><span>Configuration</span></summary>
            <div className="focus-panel-body">
              <SimulationControls isAutoPlay={isAutoPlay} onToggleAutoPlay={() => setIsAutoPlay(previous => !previous)}
                onStep={handleStep} onReset={handleReset} mode={mode}
                onChangeMode={newMode => { handleReset(); setMode(newMode); setOverflow(newMode === 'analog' ? 'drop-oldest' : 'block'); setCapacity(newMode === 'analog' ? 1 : 6); }}
                overflow={overflow} onChangeOverflow={newValue => { handleReset(); setOverflow(newValue); }}
                capacity={capacity} onChangeCapacity={newValue => { handleReset(); setCapacity(newValue); }}
                producerRate={producerRate} onChangeProducerRate={setProducerRate}
                consumerRate={consumerRate} onChangeConsumerRate={setConsumerRate}
                speedMultiplier={speedMultiplier} onChangeSpeedMultiplier={setSpeedMultiplier}
                activeScenario={activeScenario} onSelectScenario={handleScenario} />
            </div>
          </details>
          <details className="focus-panel" id="history" open>
            <summary><ListOrdered size={16} /><span>Activity &amp; metrics</span></summary>
            <div className="focus-panel-body">
              <MetricsPanel stats={simulationStats} currentOccupancy={occupancy} capacity={capacity}
                isFull={isFull} mode={mode} overflow={overflow} />
              <ConsumptionHistory history={consumptionHistory} onClearHistory={() => setConsumptionHistory([])} />
            </div>
          </details>
        </section>
        <div className="focus-statusline" role="status">
          <Activity size={13} /><span>Buffer {occupancy}/{capacity}</span>
          <span>Blocked {blockedItems.length}</span><span>Delivered {stats.totalDelivered}</span>
          <span className="focus-statusline-end">{isFinishing && !isCompleted ? 'Draining remaining values…' : 'Values delivered in FIFO order'}</span>
        </div>
      </main>
      <EducationalGuideModal isOpen={isGuideOpen} onClose={() => setIsGuideOpen(false)} />
    </div>
  );
}
