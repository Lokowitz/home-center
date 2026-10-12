"use client"

import { signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LogOut, KeyRound, Smartphone } from "lucide-react"

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter()
  const initials = name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Account: ${name}`} className="flex min-h-10 min-w-10 items-center justify-center gap-2 rounded-lg px-1.5 py-1.5 text-sm lg:min-h-0 lg:px-2 transition-colors duration-150 hover:bg-muted outline-none">
        <Avatar className="h-7 w-7">
          <AvatarFallback className="bg-primary/15 text-xs font-medium text-primary">{initials}</AvatarFallback>
        </Avatar>
        {/* Until there's room for the search box too, the avatar alone is the button; the name and email are in the menu. */}
        <div className="hidden text-left lg:block">
          <div className="font-medium leading-none">{name}</div>
          <div className="text-xs text-muted-foreground leading-none mt-0.5">{email}</div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>My Account</DropdownMenuLabel>
          <div className="px-2 pb-1.5 lg:hidden">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="truncate text-xs text-muted-foreground">{email}</div>
          </div>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/change-password")}>
          <KeyRound className="h-4 w-4 mr-2" />
          Change Password
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/settings/install")}>
          <Smartphone className="h-4 w-4 mr-2" />
          Install as app
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => signOut({ callbackUrl: "/login" })}
        >
          <LogOut className="h-4 w-4 mr-2" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
