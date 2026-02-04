import { bootstrapApplication } from '@angular/platform-browser';

import { installTracingHooks } from '@epikodelabs/streamix/tracing';
import { TracingVisualizerComponent } from './app/app.component';
import { appConfig } from './app/app.config';

installTracingHooks();

bootstrapApplication(TracingVisualizerComponent, appConfig)
  .catch((err) => console.error('Failed to bootstrap tracing visualizer', err));
