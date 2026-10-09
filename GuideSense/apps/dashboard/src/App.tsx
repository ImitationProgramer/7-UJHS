import { lazy, Suspense } from 'react';

const NavigationPanel = lazy(() =>
  import('./navigation/NavigationPanel').then((module) => ({
    default: module.NavigationPanel,
  })),
);
const LegacyDashboard = lazy(() => import('./LegacyDashboard'));
const defaultAddress =
  import.meta.env.VITE_BACKEND_URL ||
  `${location.protocol}//${location.hostname}:8000`;

export default function App() {
  return (
    <Suspense fallback={<p role="status">GuideSense를 불러오는 중입니다.</p>}>
      {location.pathname.replace(/\/$/, '') === '/diagnostics' ? (
        <LegacyDashboard />
      ) : (
        <NavigationPanel address={defaultAddress} />
      )}
    </Suspense>
  );
}
