import { bootstrapApplication } from '@angular/platform-browser';
import { interval, take, tap } from '@epikodelabs/streamix';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// Load and exercise Streamix from the application entry point.
interval(1000)
  .pipe(
    take(1),
    tap(() => console.log('Streamix loaded through main.ts'))
  )
  .subscribe();

bootstrapApplication(AppComponent, appConfig)
  .catch((err) => console.error(err));
