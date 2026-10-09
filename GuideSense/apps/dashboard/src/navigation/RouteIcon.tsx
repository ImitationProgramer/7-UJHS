const paths = {
  brand: 'M5 20V8a4 4 0 0 1 8 0v8a4 4 0 0 0 8 0V4M2 20h6M18 4h6',
  search: 'M21 21l-5-5M18 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  swap: 'M8 20V4M4 8l4-4 4 4m4-4v16m-4-4 4 4 4-4',
  info: 'M12 11v6m0-10v.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  crossing: 'M3 6h18M3 18h18M6 9v6m4-6v6m4-6v6m4-6v6',
  cursor: 'm4 3 6 17 3-7 7-3L4 3',
  play: 'm8 5 11 7-11 7V5',
  pause: 'M8 5v14M16 5v14',
  restart: 'M3 10a9 9 0 1 1 1 7M3 4v6h6',
  close: 'm6 6 12 12M6 18 18 6',
};
export function RouteIcon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 26 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
