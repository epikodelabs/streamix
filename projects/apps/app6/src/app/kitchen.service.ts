import { Injectable } from '@angular/core';
import { createBehaviorSubject, createSubject } from '@epikodelabs/streamix';
import { actor, WorkerUtils } from '@epikodelabs/streamix/coroutines';

export type Order = { id: string; item: string; customer: string };

export type Recipe = {
  item: string;
  ingredients: string[];
  bakeMs: number;
};

export type KitchenCommand =
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

const headChef = actor<string, Recipe, KitchenEvent, KitchenCommand>({
  onRequest: async (item: string): Promise<Recipe> => {
    await delay(500);

    const recipe = recipes.get(item);

    if (!recipe) {
      throw new Error(`No recipe for ${item}`);
    }

    return recipe;
  },
})(
  async function kitchenShift(
    input: { orders: Order[] },
    utils: WorkerUtils<string, Recipe, KitchenCommand, KitchenEvent>
  ) {
    const { channel, background, withTimeout } = utils.concurrency;

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const prices = new Map<string, number>([
      ['Margherita', 12.99],
      ['Pepperoni', 14.99],
      ['Hawaiian', 13.99],
      ['Quattro Formaggi', 15.99],
      ['Diavola', 16.99],
    ]);

    const orders = channel<Order>(input.orders.length);

    const completed: Order[] = [];
    const cancelled: Order[] = [];

    const pendingOrders = new Map<string, Order>();
    const startedOrders = new Set<string>();
    const cancelledIds = new Set<string>();

    let totalRevenue = 0;
    let closing = false;
    let listening = true;

    for (const order of input.orders) {
      pendingOrders.set(order.id, order);
      orders.trySend(order);
    }

    orders.close();

    const commandLoop = async () => {
      while (listening) {
        const [ctx, cancel] = withTimeout(background(), 100);

        try {
          const cmd = await utils.main.receive(ctx.signal);

          if (!cmd) continue;

          if (cmd.type === 'close') {
            closing = true;
          }

          if (cmd.type === 'cancel') {
            cancelledIds.add(cmd.orderId);
          }
        } catch {
          // Timeout tick. This keeps the command loop responsive.
        } finally {
          cancel();
        }
      }
    };

    const waitStage = async (
      order: Order,
      duration: number
    ): Promise<'done' | 'cancelled'> => {
      const end = Date.now() + duration;

      while (Date.now() < end) {
        if (cancelledIds.has(order.id)) {
          return 'cancelled';
        }

        await sleep(Math.min(100, end - Date.now()));
      }

      return cancelledIds.has(order.id) ? 'cancelled' : 'done';
    };

    const cook = async (order: Order, ovenId: string): Promise<boolean> => {
      pendingOrders.delete(order.id);
      startedOrders.add(order.id);

      if (cancelledIds.has(order.id)) {
        utils.main.send({
          type: 'cancelled',
          order,
          reason: 'Customer changed mind',
          oven: ovenId,
        });

        return false;
      }

      const recipe = await utils.main.request(order.item);

      utils.main.send({
        type: 'started',
        order,
        oven: ovenId,
      });

      const stages = [
        { name: '🥣 Preparing dough', duration: recipe.bakeMs / 3 },
        { name: '🔥 Baking in oven', duration: recipe.bakeMs / 3 },
        { name: '✨ Finishing touches', duration: recipe.bakeMs / 3 },
      ];

      for (const stage of stages) {
        utils.main.send({
          type: 'stage',
          order,
          stage: stage.name,
          oven: ovenId,
        });

        const result = await waitStage(order, stage.duration);

        if (result === 'cancelled') {
          utils.main.send({
            type: 'cancelled',
            order,
            reason: 'Customer changed mind',
            oven: ovenId,
          });

          return false;
        }
      }

      const price = prices.get(order.item) ?? 10;

      totalRevenue += price;

      utils.main.send({
        type: 'ready',
        order,
        oven: ovenId,
        price,
      });

      return true;
    };

    const ovenWorker = async (ovenId: string) => {
      while (!closing) {
        const order = await orders.receive();

        if (!order) {
          return;
        }

        if (closing) {
          pendingOrders.set(order.id, order);
          return;
        }

        const success = await cook(order, ovenId);

        if (success) {
          completed.push(order);
        } else {
          cancelled.push(order);
        }
      }
    };

    const commands = commandLoop();

    await Promise.all([
      ovenWorker('Oven #1'),
      ovenWorker('Oven #2'),
      ovenWorker('Oven #3'),
    ]);

    if (closing) {
      for (const order of pendingOrders.values()) {
        if (!startedOrders.has(order.id)) {
          cancelled.push(order);

          utils.main.send({
            type: 'cancelled',
            order,
            reason: 'Kitchen closed before order started',
            oven: 'Queue',
          });
        }
      }

      pendingOrders.clear();
    }

    listening = false;
    await commands.catch(() => undefined);

    utils.main.send({
      type: 'closed',
      completed: completed.length,
      cancelled: cancelled.length,
      totalRevenue,
    });

    return {
      completed,
      cancelled,
      totalRevenue,
    };
  }
);

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

  private currentWorker: Worker | null = null;
  private running = false;
  private fullDayClosing = false;
  private onMessageUnsubscribe: (() => void) | null = null;
  private destroyed = false;

  constructor() {
    this.onMessageUnsubscribe = headChef.onMessage((event: KitchenEvent) => {
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

        this.statsSubject.next({
          ...stats,
          active: stats.active + 1,
        });

        break;

      case 'stage':
        if (oven) {
          oven.stage = event.stage;
        }

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

        this.statsSubject.next({
          ...this.statsSubject.value,
          active: 0,
        });

        this.running = false;

        break;
    }

    this.ovensSubject.next(ovens);
  }

  async runShift(
    orders: Order[],
    options: { accumulate?: boolean } = {}
  ): Promise<{ completed: number; cancelled: number; revenue: number } | undefined> {
    if (this.running) return;

    this.running = true;

    if (options.accumulate) {
      this.resetOvens();
    } else {
      this.resetState();
    }

    this.cancellableOrdersSubject.next([...orders]);

    this.logSubject.next(`--- Starting shift with ${orders.length} orders ---`);

    this.currentWorker = await headChef.pool.getIdleWorker();

    try {
      const result = await headChef.pool.assignTask(this.currentWorker, { orders });

      return {
        completed: result?.completed?.length ?? 0,
        cancelled: result?.cancelled?.length ?? 0,
        revenue: result?.totalRevenue ?? 0,
      };
    } finally {
      if (this.currentWorker) {
        headChef.pool.returnWorker(this.currentWorker);
        this.currentWorker = null;
      }

      this.running = false;
    }
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
    this.resetState();

    this.logSubject.next('\n=== Full Day Started ===');

    for (const shift of shifts) {
      if (this.fullDayClosing) {
        break;
      }

      this.logSubject.next(`\n=== ${shift.name} ===`);

      await this.runShift(shift.orders, { accumulate: true });

      if (this.fullDayClosing) {
        break;
      }

      await delay(1000);
    }

    this.cancellableOrdersSubject.next([]);

    this.logSubject.next('\n=== Full Day Complete ===');

    const stats = this.statsSubject.value;

    this.logSubject.next(
      `📊 FULL DAY SUMMARY: ✅ ${stats.completed} completed, ❌ ${stats.cancelled} cancelled, 💰 $${stats.revenue.toFixed(2)}`
    );
  }

  cancelOrder(orderId: string) {
    if (!this.currentWorker || !this.running) return;

    headChef.sendToWorker(this.currentWorker, {
      type: 'cancel',
      orderId,
    });

    this.logSubject.next(`🚫 Cancellation requested for order ${orderId}`);
  }

  closeKitchen() {
    if (!this.running) return;

    this.fullDayClosing = true;

    if (this.currentWorker) {
      headChef.sendToWorker(this.currentWorker, { type: 'close' });
    }

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

    if (this.currentWorker) {
      headChef.pool.returnWorker(this.currentWorker);
      this.currentWorker = null;
    }

    await headChef.finalize();
  }

  isRunning() {
    return this.running;
  }

  isDestroyed() {
    return this.destroyed;
  }
}