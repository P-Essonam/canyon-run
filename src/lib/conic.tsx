import { CONIC_URL } from "../shared/protocol"

// "Powered by Conic", on the screen and on the phone's game-over screen.
// It links to Conic, where you can deploy your own Canyon Run.

export function PoweredByConic({
  className = "",
  label = "Powered by",
}: {
  className?: string
  label?: string
}) {
  return (
    <a
      className={`conic-badge ${className}`}
      href={CONIC_URL}
      target="_blank"
      rel="noopener"
    >
      <span className="conic-label">{label}</span>
      <ConicCone />
      <span className="conic-name">Conic</span>
    </a>
  )
}

export function ConicCone({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true">
      <path
        d="M1.013 17.974L9.016 1.968A1.1 1.1 0 0 1 10.984 1.968L14.848 9.695A0.35 0.35 0 0 1 14.661 10.178A10.1 10.1 0 0 0 8.2 19.648A0.35 0.35 0 0 1 7.85 20L2.265 20A1.4 1.4 0 0 1 1.013 17.974Z"
        fill="#8b3dff"
      />
      <path
        d="M16.313 12.627L18.987 17.974A1.4 1.4 0 0 1 17.735 20L10.75 20A0.35 0.35 0 0 1 10.4 19.652A7.9 7.9 0 0 1 15.364 12.266A0.75 0.75 0 0 1 16.313 12.627Z"
        fill="#c9a6ff"
      />
    </svg>
  )
}
