/**
 * Kitchen Simulation Service — Actor-based Pizza Bakery Demo
 *
 * Architecture:
 *   • Cashier actor  : receives orders, forwards to chef via actor bus
 *   • Chef actor     : receives orders from cashier, requests recipes and
 *                      oven bakes from main thread, emits lifecycle events
 *   • Oven coroutines: 3 dedicated workers for actual baking
 *
 * Communication flow:
 *   UI → Cashier : main.outbox.send(cashier, { type: 'order' | 'cancel' | 'close' })
 *   Cashier → Chef : utils.bus.send('chef', 'cook' | 'cancel', ...)
 *   Chef → Main    : utils.outbox.request(item)       fetches recipe
 *                    utils.outbox.request({type:'bake'}) dispatches to oven
 *                    utils.outbox.send(event)          pushes live events
 */
import { Injectable } from '@angular/core';
import { createBehaviorSubject, createSubject } from '@epikodelabs/streamix';
import { actor, coroutine, main, WorkerUtils } from '@epikodelabs/streamix/coroutines';

export type Order = { id: string; item: string; customer: string };

export type Recipe = {
  item: string;
  ingredients: string[];
  bakeMs: number;
};

export type KitchenMessage =
  | { type: 'runShift'; orders: Order[] }
  | { type: 'cancel'; orderId: string }
  | { type: 'close' };

export type KitchenEvent =
  | { type: 'started'; order: Order; oven: string }
  | { type: 'stage'; order: Order; stage: string; oven: string }
  | { type: 'ready'; order: Order; oven: string; price: number }
  | { type: 'cancelled'; order: Order; reason: string; oven: string }
  | { type: 'timeout'; order: Order; oven: string }
  | { type: 'closed'; completed: number; cancelled: number; totalRevenue: number };

export type OvenState = {
  id: string;
  order: Order | null;
  stage: string | null;
};

export type KitchenStats = {
  completed: number;
  cancelled: number;
  revenue: number;
  active: number;
};

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const recipes = new Map<string, Recipe>([
  ['Margherita', { item: 'Margherita', ingredients: ['tomato', 'mozzarella', 'basil'], bakeMs: 3000 }],
  ['Pepperoni', { item: 'Pepperoni', ingredients: ['tomato', 'mozzarella', 'pepperoni'], bakeMs: 3500 }],
  ['Hawaiian', { item: 'Hawaiian', ingredients: ['tomato', 'mozzarella', 'ham', 'pineapple'], bakeMs: 3200 }],
  ['Quattro Formaggi', { item: 'Quattro Formaggi', ingredients: ['mozzarella', 'gorgonzola', 'parmesan', 'ricotta'], bakeMs: 2800 }],
  ['Diavola', { item: 'Diavola', ingredients: ['tomato', 'mozzarella', 'spicy salami', 'chili'], bakeMs: 3800 }],
]);

const prices = new Map<string, number>([
  ['Margherita', 12.99],
  ['Pepperoni', 14.99],
  ['Hawaiian', 13.99],
  ['Quattro Formaggi', 15.99],
  ['Diavola', 16.99],
]);

// ===== OVEN COROUTINES =====
async function ovenBakeTask(task: { order: Order; recipe: Recipe }) {
  await new Promise(r => setTimeout(r, task.recipe.bakeMs));
  return task;
}

