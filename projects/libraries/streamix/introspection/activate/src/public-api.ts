/**
 * This secondary entry is evaluated before the application entry's static
 * imports. It arms the browser inspector without relying on a body statement.
 */
import { enableStreamixIntrospection } from '@epikodelabs/streamix/introspection';

enableStreamixIntrospection();
