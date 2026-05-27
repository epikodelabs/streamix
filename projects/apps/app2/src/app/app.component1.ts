import { Component, OnInit, OnDestroy } from '@angular/core';
import { actor, ActorBusMessage, main, WorkerUtils } from '@epikodelabs/streamix/coroutines';

type TimerMessage =
  | { type: 'start'; initialTime: number }
  | { type: 'reset'; initialTime: number }
  | { type: 'stop' };

type TimerState = {
  counter: number;
  timerId: ReturnType<typeof setInterval> | null;
};

async function timerBehavior(
  msg: any,
  state: TimerState,
  utils: WorkerUtils<any, any, TimerMessage, any>
) {
  if (msg.kind === 'actor-bus' && (msg.topic === 'start' || msg.topic === 'reset')) {
    const payload = msg.payload as { initialTime: number };
    if (state.timerId !== null) {
      clearInterval(state.timerId);
    }

    state.counter = payload.initialTime;
    state.timerId = setInterval(() => {
      state.counter--;
      utils.outbox.send('main', 'tick', { tick: state.counter, timestamp: Date.now() });
      if (state.counter <= 0 && state.timerId !== null) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
    }, 1000);

    // Emit the initial tick immediately
    utils.outbox.send('main', 'tick', { tick: state.counter, timestamp: Date.now() });
  }

  if (msg.kind === 'actor-bus' && msg.topic === 'stop') {
    if (state.timerId !== null) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  return state;
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Timer App with Actor';
  timerValue: number = 0;
  timerStatus: string = 'Stopped';

  private timerActor = actor('timer', timerBehavior, {
    counter: 0,
    timerId: null,
  });

  private unsubscribeMessage!: () => void;

  ngOnInit(): void {
    this.unsubscribeMessage = main.inbox.subscribe('main', (message: ActorBusMessage<any>) => {
      if (message.topic !== 'tick') {
        return;
      }

      const msg = message.payload as { tick: number; timestamp: number };
      this.timerValue = msg.tick;
      console.log('Counting down...', msg.tick);
    });

    this.timerStatus = 'Running';
    console.log('Starting timer...');
    main.outbox.send(this.timerActor, 'start', { initialTime: 60 });
  }

  resetTimer() {
    console.log('Resetting...');
    this.timerStatus = 'Resetting';
    main.outbox.send(this.timerActor, 'reset', { initialTime: 30 });
    this.timerStatus = 'Running';
  }

  ngOnDestroy(): void {
    this.unsubscribeMessage?.();
    main.outbox.stop(this.timerActor);
  }
}
