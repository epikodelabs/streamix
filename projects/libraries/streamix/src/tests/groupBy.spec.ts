import { from, groupBy, iterate, map, merge, mergeMap, pipe, tap, type Operator } from '@epikodelabs/streamix';

describe('groupBy', () => {
  it('should partition values using groupBy and sort them by key', async () => {
    const groupsMap = new Map<string, any[]>();

    const grouped = pipe(
      from([1, 2, 3, 4, 5, 6]),
      groupBy((value: number) => (value % 2 === 0 ? 'even' : 'odd'))
    );

    for await (const groupItem of iterate(grouped)) {
      const groupValues = groupsMap.get(groupItem.key) || [];
      groupValues.push(groupItem.value);
      groupsMap.set(groupItem.key, groupValues);
    }

    // Ensure 'odd' group comes first
    const sortedGroups = ['odd', 'even'].flatMap((key) => groupsMap.get(key) ?? []);

    expect(sortedGroups).toEqual([1, 3, 5, 2, 4, 6]); // Odd numbers first, then even
  });

  it('should apply custom operators for each partition and collect results', async () => {
    const customOperator = map((value: any) => `Processed ${value}`);

    const paths: any = {
      low: [customOperator],
      high: [customOperator]
    };

    // Partitioned streams
    const lowPartition = pipe(from([1, 2, 3]), map((value) => `Low: ${value}`));
    const highPartition = pipe(from([10, 20, 30]), map((value) => `High: ${value}`));

    const partitionedStreams = [lowPartition, highPartition];
    const groupsMap = new Map<string, any[]>();

    // Use mergeMap to combine all partitioned streams into one observable
    const source$ = pipe(
      merge(...partitionedStreams),
      groupBy((value: string) => value.startsWith('Low') ? 'low' : 'high'),
      mergeMap((groupItem: { key: string, value: string }) => {
        const key = groupItem.key;
        const operators = paths[key] || [];

        return iterate(
          pipe(
            from([groupItem.value]),
            ...(operators as [Operator, ...Operator[]]),
            tap((value: any) => {
              const groupValues = groupsMap.get(key) || [];
              groupValues.push(value);
              groupsMap.set(key, groupValues);
            })
          )
        ) as any;
      })
    );

    for await (const _ of iterate(source$)) {
      // values are collected via tap
    }

    const sortedGroups = Array.from(groupsMap.entries()).sort(([keyA]) => {
      return keyA === 'low' ? -1 : 1; // Sort 'low' before 'high'
    });

    const result = sortedGroups.flatMap(([_, group]) => group);

    // Expect processed values with the custom operator applied
    expect(result).toEqual([
      'Processed Low: 1', 'Processed Low: 2', 'Processed Low: 3',
      'Processed High: 10', 'Processed High: 20', 'Processed High: 30',
    ]);
  });

  it('should handle partitioning and splitting with custom operators together', async () => {
    // Partition and split values into "low" and "high" ranges
    const paths: any = {
      low: [map((value: number) => (value <= 5 ? 'low' : 'high'))],
      high: [map((value: number) => (value > 5 ? 'high' : 'low'))]
    };

    const groupsMap = new Map<string, any[]>();

    // Create partitioned stream and apply operators
    const source$ = pipe(
      from([1, 3, 5, 7, 10]),
      groupBy((value: number) => (value <= 5 ? 'low' : 'high')),
      mergeMap((groupItem: { key: string, value: number }) => {
        const key = groupItem.key;
        const operators = paths[key] || [];

        return iterate(
          pipe(
            from([groupItem.value]),
            ...(operators as [Operator, ...Operator[]]),
            tap((value: any) => {
              const groupValues = groupsMap.get(key) || [];
              groupValues.push(value);
              groupsMap.set(key, groupValues);
            })
          )
        ) as any;
      })
    );

    for await (const _ of iterate(source$)) {
      // values are collected via tap
    }

    const sortedGroups = Array.from(groupsMap.entries()).sort(([keyA]) => {
      return keyA === 'low' ? -1 : 1; // Sort 'low' before 'high'
    });

    const result = sortedGroups.flatMap(([_, group]) => group);

    // Expect processed values with the custom operator applied
    expect(result).toEqual(['low', 'low', 'low', 'high', 'high']);
  });

  it('should support async key selectors', async () => {
    const results: Array<{ key: string; value: number }> = [];

    const asyncKeySelector = async (value: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return value % 2 === 0 ? 'even' : 'odd';
    };

    for await (const groupItem of iterate(pipe(from([1, 2, 3, 4]), groupBy(asyncKeySelector)))) {
      results.push(groupItem);
    }

    expect(results.map((item) => item.key)).toEqual(['odd', 'even', 'odd', 'even']);
    expect(results.map((item) => item.value)).toEqual([1, 2, 3, 4]);
  });
});
