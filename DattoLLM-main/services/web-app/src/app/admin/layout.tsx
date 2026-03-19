"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/roles", label: "Roles" },
  { href: "/admin/tools", label: "Tools" },
  { href: "/admin/approvals", label: "Approvals" },
  { href: "/admin/llm-logs", label: "LLM Logs" },
  { href: "/admin/data-sync", label: "Data Sync" },
  { href: "/admin/explorer", label: "Explorer" },
  { href: "/admin/llm-config", label: "LLM Config" },
  { href: "/admin/observability", label: "Observability" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
      <header
        style={{
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #334155",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Datto RMM — Admin</h1>
        <Link href="/chat" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.875rem" }}>
          Back to Chat
        </Link>
      </header>
      <div style={{ display: "flex", flex: 1 }}>
        <nav
          style={{
            width: "200px",
            borderRight: "1px solid #334155",
            padding: "1.5rem 1rem",
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
          }}
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: "0.5rem 0.75rem",
                borderRadius: "6px",
                textDecoration: "none",
                color: pathname.startsWith(link.href) ? "#e2e8f0" : "#94a3b8",
                background: pathname.startsWith(link.href) ? "#1e293b" : "transparent",
                fontWeight: pathname.startsWith(link.href) ? 600 : 400,
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <main style={{ flex: 1, padding: "1.5rem" }}>{children}</main>
      </div>
    </div>
  );
}
