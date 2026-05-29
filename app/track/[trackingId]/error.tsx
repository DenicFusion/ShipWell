'use client';

import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/Button"
import { useRouter } from "next/navigation"

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const router = useRouter()

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-4 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand-danger/10">
        <AlertCircle className="h-10 w-10 text-brand-danger" />
      </div>
      <h2 className="mb-2 font-display text-4xl text-white">Tracking Error</h2>
      <p className="mb-8 max-w-md text-brand-muted">
        {error.message.includes('not found') 
          ? "We couldn't find a package with that tracking number. Please verify the number and try again."
          : "We encountered an unexpected error while fetching your shipment details."}
      </p>
      <div className="flex gap-4">
        <Button variant="outline" onClick={() => router.push('/')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back Home
        </Button>
        <Button onClick={() => reset()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Try Again
        </Button>
      </div>
    </div>
  )
}
