# Type Alias: SubjectBuffer\<T\>

> **SubjectBuffer**\<`T`\> = [`CyclicBuffer`](CyclicBuffer.md)\<`T`\> & `object`

Defined in: [primitives/buffer.ts:44](https://github.com/actioncrew/streamix/blob/main/projects/libraries/streamix/src/lib/primitives/buffer.ts#L44)

Extends CyclicBuffer for "Subject" behavior, providing access to the current value.

## Type declaration

### value

#### Get Signature

> **get** **value**(): `undefined` \| `T`

Gets the latest non-error value written to the buffer, or undefined.

##### Returns

`undefined` \| `T`

## Type Parameters

### T

`T` = `any`
