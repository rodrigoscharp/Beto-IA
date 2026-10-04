/* Fantasminha 2D: aparece se o WebGL não subir. Mesmas cores do modelo 3D. */
export default function GhostFallback({ size = 260 }: { size?: number }) {
  return (
    <svg viewBox="0 0 200 220" width={size} height={size * 1.1} aria-label="Beto" role="img">
      <ellipse cx="100" cy="208" rx="62" ry="8" fill="rgba(0,0,0,.18)" />
      <path
        d="M100 18c-44 0-74 32-74 76v86c0 6 7 9 11 5l10-9 12 11c3 3 8 3 11 0l12-11 12 11c3 3 8 3 11 0l12-11 12 11c3 3 8 3 11 0l12-11 10 9c4 4 11 1 11-5V94c0-44-30-76-74-76z"
        fill="#F6F3EC"
      />
      <ellipse cx="73" cy="96" rx="10" ry="15" fill="#16140F" />
      <ellipse cx="127" cy="96" rx="10" ry="15" fill="#16140F" />
      <circle cx="77" cy="89" r="3.5" fill="#fff" />
      <circle cx="131" cy="89" r="3.5" fill="#fff" />
      <ellipse cx="52" cy="122" rx="11" ry="6" fill="#FF9A6B" />
      <ellipse cx="148" cy="122" rx="11" ry="6" fill="#FF9A6B" />
      <ellipse cx="100" cy="124" rx="7" ry="8.5" fill="#FF6B2C" />
    </svg>
  );
}
