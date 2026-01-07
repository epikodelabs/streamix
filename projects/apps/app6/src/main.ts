import { bootstrapApplication } from '@angular/platform-browser';

import { appConfig } from './app/app.config';
import { TracingVisualizerComponent } from './app/app.component';

bootstrapApplication(TracingVisualizerComponent, appConfig)
  .catch((err) => console.error('Failed to bootstrap tracing visualizer', err));
