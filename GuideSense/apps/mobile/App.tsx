import { useEffect, useRef, useState } from 'react';
import {
  AppState,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import {
  colors,
  radius,
  emptyFrame,
  statusLabels,
  type MotionReading,
} from '@guidesense/protocol';
import { SensorStream, type StreamView } from './src/stream';
import { sources } from './src/sources';

function MotionValue({
  name,
  value,
  status,
}: {
  name: string;
  value: MotionReading | null;
  status: string;
}) {
  return (
    <View style={styles.panel}>
      <Text style={styles.section}>{name}</Text>
      <Text style={styles.muted}>{status}</Text>
      <Text style={styles.value}>
        {value
          ? `X ${value.x.toFixed(3)}  Y ${value.y.toFixed(3)}  Z ${value.z.toFixed(3)}`
          : 'X —   Y —   Z —'}
      </Text>
    </View>
  );
}

function SensorScreen() {
  const [address, setAddress] = useState(
    process.env.EXPO_PUBLIC_BACKEND_URL ?? '',
  );
  const [ready, setReady] = useState(false);
  const [view, setView] = useState<StreamView>({
    connection: 'stopped',
    detail: '기기 초기화 중…',
    frame: emptyFrame('initializing', 'stopped'),
  });
  const controller = useRef<SensorStream | null>(null);
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        let deviceId = await AsyncStorage.getItem('guidesense-device-id');
        if (!deviceId) {
          deviceId = Crypto.randomUUID();
          await AsyncStorage.setItem('guidesense-device-id', deviceId);
        }
        const savedAddress = await AsyncStorage.getItem('guidesense-backend');
        if (!mounted) return;
        if (savedAddress) setAddress(savedAddress);
        controller.current = new SensorStream(deviceId, sources, (value) => {
          if (mounted) setView(value);
        });
        controller.current.stop(
          'Start Streaming을 눌러 센서 권한을 확인하세요.',
        );
        setReady(true);
      } catch {
        if (mounted)
          setView((previous) => ({
            ...previous,
            detail: '기기 ID를 저장하지 못했습니다. 앱을 다시 실행하세요.',
          }));
      }
    })();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'background')
        controller.current?.stop(
          '앱이 백그라운드로 이동하여 중지되었습니다. 다시 시작하세요.',
        );
    });
    return () => {
      mounted = false;
      listener.remove();
      controller.current?.stop();
    };
  }, []);
  const busy = ['preparing', 'connecting', 'streaming'].includes(
    view.connection,
  );
  const frame = view.frame;
  const start = () => {
    if (!controller.current || busy) return;
    void AsyncStorage.setItem('guidesense-backend', address).catch(() => {});
    void controller.current.start(address);
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={styles.eyebrow}>GUIDESENSE / SENSOR DEVICE</Text>
        <Text style={styles.title}>센서 스트리밍</Text>
        <Text style={styles.muted}>
          iPhone → Mac · 앱을 화면에 열어 두세요.
        </Text>
        <View style={styles.panel}>
          <Text nativeID="backend-label" style={styles.section}>
            Backend 주소
          </Text>
          <TextInput
            accessibilityLabel="Backend 주소"
            style={styles.input}
            value={address}
            onChangeText={setAddress}
            editable={!busy && ready}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="http://192.168.1.100:8000"
            placeholderTextColor={colors.muted}
          />
          <Text style={styles.muted}>
            Mac과 같은 Wi-Fi에 연결하고 Mac의 IP를 입력하세요.
          </Text>
        </View>
        <View style={styles.panel}>
          <Text style={styles.section}>Connection status</Text>
          <Text
            accessibilityLiveRegion="polite"
            style={[
              styles.connection,
              {
                color:
                  view.connection === 'streaming' ? colors.success : colors.ink,
              },
            ]}
          >
            {view.connection.toUpperCase()}
          </Text>
          <Text style={styles.detail}>{view.detail}</Text>
          <View style={styles.buttons}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready || busy }}
              disabled={!ready || busy}
              onPress={start}
              style={({ pressed }) => [
                styles.button,
                (!ready || busy) && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.buttonText}>Start Streaming</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: !busy }}
              disabled={!busy}
              onPress={() => controller.current?.stop()}
              style={({ pressed }) => [
                styles.button,
                styles.secondary,
                !busy && styles.disabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.secondaryText}>Stop Streaming</Text>
            </Pressable>
          </View>
        </View>
        <MotionValue
          name="Accelerometer · g"
          value={frame.accelerometer}
          status={statusLabels[frame.sensorStatus.accelerometer]}
        />
        <MotionValue
          name="Gyroscope · rad/s"
          value={frame.gyroscope}
          status={statusLabels[frame.sensorStatus.gyroscope]}
        />
        <View style={styles.panel}>
          <Text style={styles.section}>GPS · 위치</Text>
          <Text style={styles.muted}>
            {statusLabels[frame.sensorStatus.location]}
          </Text>
          <Text style={styles.value}>
            위도 {frame.location?.latitude.toFixed(6) ?? '—'}
          </Text>
          <Text style={styles.value}>
            경도 {frame.location?.longitude.toFixed(6) ?? '—'}
          </Text>
          <Text style={styles.value}>
            정확도{' '}
            {frame.location?.accuracy == null
              ? '—'
              : `${frame.location.accuracy.toFixed(1)} m`}
          </Text>
          <Text style={styles.muted}>
            권한 거부 시 iPhone 설정에서 Expo Go의 위치·동작 권한을 확인한 후
            다시 시작하세요.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SensorScreen />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 20, gap: 14, paddingBottom: 32 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.5,
    color: colors.primary,
    fontWeight: '700',
  },
  title: { fontSize: 30, fontWeight: '700', color: colors.ink },
  muted: { fontSize: 13, lineHeight: 20, color: colors.muted },
  panel: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius,
    padding: 16,
    gap: 8,
  },
  section: { fontSize: 16, fontWeight: '600', color: colors.ink },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: colors.ink,
    minHeight: 48,
  },
  connection: { fontSize: 24, fontWeight: '700' },
  detail: { color: colors.muted, fontSize: 14, lineHeight: 21, minHeight: 42 },
  buttons: { gap: 10 },
  button: {
    backgroundColor: colors.primary,
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    minHeight: 48,
  },
  secondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primary,
  },
  buttonText: { color: colors.surface, fontWeight: '600', fontSize: 16 },
  secondaryText: { color: colors.primary, fontWeight: '600', fontSize: 16 },
  disabled: { opacity: 0.4 },
  pressed: { opacity: 0.75 },
  value: {
    fontFamily: 'Menlo',
    fontSize: 13,
    color: colors.ink,
    lineHeight: 21,
  },
});
