/** Small line icons for the drone controls (24 x 24, stroke = currentColor). */
const PATHS: Record<string, string> = {
  takeoff: 'M12 19V5m0 0-5 5m5-5 5 5M5 21h14',
  land: 'M12 5v14m0 0-5-5m5 5 5-5M5 3h14',
  home: 'M3 11 12 4l9 7M6 9.5V20h12V9.5',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  scan: 'M12 12m-8 0a8 8 0 1 0 16 0 8 8 0 1 0-16 0M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0M12 12 18 6',
  route: 'M5 19c4 0 3-6 7-6s3-6 7-6M5 19a2 2 0 1 0 0-.01M19 7a2 2 0 1 0 0-.01',
  hop: 'M4 18c2-6 6-9 8-9s4 2 4 5M16 14l-2-2m2 2 2-2M4 18h4M16 18h4',
  flag: 'M6 21V4m0 0h10l-2 4 2 4H6',
  download: 'M12 4v11m0 0-4-4m4 4 4-4M5 20h14',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14m6-12v14',
  layers: 'M12 4 3 9l9 5 9-5-9-5zM3 14l9 5 9-5',
};

export default function Icon({ name, size = 18 }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name] ?? ''} />
    </svg>
  );
}
