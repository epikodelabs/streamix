import { Component, OnInit, OnDestroy } from '@angular/core';
import { actor, WorkerUtils } from '@epikodelabs/streamix/coroutines';

// --- Worker Function that runs the timer logic ---
// This is a single, stateful function designed to run in a web worker.

/**
 * A main task function that runs a countdown timer inside a Web Worker.
 * It uses WorkerUtils to send messages to the main thread.
 */
async function createTimerWorker(
  data: { initialTime: number; type: 'start' | 'reset' },
  utils: WorkerUtils
): Promise<number> {
  // Validate input
  if (typeof data.initialTime !== 'number' || isNaN(data.initialTime) || data.initialTime < 0) {
    throw new Error(`Invalid initialTime: ${data.initialTime}`);
  }

  // Initialize counter
  let counter = data.initialTime;

  // Send initial counter value
  utils.main.send({ tick: counter, timestamp: Date.now() });

  // Return a promise that resolves when the timer completes
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      counter--;

      // Send periodic update
      utils.main.send({ tick: counter, timestamp: Date.now() });

      if (counter <= 0) {
        clearInterval(timer);
        resolve(counter); // Resolve with final counter value
      }
    }, 1000);
  });
}

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Timer App with Coroutine';
  timerValue: number = 0;
  timerStatus: string = 'Stopped';
  private timerTask = actor(createTimerWorker);
  private unsubscribeMessage!: () => void;

  ngOnInit(): void {
    // Subscribe to worker messages (ticks)
    this.unsubscribeMessage = this.timerTask.onMessage((msg) => {
      this.timerValue = msg.tick;
      console.log('Counting down...');
    });

    // Start the timer
    this.timerStatus = 'Running';
    console.log('Starting timer...');
    this.timerTask.processTask({ initialTime: 60, type: 'start' })
      .then(() => {
        console.log('Completed');
        this.timerStatus = 'Stopped';
      })
      .catch((error) => {
        console.error('Worker error:', error);
        this.timerStatus = 'Error';
      });
  }

  // Method to reset the timer from the UI
  resetTimer() {
    console.log('Resetting...');
    this.timerStatus = 'Resetting';
    // Send a new task to reset the timer to 30 seconds
    this.timerTask.processTask({ type: 'reset', initialTime: 30 })
      .then(() => {
        this.timerStatus = 'Running';
      })
      .catch((error) => {
        console.error('Worker error:', error);
        this.timerStatus = 'Error';
      });
  }

  // Clean up on component destruction
  ngOnDestroy(): void {
    this.unsubscribeMessage?.();
    this.timerTask.finalize();
  }
}
