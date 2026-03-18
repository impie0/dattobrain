"use client";

import { useState, useEffect } from "react";
import { useRouter, useParams } from "next/navigation";
import { getHistoryItem } from "@/lib/api";
import Link from "next/link";

export default function HistoryDetailPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [item, setItem] = useState<{
    id: string;
    question: string;
    answer: string | null;
    status: string;
    created_at: string;
    completed_at: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) {
      router.replace("/login");
      return;
    }
    getHistoryItem(id)
      .then(setItem)
      .catch(() => setError("Failed to load conversation"))
      .finally(() => setLoading(false));
  }, [router, id]);

  if (loading) {
    return (
      <div style={{ padding: "2rem", textAlign: "center" }}>Loading…</div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ padding: "2rem" }}>
        <p style={{ color: "#f87171" }}>{error || "Not found"}</p>
        <Link href="/history" style={{ color: "#3b82f6" }}>Back to history</Link>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", maxWidth: "800px", margin: "0 auto" }}>
      <header
        style={{
          padding: "1rem 1.5rem",
          borderBottom: "1px solid #334155",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1 style={{ margin: 0, fontSize: "1.25rem" }}>Conversation</h1>
        <Link href="/history" style={{ color: "#94a3b8", textDecoration: "none" }}>
          ← History
        </Link>
      </header>

      <main style={{ padding: "1.5rem" }}>
        <p style={{ fontSize: "0.875rem", color: "#94a3b8", marginBottom: "1rem" }}>
          {new Date(item.created_at).toLocaleString()} · {item.status}
        </p>
        <div
          style={{
            marginBottom: "1.5rem",
            padding: "1rem",
            background: "#1e40af",
            borderRadius: "8px",
            border: "1px solid #334155",
          }}
        >
          <strong>Question:</strong>
          <p style={{ margin: "0.5rem 0 0", whiteSpace: "pre-wrap" }}>
            {item.question}
          </p>
        </div>
        <div
          style={{
            padding: "1rem",
            background: "#1e293b",
            borderRadius: "8px",
            border: "1px solid #334155",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          <strong>Answer:</strong>
          <p style={{ margin: "0.5rem 0 0" }}>
            {item.answer ?? "(No answer)"}
          </p>
        </div>
      </main>
    </div>
  );
}
