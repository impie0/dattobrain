"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  getMyApprovals,
  getApprovableRequests,
  approveUserRequest,
  rejectUserRequest,
  ApprovalRequest,
} from "@/lib/api";

const RISK_COLOR: Record<string, string> = {
  low: "#166534",
  medium: "#78350f",
  high: "#7f1d1d",
};

const STATUS_COLOR: Record<string, string> = {
  pending: "#92400e",
  approved: "#166534",
  rejected: "#7f1d1d",
};

function Card({ req, onApprove, onReject, showActions }: {
  req: ApprovalRequest;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  showActions: boolean;
}) {
  const [acting, setActing] = useState(false);

  async function act(fn: (id: string) => Promise<void>) {
    setActing(true);
    try { await fn(req.id); } finally { setActing(false); }
  }

  return (
    <div style={{
      background: "#1e293b", border: "1px solid #334155", borderRadius: "6px",
      padding: "1rem 1.25rem", display: "flex", flexDirection: "column", gap: "0.5rem",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
        <span style={{ fontWeight: 600, color: "#e2e8f0", fontSize: "0.9375rem" }}>{req.tool_name}</span>
        {req.risk_level && (
          <span style={{
            fontSize: "0.7rem", background: RISK_COLOR[req.risk_level] ?? "#334155",
            color: "#fca5a5", borderRadius: "3px", padding: "2px 6px", textTransform: "uppercase",
          }}>{req.risk_level}</span>
        )}
        <span style={{
          fontSize: "0.7rem", background: STATUS_COLOR[req.status] ?? "#334155",
          color: "#e2e8f0", borderRadius: "3px", padding: "2px 6px",
        }}>{req.status}</span>
        <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "#64748b" }}>
          {new Date(req.created_at).toLocaleString()}
        </span>
      </div>
      {req.requested_by && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>Requested by: {req.requested_by}</p>
      )}
      {Object.keys(req.parameters).length > 0 && (
        <pre style={{
          margin: 0, fontSize: "0.75rem", color: "#94a3b8", background: "#0f172a",
          borderRadius: "4px", padding: "0.5rem", overflowX: "auto",
        }}>
          {JSON.stringify(req.parameters, null, 2)}
        </pre>
      )}
      {req.approved_by_name && (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#64748b" }}>
          {req.status === "approved" ? "Approved" : "Rejected"} by: {req.approved_by_name}
        </p>
      )}
      {showActions && req.status === "pending" && onApprove && onReject && (
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.25rem" }}>
          <button
            type="button"
            disabled={acting}
            onClick={() => act((id) => { onApprove(id); return approveUserRequest(id); })}
            style={{
              background: "#166534", color: "#e2e8f0", border: "none",
              borderRadius: "4px", padding: "0.375rem 0.875rem",
              cursor: acting ? "not-allowed" : "pointer", fontSize: "0.8125rem",
            }}
          >Approve</button>
          <button
            type="button"
            disabled={acting}
            onClick={() => act((id) => { onReject(id); return rejectUserRequest(id); })}
            style={{
              background: "#7f1d1d", color: "#e2e8f0", border: "none",
              borderRadius: "4px", padding: "0.375rem 0.875rem",
              cursor: acting ? "not-allowed" : "pointer", fontSize: "0.8125rem",
            }}
          >Reject</button>
        </div>
      )}
    </div>
  );
}

export default function ApprovalsPage() {
  const router = useRouter();
  const [mine, setMine] = useState<ApprovalRequest[]>([]);
  const [approvable, setApprovable] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    Promise.all([getMyApprovals(), getApprovableRequests()])
      .then(([m, a]) => { setMine(m); setApprovable(a); })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [router]);

  function handleApprove(id: string) {
    setApprovable((prev) => prev.map((r) => r.id === id ? { ...r, status: "approved" } : r));
  }

  function handleReject(id: string) {
    setApprovable((prev) => prev.map((r) => r.id === id ? { ...r, status: "rejected" } : r));
  }

  if (loading) return <p style={{ color: "#94a3b8", padding: "2rem" }}>Loading…</p>;

  return (
    <div style={{ maxWidth: "760px", margin: "0 auto", padding: "1.5rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <Link href="/chat" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.875rem" }}>
          ← Back to Chat
        </Link>
        <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Approvals</h2>
      </div>

      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}

      {approvable.length > 0 && (
        <section style={{ marginBottom: "2rem" }}>
          <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", color: "#94a3b8" }}>
            Waiting for your approval ({approvable.filter((r) => r.status === "pending").length})
          </h3>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {approvable.map((req) => (
              <Card key={req.id} req={req} onApprove={handleApprove} onReject={handleReject} showActions />
            ))}
          </div>
        </section>
      )}

      <section>
        <h3 style={{ margin: "0 0 0.75rem", fontSize: "0.9375rem", color: "#94a3b8" }}>
          My requests ({mine.length})
        </h3>
        {mine.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "0.875rem" }}>No approval requests yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.625rem" }}>
            {mine.map((req) => (
              <Card key={req.id} req={req} showActions={false} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
