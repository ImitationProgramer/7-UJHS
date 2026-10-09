type BrandLogoProps = {
  decorative?: boolean;
  className?: string;
};

export function BrandLogo({
  decorative = true,
  className = '',
}: BrandLogoProps) {
  return (
    <img
      className={`nav-brand-logo ${className}`.trim()}
      src="/brand/guidesense-gs-road.png"
      alt={decorative ? '' : 'GuideSense — 길을 닮은 gs 로고'}
      aria-hidden={decorative || undefined}
      width={60}
      height={40}
      decoding="async"
      draggable={false}
    />
  );
}
