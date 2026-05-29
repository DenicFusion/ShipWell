export default function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-bg-base font-sans text-text-base">
      {children}
    </div>
  )
}
