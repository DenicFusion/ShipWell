export function StatusPulse({ colorClass }: { colorClass: string }) {
  return (
    <div className="relative flex h-6 w-6 items-center justify-center">
      <div className={`absolute inset-0 rounded-full bg-current opacity-25 animate-pulse-ring ${colorClass}`} />
      <div className={`relative h-2.5 w-2.5 rounded-full bg-current ${colorClass}`} />
    </div>
  )
}
