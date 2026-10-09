import { useEffect, useRef, type RefObject } from 'react';

type VoiceLevels = { input: number; output: number };

export function VoiceParticles({
  active,
  levelRef,
}: {
  active: boolean;
  levelRef?: RefObject<VoiceLevels>;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const activity = useRef({ active, levelRef });
  activity.current = { active, levelRef };

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d');
    if (!context) return;
    const control = element.closest('.voice-cloud-control');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    let frame = 0;
    let time = 0;
    let previous = 0;
    let amplitude = 0;
    let hover = 0;
    let width = 0;
    let height = 0;
    let seed = 71;
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, inside: false };
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    // A seeded Fibonacci surface avoids random per-frame jitter or polar clusters.
    const count = 2700;
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const particles = Array.from({ length: count }, (_, index) => {
      const y = 1 - ((index + 0.5) / count) * 2;
      const ring = Math.sqrt(1 - y * y);
      const theta = index * goldenAngle;
      return {
        x: Math.cos(theta) * ring,
        y,
        z: Math.sin(theta) * ring,
        size: 0.62 + random() * 0.65,
        weight: 0.7 + random() * 0.3,
      };
    });
    const move = (event: Event) => {
      if (reduced.matches) return;
      const pointerEvent = event as PointerEvent;
      const bounds = element.getBoundingClientRect();
      const scale = Math.min(bounds.width, bounds.height) / 280 || 1;
      pointer.targetX =
        (pointerEvent.clientX - bounds.left - bounds.width / 2) / scale;
      pointer.targetY =
        (pointerEvent.clientY - bounds.top - bounds.height / 2) / scale;
      pointer.inside = true;
    };
    const leave = () => {
      pointer.inside = false;
    };
    const paint = (now: number) => {
      const dt = previous ? Math.min((now - previous) / 1000, 0.04) : 0;
      previous = now;
      const stationary = reduced.matches;
      const blend = 1 - Math.exp(-dt * 6);
      const levels = activity.current.levelRef?.current;
      const target = activity.current.active
        ? Math.min(1, Math.max(0, levels?.input ?? 0, levels?.output ?? 0))
        : 0;
      amplitude +=
        (target - amplitude) *
        (1 - Math.exp(-dt * (target > amplitude ? 16 : 5)));
      hover += ((pointer.inside ? 1 : 0) - hover) * blend;
      pointer.x += (pointer.targetX - pointer.x) * blend;
      pointer.y += (pointer.targetY - pointer.y) * blend;
      if (!stationary) time += dt;
      const t = stationary ? 0 : time;
      const energy = stationary ? 0 : amplitude;
      const proximity = stationary ? 0 : hover;
      const expansion = 1 + proximity * 0.08 + energy * 0.07;
      const scale = Math.min(width, height) / 280;
      const rotation = t * 0.115;
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const tilt = 0.22 + Math.sin(t * 0.13) * 0.09;
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);
      context.clearRect(0, 0, width, height);
      // Draw the rear hemisphere first so foreground filaments retain their depth.
      for (let hemisphere = 0; hemisphere < 2; hemisphere++) {
        for (const particle of particles) {
          const { x, y, z } = particle;
          const rx = x * cos + z * sin;
          const rz = z * cos - x * sin;
          const ry = y * cosTilt - rz * sinTilt;
          const depth = y * sinTilt + rz * cosTilt;
          if ((depth >= 0 ? 1 : 0) !== hemisphere) continue;
          // Shared low-frequency waves deform one connected body in three dimensions.
          const wave =
            Math.sin(x * 3.1 + y * 2.3 + t * 0.43) *
            Math.cos(z * 2.7 - y * 1.5 - t * 0.31);
          const folds =
            Math.sin(y * 5.2 + z * 3.2 + t * 0.35) *
            Math.cos(x * 3.6 - t * 0.27);
          const radius =
            (96 + wave * (10 + energy * 12) + folds * (4 + energy * 6)) *
            expansion;
          const perspective = 1 / (1 - depth * 0.17);
          let px = rx * radius * perspective;
          let py = ry * radius * perspective;
          const dx = px - pointer.x;
          const dy = py - pointer.y;
          const influence =
            proximity *
            Math.exp(-(dx * dx + dy * dy) / 3800) *
            (0.5 + Math.max(0, depth) * 0.5);
          px += influence * (dx * 0.18 - dy * 0.13);
          py += influence * (dy * 0.18 + dx * 0.13);
          // Moving erosion opens soft, irregular voids; contour ridges form winding bands.
          const erosion =
            Math.sin(x * 5.5 + Math.sin(z * 3 + t * 0.19) + t * 0.26) +
            Math.cos(y * 5.2 - z * 2.8 - t * 0.21) +
            Math.sin(z * 5.8 + x * 2 - t * 0.18) * 0.7;
          const coverage = Math.max(0, Math.min(1, (erosion + 0.62) * 1.8));
          if (coverage < 0.025) continue;
          const ridgeField = Math.sin(
            y * 8 + z * 4.2 + Math.sin(x * 4 + t * 0.2) * 1.8 - t * 0.33,
          );
          const ridge = Math.pow(Math.max(0, 1 - Math.abs(ridgeField)), 3);
          const front = (depth + 1) / 2;
          const centerClear = Math.min(1, 0.3 + Math.hypot(px, py) / 66);
          const opacity =
            coverage *
            particle.weight *
            centerClear *
            (0.07 + front * 0.28 + ridge * 0.56 + energy * 0.08) *
            (depth < 0 ? 0.34 : 1);
          const size =
            particle.size * (0.5 + front * 0.45 + ridge * 1.2) * scale;
          context.beginPath();
          context.fillStyle = `rgba(${Math.round(3 + ridge * 21)}, ${Math.round(94 + ridge * 49)}, 224, ${Math.min(0.94, opacity)})`;
          context.arc(
            width / 2 + px * scale,
            height / 2 + py * scale,
            size,
            0,
            Math.PI * 2,
          );
          context.fill();
        }
      }
    };
    const tick = (now: number) => {
      paint(now);
      frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const bounds = element.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      element.width = Math.round(width * ratio);
      element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      paint(performance.now());
    };
    const update = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!reduced.matches && !document.hidden)
        frame = requestAnimationFrame(tick);
      else paint(performance.now());
    };
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    control?.addEventListener('pointerenter', move);
    control?.addEventListener('pointermove', move);
    control?.addEventListener('pointerleave', leave);
    resize();
    update();
    reduced.addEventListener('change', update);
    document.addEventListener('visibilitychange', update);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      control?.removeEventListener('pointerenter', move);
      control?.removeEventListener('pointermove', move);
      control?.removeEventListener('pointerleave', leave);
      reduced.removeEventListener('change', update);
      document.removeEventListener('visibilitychange', update);
    };
  }, []);
  return <canvas ref={canvas} className="voice-particles" aria-hidden="true" />;
}
