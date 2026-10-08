import { expect, it } from 'vitest';
import { parseNativeLocation } from '../apps/mobile/src/location';

it('accepts native iOS fractional milliseconds without changing the fix time or coordinates', () => {
  const result = parseNativeLocation({
    coords: { latitude: 37.12, longitude: 127.34, accuracy: 4.5 },
    timestamp: 1791386000000.123,
  });
  expect(result.success).toBe(true);
  if (result.success)
    expect(result.data).toEqual({
      latitude: 37.12,
      longitude: 127.34,
      accuracy: 4.5,
      timestamp: 1791386000000,
    });
});

it('keeps unknown accuracy null and rejects invalid native fixes', () => {
  const position = {
    coords: { latitude: 37, longitude: 127, accuracy: null },
    timestamp: 1791386000000.9,
  };
  expect(parseNativeLocation(position).data?.accuracy).toBeNull();
  expect(parseNativeLocation({ ...position, timestamp: NaN }).success).toBe(
    false,
  );
  expect(
    parseNativeLocation({
      ...position,
      coords: { ...position.coords, latitude: 91 },
    }).success,
  ).toBe(false);
  expect(
    parseNativeLocation({
      ...position,
      coords: { ...position.coords, accuracy: -1 },
    }).success,
  ).toBe(false);
});
