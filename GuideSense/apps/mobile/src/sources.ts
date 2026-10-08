import { Accelerometer, Gyroscope } from 'expo-sensors';
import * as Location from 'expo-location';
import { parseNativeLocation } from './location';
import type { Sources } from './stream';

export const sources: Sources = {
  accelerometer: Accelerometer,
  gyroscope: Gyroscope,
  location: {
    requestPermission: async () =>
      (await Location.requestForegroundPermissionsAsync()).granted,
    servicesEnabled: () => Location.hasServicesEnabledAsync(),
    watch: (onValue, onError) =>
      Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 0,
          timeInterval: 1000,
        },
        (position) => {
          const result = parseNativeLocation(position);
          if (result.success) onValue(result.data);
          else onError();
        },
        onError,
      ),
  },
  socket: (url) => new WebSocket(url),
};
