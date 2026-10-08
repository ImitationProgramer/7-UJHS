import { LocationSchema } from '@guidesense/protocol';

export function parseNativeLocation(position: {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  timestamp: number;
}) {
  return LocationSchema.safeParse({
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    // CoreLocation supplies fractional milliseconds. Our wire format uses integer ms.
    // Preserve the native fix time; do not replace it with the current time.
    timestamp: Math.trunc(position.timestamp),
  });
}
