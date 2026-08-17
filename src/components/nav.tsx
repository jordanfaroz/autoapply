"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Dashboard" },
  { href: "/profile", label: "Profile" },
  { href: "/answers", label: "Answer Bank" },
  { href: "/queue", label: "Queue" },
  { href: "/tracker", label: "Tracker" },
  { href: "/settings", label: "Settings" },
] as const;

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="border-b bg-background sticky top-0 z-20">
      <div className="mx-auto flex h-12 max-w-7xl items-center gap-1 px-4">
        <Link href="/" className="mr-4 text-sm font-semibold tracking-tight">
          autoapply
        </Link>
        <nav className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm transition-colors",
                  active
                    ? "bg-muted font-medium text-foreground"
                    : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
