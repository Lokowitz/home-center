import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"

/** Shown to admins while HomeCenter holds no assets or records. */
export function FreshStartCard() {
  return (
    <Card className="py-5">
      <CardHeader className="px-5">
        <CardTitle>Welcome to HomeCenter</CardTitle>
        <CardDescription>Start fresh, or bring everything over from a backup of another HomeCenter.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 px-5">
        <Link href="/assets/properties" className={buttonVariants()}>Add your first asset</Link>
        <Link href="/settings?tab=data#restore" className={buttonVariants({ variant: "outline" })}>Restore from a backup</Link>
      </CardContent>
    </Card>
  )
}
