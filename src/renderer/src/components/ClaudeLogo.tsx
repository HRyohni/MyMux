/** Claude's little pixel creature, the avatar of its messages. */
export default function ClaudeLogo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" role="img" aria-label="Claude" className="text-accent">
      <path fill="currentColor" d="M3 2h10v3h2v3h-2v3H3V8H1V5h2zM4 11h1v3H4zM6 11h1v3H6zM9 11h1v3H9zM11 11h1v3h-1z" />
      <path fill="#1b120e" d="M5 4h1v2H5zM10 4h1v2h-1z" />
    </svg>
  )
}
