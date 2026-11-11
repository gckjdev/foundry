"use client";

import { usePathname } from "next/navigation";

/**
 * Client boundary for the panel chrome. `router.refresh()` re-emits the server layout; a host
 * `<main>` in that payload remounts and replays its enter animation, which looks like a full page
 * reload. This component owns `.shell` and `<main>` so they survive those refreshes. `<main>` only
 * remounts (and animates) when the pathname actually changes.
 */
export function PanelShell({ nav, children }: { nav: React.ReactNode; children: React.ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="shell">
      {nav}
      <main key={pathname}>{children}</main>
    </div>
  );
}
