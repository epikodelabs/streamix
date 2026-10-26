import { createBuilder, type BuilderOutput } from '@angular-devkit/architect';
import { Observable } from 'rxjs';
import { isAbsolute, join, relative, resolve, win32 } from 'node:path';
import { build, createServer, loadConfigFromFile, type InlineConfig, type ViteDevServer } from 'vite';
import vue from '@vitejs/plugin-vue';

/**
 * Vite build and dev-server target for the generated Vue project. The Streamix
 * application builder has already mirrored and transformed the authored tree,
 * so this builder only owns what Vite owns: SFC compilation, bundling, and
 * (for the dev-server target) the development server with HMR.
 *
 * An authored `vite.config.ts` beside the entry is loaded first — a native Vue
 * app keeps its own plugin stack there — and this builder overlays the paths
 * the Angular workspace controls: the virtual root, the build output, and the
 * dev-server port. When no config supplies Vue's SFC plugin, it is injected.
 */
export const viteBuilder = createBuilder((options, context) => new Observable<BuilderOutput>((subscriber) => {
  let server: ViteDevServer | undefined;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (server) {
      try { await server.close(); } catch { /* server already stopped */ }
      server = undefined;
    }
  };

  void (async () => {
    const root = String(options['root'] ?? '');
    const serve = options['serve'] === true;
    const outputPath = String(options['outputPath'] ?? '');
    const port = Number(options['port'] ?? 4200);
    const viteConfig = String(options['viteConfig'] ?? 'vite.config.ts');
    const sourceMap = options['sourceMap'] === true ? true : undefined;

    if (!root) {
      subscriber.error(new Error('Streamix Vue Vite builder requires a workspace-relative root.'));
      return;
    }
    const parts = root.replace(/\\/g, '/').split('/');
    if (isAbsolute(root) || win32.isAbsolute(root) ||
        parts.some(part => part === '..' || part === '.') || !parts.some(Boolean)) {
      subscriber.error(new Error('Streamix Vue Vite builder root must be a workspace-relative directory.'));
      return;
    }
    if (!serve && !outputPath) {
      subscriber.error(new Error('Streamix Vue Vite builder requires outputPath for build targets.'));
      return;
    }

    try {
      const rootPath = resolve(context.workspaceRoot, root);
      const relativeRoot = relative(context.workspaceRoot, rootPath);
      if (!relativeRoot || relativeRoot.startsWith('..') || isAbsolute(relativeRoot)) {
        subscriber.error(new Error('Streamix Vue Vite builder root must identify a directory inside the workspace.'));
        return;
      }
      // Architect passes the target's configuration name (production/development)
      // when it is explicit; an unspecified configuration falls back to the
      // target's default, which the delegation does not materialize here. The
      // dev-server target defaults to development, the build target to
      // production — mirror that so import.meta.env.DEV keeps its meaning.
      const requested = context.target?.configuration;
      const mode = requested === 'production' ? 'production'
        : requested === 'development' ? 'development'
        : serve ? 'development' : 'production';
      const command = serve ? 'serve' : 'build';
      const loaded = await loadConfigFromFile({ command, mode }, join(rootPath, viteConfig));
      const authored = loaded?.config ?? {};
      // The authored config was already loaded and merged above. Without this,
      // Vite would load vite.config.ts from the root a second time and run its
      // plugin list twice: a duplicated SFC plugin re-parses its own emitted
      // script modules as components and fails.
      const config: InlineConfig = {
        ...authored,
        configFile: false,
        // The library gates devtools on import.meta.env?.DEV; Vite leaves the
        // optional-chain form untouched, so the flag must be defined here
        // (the plain key replaces both forms), mirroring the other builders.
        define: {
          ...(authored.define ?? {}),
          'import.meta.env.DEV': mode === 'development' ? 'true' : 'false',
        },
        root: rootPath,
        ...(serve
          ? { server: { ...(authored.server ?? {}), port } }
          : {
              build: {
                ...(authored.build ?? {}),
                outDir: resolve(context.workspaceRoot, outputPath),
                ...(sourceMap === undefined ? {} : { sourceMap }),
              },
            }),
      };
      const plugins = Array.isArray(config.plugins) ? config.plugins : [];
      const hasVuePlugin = plugins.some(plugin => {
        if (!plugin) return false;
        const candidate: { name?: unknown } = Array.isArray(plugin) ? plugin[0] as { name?: unknown } : plugin as { name?: unknown };
        return candidate?.name === 'vite:vue';
      });
      if (!hasVuePlugin) config.plugins = [...plugins, vue()];

      if (serve) {
        server = await createServer(config);
        await server.listen(port);
        context.logger.info(`Vite dev server running for ${relativeRoot}`);
        server.printUrls();
        return;
      }
      context.logger.info(`Building ${relativeRoot} with Vite (${mode})`);
      await build(config);
      context.logger.info('Vite build complete.');
      subscriber.next({ success: true });
      subscriber.complete();
    } catch (error) {
      subscriber.error(error instanceof Error ? error : new Error(String(error)));
    }
  })();

  return () => {
    void close();
  };
}));
