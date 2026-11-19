import { virtualRootOf, virtualTsconfigOf } from './options';

interface ArchitectTarget {
  builder?: string;
}

interface WorkspaceProject {
  architect?: Record<string, ArchitectTarget>;
}

describe('documentation contracts', () => {
  it('keeps the README virtual paths in sync with virtualRootOf', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');

    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');

    const sourceRootMatch = readme.match(/"sourceRoot":\s*"([^"]+)"/);
    expect(sourceRootMatch).not.toBeNull();
    const sourceRoot = sourceRootMatch![1];

    // Every generated path the README mentions must live under the virtual
    // root that the builder actually derives from the example source root.
    const virtualRoot = virtualRootOf(sourceRoot);
    const prefix = virtualRoot.replace(/\/src$/, '');

    const streamixPaths = [
      ...readme.matchAll(/\.angular\/\.streamix\/[^\s"'`,]+/g),
    ].map(match => match[0]);
    expect(streamixPaths.length).toBeGreaterThan(0);

    for (const found of streamixPaths) {
      expect(found.startsWith(prefix)).toBeTrue();
    }

    const tsConfigMatch = readme.match(
      /"tsConfig":\s*"(\.angular\/\.streamix\/[^"]+)"/,
    );
    expect(tsConfigMatch).not.toBeNull();
    expect(tsConfigMatch![1]).toBe(virtualTsconfigOf(sourceRoot));
  });

  it('states the TypeScript floor of the package peer dependency', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');

    const readme = await readFile(resolve(process.cwd(), 'README.md'), 'utf8');
    const manifest = JSON.parse(
      await readFile(
        resolve(process.cwd(), 'projects/libraries/streamix/package.json'),
        'utf8',
      ),
    ) as { peerDependencies: { typescript: string } };

    const floor = manifest.peerDependencies.typescript.match(/\d+\.\d+\.\d+/);
    expect(floor).not.toBeNull();

    expect(readme).toContain(`TypeScript ${floor![0]}+`);
    // The stale 5.5 floor contradicted the peer dependency.
    expect(readme).not.toMatch(/TypeScript 5\.5/);
  });

  it('references an application that actually wires the streamix Angular builder', async () => {
    const { readFile } = await import('node:fs/promises');
    const { resolve } = await import('node:path');

    const builderReadme = await readFile(
      resolve(
        process.cwd(),
        'projects/libraries/streamix/angular/builder/README.md',
      ),
      'utf8',
    );

    const nameMatch = builderReadme.match(
      /`([A-Za-z0-9_-]+)` in the workspace `angular\.json`/,
    );
    expect(nameMatch).not.toBeNull();
    const referencedApp = nameMatch![1];

    const workspace = JSON.parse(
      await readFile(resolve(process.cwd(), 'angular.json'), 'utf8'),
    ) as { projects: Record<string, WorkspaceProject> };

    const project = workspace.projects[referencedApp];
    expect(project).toBeDefined();

    const targets = Object.values(project.architect ?? {});
    expect(
      targets.some(target =>
        target.builder?.startsWith('@epikodelabs/streamix/angular/builder:'),
      ),
    ).toBeTrue();
  });
});
