# Type Alias: RecurseOptions

> **RecurseOptions** = `object`

Defined in: [operators/recurse.ts:7](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/recurse.ts#L7)

Options to configure the recursive traversal behavior.

## Properties

### traversal?

> `optional` **traversal**: `"depth"` \| `"breadth"`

Defined in: [operators/recurse.ts:14](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/recurse.ts#L14)

The traversal strategy to use.
- `'depth'`: Processes deeper values first (LIFO queue).
- `'breadth'`: Processes values level by level (FIFO queue).
Defaults to depth-first.

***

### maxDepth?

> `optional` **maxDepth**: `number`

Defined in: [operators/recurse.ts:19](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/operators/recurse.ts#L19)

The maximum depth to traverse. Prevents infinite recursion and limits the size
of the traversal. Defaults to no limit.