const ovens = [
  { id: 'Oven #1', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #2', worker: coroutine(ovenBakeTask), busy: false },
  { id: 'Oven #3', worker: coroutine(ovenBakeTask), busy: false },
];

// ===== CHEF ACTOR =====
interface ChefState {
  activeTasks: number;
  completedCount: number;
  cancelledCount: number;
  closing: boolean;
  closedSent: boolean;
  cancelledIds: Set<string>;
}

function checkClosed(state: ChefState, utils: WorkerUtils<any, any, any, KitchenEvent>) {
  if (state.closing && state.activeTasks === 0 && !state.closedSent) {
    state.closedSent = true;
    const revenue = state.completedCount * 10; // simplified
    utils.outbox.send({
      type: 'closed',
      completed: state.completedCount,
      cancelled: state.cancelledCount,
      totalRevenue: revenue,
    } as KitchenEvent);
  }
}

const chef = actor({
  onRequest: async (payload: unknown) => {
    if (typeof payload === 'string') {
      return recipes.get(payload);
    }
    const bakeTask = payload as { type: 'bake'; order: Order; recipe: Recipe };
    if (bakeTask.type === 'bake') {
      const oven = ovens.find(o => !o.busy);
      if (!oven) throw new Error('No free oven');
      oven.busy = true;
      try {
        await oven.worker.processTask({ order: bakeTask.order, recipe: bakeTask.recipe });
        return { ovenId: oven.id, price: prices.get(bakeTask.order.item) ?? 10 };
      } finally {
        oven.busy = false;
      }
    }
    throw new Error(`Unknown request payload: ${JSON.stringify(payload)}`);
  },
})(async function chefBehavior(
  msg: any,
  state: ChefState,
  utils: WorkerUtils<any, any, any, KitchenEvent>
) {
  // Handle bus messages from cashier
  if (msg.kind === 'actor-bus') {
    if (msg.topic === 'cook') {
      const order = msg.payload as Order;
      state.activeTasks++;

      // Fire-and-forget cooking task
      (async () => {
        try {
          if (state.cancelledIds.has(order.id)) {
            state.activeTasks--;
            state.cancelledCount++;
            utils.outbox.send({ type: 'cancelled', order, reason: 'Cancelled before start', oven: 'N/A' } as KitchenEvent);
            checkClosed(state, utils);
            return;
          }

          const recipe = await utils.outbox.request(order.item) as Recipe | undefined;
          if (!recipe) throw new Error(`No recipe for ${order.item}`);

          const bakeResult = await utils.outbox.request({ type: 'bake', order, recipe }) as { ovenId: string; price: number };
          state.activeTasks--;
          state.completedCount++;
          utils.outbox.send({ type: 'ready', order, oven: bakeResult.ovenId, price: bakeResult.price } as KitchenEvent);
          checkClosed(state, utils);
        } catch (err: any) {
          state.activeTasks--;
          state.cancelledCount++;
          utils.outbox.send({ type: 'cancelled', order, reason: err?.message ?? String(err), oven: 'N/A' } as KitchenEvent);
          checkClosed(state, utils);
        }
      })();
    }

    if (msg.topic === 'cancel') {
      state.cancelledIds.add(msg.payload as string);
    }

    if (msg.topic === 'close') {
      state.closing = true;
      checkClosed(state, utils);
    }

    return state;
  }

  return state;
})('chef', {
  activeTasks: 0,
  completedCount: 0,
  cancelledCount: 0,
  closing: false,
  closedSent: false,
  cancelledIds: new Set(),
});

// ===== CASHIER ACTOR =====
const cashier = actor(async function cashierBehavior(
  msg: KitchenMessage,
  state: { closing: boolean },
  utils: WorkerUtils<any, any, any, any>
) {
  if (msg.type === 'runShift') {
    for (const order of msg.orders) {
      utils.bus.send('chef', 'cook', order);
    }
    utils.bus.send('chef', 'close', null);
  }

  if (msg.type === 'cancel') {
    utils.bus.send('chef', 'cancel', msg.orderId);
  }

  if (msg.type === 'close') {
    utils.bus.send('chef', 'close', null);
  }

  return state;
})('cashier', { closing: false });

@Injectable({ providedIn: 'root' })
export class KitchenService {
  private eventsSubject = createSubject<KitchenEvent>();
  events$ = this.eventsSubject;

  private ovensSubject = createBehaviorSubject<OvenState[]>([
    { id: 'Oven #1', order: null, stage: null },
    { id: 'Oven #2', order: null, stage: null },
    { id: 'Oven #3', order: null, stage: null },
  ]);
  ovens$ = this.ovensSubject;

  private cancellableOrdersSubject = createBehaviorSubject<Order[]>([]);
  cancellableOrders$ = this.cancellableOrdersSubject;

  private statsSubject = createBehaviorSubject<KitchenStats>({
    completed: 0,
    cancelled: 0,
    revenue: 0,
    active: 0,
  });
  stats$ = this.statsSubject;

  private logSubject = createSubject<string>();
  log$ = this.logSubject;

  private running = false;
  private fullDayClosing = false;
  private inFullDay = false;
  private onMessageUnsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.onMessageUnsubscribe = main.inbox.listen(chef, (event: KitchenEvent) => {
      this.eventsSubject.next(event);
      this.handleEvent(event);
    });
  }

  private handleEvent(event: KitchenEvent) {
    const ovens = [...this.ovensSubject.value];
    const stats = this.statsSubject.value;
    const time = new Date().toLocaleTimeString();

    const oven = 'oven' in event
      ? ovens.find(entry => entry.id === event.oven)
      : undefined;

    switch (event.type) {
      case 'started':
        if (oven) {
          oven.order = event.order;
          oven.stage = 'Preparing...';
        }
        this.logSubject.next(
          `[${time}] 🍳 Started: ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.statsSubject.next({ ...stats, active: stats.active + 1 });
        break;

      case 'stage':
        if (oven) oven.stage = event.stage;
        this.logSubject.next(
          `[${time}] 📍 ${event.stage} - ${event.order.item} (${event.oven})`
        );
        break;

      case 'ready':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.logSubject.next(
          `[${time}] ✅ READY! ${event.order.item} for ${event.order.customer} (${event.oven})`
        );
        this.statsSubject.next({
          ...stats,
          completed: stats.completed + 1,
          revenue: stats.revenue + event.price,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'cancelled':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.logSubject.next(
          `[${time}] ❌ CANCELLED: ${event.order.item} for ${event.order.customer} - ${event.reason} (${event.oven})`
        );
        this.statsSubject.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: oven ? Math.max(0, stats.active - 1) : stats.active,
        });
        break;

      case 'timeout':
        if (oven) {
          oven.order = null;
          oven.stage = null;
        }
        this.removeCancellableOrder(event.order.id);
        this.logSubject.next(
          `[${time}] ⏰ TIMEOUT: ${event.order.item} got burnt! (${event.oven})`
        );
        this.statsSubject.next({
          ...stats,
          cancelled: stats.cancelled + 1,
          active: Math.max(0, stats.active - 1),
        });
        break;

      case 'closed':
        this.cancellableOrdersSubject.next([]);
        this.logSubject.next(
          `[${time}] 🏁 Shift closed! Completed: ${event.completed}, Cancelled: ${event.cancelled}, Revenue: $${event.totalRevenue.toFixed(2)}`
        );
        this.statsSubject.next({ ...this.statsSubject.value, active: 0 });
        if (!this.inFullDay) {
          this.running = false;
        }
        break;
    }

    this.ovensSubject.next(ovens);
  }

  async runShift(
    orders: Order[],
    options: { accumulate?: boolean; internal?: boolean } = {}
  ): Promise<{ completed: number; cancelled: number; revenue: number } | undefined> {
    if (!options.internal && this.running) return;

    if (!options.internal) {
      this.running = true;
    }

    if (options.accumulate) {
      this.resetOvens();
    } else {
      this.resetState();
    }

    this.cancellableOrdersSubject.next([...orders]);

    this.logSubject.next(`--- Starting shift with ${orders.length} orders ---`);

    return new Promise((resolve) => {
      let resolved = false;

      const unsub = main.inbox.listen(chef, (event: KitchenEvent) => {
        if (event.type === 'closed' && !resolved) {
          resolved = true;
          unsub();
          if (!options.internal) {
            this.running = false;
          }
          resolve({
            completed: event.completed,
            cancelled: event.cancelled,
            revenue: event.totalRevenue,
          });
        }
      });

      main.outbox.send(cashier, { type: 'runShift', orders });
    });
  }

  async runFullDay(): Promise<void> {
    if (this.running) return;

    const shifts = [
      {
        name: '🌅 Morning Shift',
        orders: [
          { id: 'M1', item: 'Margherita', customer: 'John' },
          { id: 'M2', item: 'Pepperoni', customer: 'Sarah' },
          { id: 'M3', item: 'Hawaiian', customer: 'Mike' },
        ],
      },
      {
        name: '🌞 Lunch Rush',
        orders: [
          { id: 'L1', item: 'Quattro Formaggi', customer: 'Emma' },
          { id: 'L2', item: 'Diavola', customer: 'Luca' },
          { id: 'L3', item: 'Margherita', customer: 'Sophia' },
          { id: 'L4', item: 'Pepperoni', customer: 'Oliver' },
        ],
      },
      {
        name: '🌤️ Afternoon',
        orders: [
          { id: 'A1', item: 'Hawaiian', customer: 'Isabella' },
          { id: 'A2', item: 'Diavola', customer: 'Ethan' },
        ],
      },
      {
        name: '🌙 Evening Rush',
        orders: [
          { id: 'E1', item: 'Diavola', customer: 'Marco' },
          { id: 'E2', item: 'Quattro Formaggi', customer: 'Giulia' },
          { id: 'E3', item: 'Pepperoni', customer: 'Antonio' },
          { id: 'E4', item: 'Margherita', customer: 'Francesca' },
          { id: 'E5', item: 'Hawaiian', customer: 'Roberto' },
        ],
      },
    ];

    this.fullDayClosing = false;
    this.inFullDay = true;
    this.running = true;
    this.resetState();

    this.logSubject.next('\n=== Full Day Started ===');

    for (const shift of shifts) {
      if (this.fullDayClosing) break;

      this.logSubject.next(`\n=== ${shift.name} ===`);

      await this.runShift(shift.orders, { accumulate: true, internal: true });

      if (this.fullDayClosing) break;

      await delay(1000);
    }

    this.cancellableOrdersSubject.next([]);

    this.logSubject.next('\n=== Full Day Complete ===');

    this.inFullDay = false;
    this.running = false;

    const stats = this.statsSubject.value;

    this.logSubject.next(
      `📊 FULL DAY SUMMARY: ✅ ${stats.completed} completed, ❌ ${stats.cancelled} cancelled, 💰 $${stats.revenue.toFixed(2)}`
    );
  }

  cancelOrder(orderId: string) {
    if (!this.running) return;

    main.outbox.send(cashier, { type: 'cancel', orderId });
    this.logSubject.next(`🚫 Cancellation requested for order ${orderId}`);
  }

  closeKitchen() {
    if (!this.running) return;

    this.fullDayClosing = true;
    main.outbox.send(cashier, { type: 'close' });
    this.logSubject.next('🚨 Kitchen closing requested — active ovens finish, queued orders are cancelled');
  }

  resetOvens() {
    this.ovensSubject.next([
      { id: 'Oven #1', order: null, stage: null },
      { id: 'Oven #2', order: null, stage: null },
      { id: 'Oven #3', order: null, stage: null },
    ]);
  }

  resetState() {
    this.resetOvens();
    this.cancellableOrdersSubject.next([]);
    this.statsSubject.next({
      completed: 0,
      cancelled: 0,
      revenue: 0,
      active: 0,
    });
  }

  private removeCancellableOrder(orderId: string) {
    this.cancellableOrdersSubject.next(
      this.cancellableOrdersSubject.value.filter(order => order.id !== orderId)
    );
  }

  async destroy() {
    if (this.destroyed) return;

    this.destroyed = true;
    this.onMessageUnsubscribe?.();
    this.onMessageUnsubscribe = null;

    await Promise.all([
      main.outbox.stop(cashier),
      main.outbox.stop(chef),
      ...ovens.map(o => o.worker.finalize()),
    ]);
  }

  isRunning() {
    return this.running;
  }

  isDestroyed() {
    return this.destroyed;
  }
}
