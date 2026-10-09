import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Candidate, Coordinate, Metadata, Point } from './contract';
import { behaviorLabels, type JourneyObservation } from './companion';
const NO_EVENTS: JourneyObservation[] = [];

function frameRoute(
  map: L.Map,
  bounds: L.LatLngBounds,
  animate = false,
  bottom = 270,
  bottomFraction = 0,
) {
  map.fitBounds(bounds, {
    paddingTopLeft: [32, 110],
    paddingBottomRight: [
      32,
      Math.min(
        Math.max(bottom, map.getSize().y * bottomFraction + 30),
        map.getSize().y - 190,
      ),
    ],
    maxZoom: 17,
    animate:
      animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    duration: 0.5,
  });
}

export function NavigationMap({
  metadata,
  start,
  end,
  candidates,
  selectedId,
  position,
  companionEvents = NO_EVENTS,
  previewPadding = 270,
  bottomFraction = 0,
  onPick,
}: {
  metadata: Metadata | null;
  start: Point | null;
  end: Point | null;
  candidates: Candidate[];
  selectedId: string | null;
  position: Coordinate | null;
  companionEvents?: JourneyObservation[];
  previewPadding?: number;
  bottomFraction?: number;
  onPick?: (point: Point) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const routeBounds = useRef<L.LatLngBounds | null>(null);
  const paddingRef = useRef(previewPadding);
  paddingRef.current = previewPadding;
  const bottomFractionRef = useRef(bottomFraction);
  bottomFractionRef.current = bottomFraction;
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const movingMarker = useRef<L.CircleMarker | null>(null);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const instance = L.map(container.current, {
      scrollWheelZoom: true,
      zoomControl: false,
      // Voice endpoint changes remove the map; avoid a deferred zoom callback
      // accessing Leaflet panes after teardown. Pan and page motion remain.
      zoomAnimation: false,
    }).setView([37.551, 127.039], 14);
    map.current = instance;
    L.control.zoom({ position: 'topright' }).addTo(instance);
    const tiles = L.tileLayer(
      'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(instance);
    tiles.on('tileerror', () => setTileError(true));
    instance.on('click', (event: L.LeafletMouseEvent) =>
      onPickRef.current?.({
        lat: event.latlng.lat,
        lon: event.latlng.lng,
        name: '지도에서 선택한 위치',
      }),
    );
    const observer = new ResizeObserver(() => {
      instance.invalidateSize();
      if (routeBounds.current)
        frameRoute(
          instance,
          routeBounds.current,
          false,
          paddingRef.current,
          bottomFractionRef.current,
        );
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.remove();
      map.current = null;
      movingMarker.current = null;
    };
  }, []);
  useEffect(() => {
    if (!map.current || !metadata) return;
    const boundary = L.geoJSON(metadata.boundary, {
      style: {
        color: getComputedStyle(container.current!)
          .getPropertyValue('--primary')
          .trim(),
        weight: 2,
        dashArray: '5 7',
        fillOpacity: 0.025,
      },
    }).addTo(map.current);
    return () => {
      boundary.remove();
    };
  }, [metadata]);
  useEffect(() => {
    if (!map.current) return;
    if (start || end) {
      const points = [start, end].filter(
        (point): point is Point => point !== null,
      );
      map.current.fitBounds(
        L.latLngBounds(points.map((point) => [point.lat, point.lon])),
        {
          padding: [65, 100],
          maxZoom: 16,
          animate: !window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches,
        },
      );
    }
    const group = L.layerGroup().addTo(map.current);
    for (const [point, label] of [
      [start, '출발'],
      [end, '도착'],
    ] as const) {
      if (!point) continue;
      const icon = L.divIcon({
        className: `navigation-pin ${label === '도착' ? 'navigation-pin-end' : ''}`,
        html: `<span>${label}</span>`,
        iconSize: [48, 32],
        iconAnchor: [24, 38],
      });
      L.marker([point.lat, point.lon], {
        icon,
        title: label,
        keyboard: false,
      }).addTo(group);
    }
    return () => {
      group.remove();
    };
  }, [start, end]);
  useEffect(() => {
    if (!map.current) return;
    const group = L.layerGroup().addTo(map.current);
    const styles = getComputedStyle(container.current!);
    const primary = styles.getPropertyValue('--primary').trim();
    const muted = styles.getPropertyValue('--muted').trim();
    const danger = styles.getPropertyValue('--danger').trim();
    const surface = styles.getPropertyValue('--surface').trim();
    for (const candidate of [...candidates].sort(
      (a, b) => Number(a.id === selectedId) - Number(b.id === selectedId),
    )) {
      const selected = candidate.id === selectedId;
      L.polyline(
        candidate.geometry.map(([lon, lat]) => [lat, lon]),
        {
          color:
            candidate.decision === 'excluded'
              ? danger
              : selected
                ? primary
                : muted,
          weight: selected ? 6 : 3,
          opacity: selected ? 1 : 0.5,
          dashArray: candidate.decision === 'eligible' ? undefined : '5 7',
        },
      ).addTo(group);
      if (selected)
        for (const crossing of candidate.crossings) {
          const marker = L.circleMarker(
            [crossing.coordinate[1], crossing.coordinate[0]],
            {
              radius: 6,
              color: crossing.status === 'matched' ? primary : danger,
              fillColor: surface,
              fillOpacity: 1,
              weight: 2,
            },
          ).addTo(group);
          const text = document.createElement('span');
          text.textContent = crossing.reason;
          marker.bindTooltip(text);
        }
    }
    if (candidates.length) {
      const selected =
        candidates.find((c) => c.id === selectedId) ?? candidates[0];
      routeBounds.current = L.latLngBounds(
        selected.geometry.map(([lon, lat]) => [lat, lon]),
      );
      frameRoute(
        map.current,
        routeBounds.current,
        true,
        paddingRef.current,
        bottomFractionRef.current,
      );
    } else {
      routeBounds.current = null;
    }

    return () => {
      group.remove();
    };
  }, [candidates, selectedId]);
  useEffect(() => {
    if (map.current && routeBounds.current)
      frameRoute(
        map.current,
        routeBounds.current,
        false,
        previewPadding,
        bottomFraction,
      );
  }, [previewPadding, bottomFraction]);
  useEffect(() => {
    if (!map.current) return;
    const group = L.layerGroup().addTo(map.current);
    companionEvents
      .filter((item) => item.changed)
      .forEach((item, index) => {
        const marker = L.marker([item.coordinate[1], item.coordinate[0]], {
          icon: L.divIcon({
            className: 'companion-map-event',
            html: `<span>${index + 1}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, -8],
          }),
          title: `가상 행동 변화 ${index + 1}`,
          keyboard: true,
          zIndexOffset: 1000,
        }).addTo(group);
        const text = document.createElement('span');
        text.textContent = `가상 행동 변화 ${index + 1}: ${behaviorLabels[item.previousActivity!] ?? item.previousActivity} → ${behaviorLabels[item.activity!] ?? item.activity}. ${item.context}. 실제 관찰 위치가 아닙니다.`;
        marker.bindPopup(text);
      });
    return () => {
      group.remove();
    };
  }, [companionEvents]);
  useEffect(() => {
    if (!map.current || !position) {
      movingMarker.current?.remove();
      movingMarker.current = null;
      return;
    }
    if (!movingMarker.current)
      movingMarker.current = L.circleMarker([position[1], position[0]], {
        radius: 9,
        color: getComputedStyle(container.current!)
          .getPropertyValue('--surface')
          .trim(),
        weight: 3,
        fillColor: getComputedStyle(container.current!)
          .getPropertyValue('--primary')
          .trim(),
        fillOpacity: 1,
      }).addTo(map.current);
    else movingMarker.current.setLatLng([position[1], position[0]]);
    movingMarker.current.bringToFront();
  }, [position]);
  return (
    <div className="navigation-map-wrap">
      <div
        className="navigation-map"
        ref={container}
        role="region"
        aria-label={
          onPick
            ? '성동구 지도. 지도에서 지점을 누르거나 장소 검색으로 출발지와 도착지를 지정하세요.'
            : '성동구 경로 지도. 지도를 이동하거나 확대해 경로를 확인하세요.'
        }
        data-testid="navigation-map"
      />
      {tileError && (
        <p className="navigation-map-warning" role="status">
          지도 배경을 불러오지 못했어요. 네트워크를 확인해 주세요. 경로 안내와
          비교 결과는 계속 확인할 수 있어요.
        </p>
      )}
      <p className="navigation-map-caption">
        점선 경계: 성동구 · 실선: 비교 가능한 경로 · 원: 횡단 시설
      </p>
    </div>
  );
}
