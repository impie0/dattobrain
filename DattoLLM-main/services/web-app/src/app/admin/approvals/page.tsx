"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { getApprovals, approveRequest, rejectRequest, ApprovalRequest } from "@/lib/api";

export default function AdminApprovalsPage() {
  const router = useRouter();
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acting, setActing] = useState<string | null>(null);

  const loadApprovals = useCallback(() => {
    setLoading(true);
    getApprovals("pending")
      .then(setApprovals)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load approvals"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const token = document.cookie.match(/token=([^;]+)/);
    if (!token) { router.replace("/login"); return; }
    loadApprovals();
  }, [router, loadApprovals]);

  async function handleApprove(id: string) {
    setActing(id);
    try {
      await approveRequest(id);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to approve request");
    } finally {
      setActing(null);
    }
  }

  async function handleReject(id: string) {
    setActing(id);
    try {
      await rejectRequest(id);
      setApprovals((prev) => prev.filter((a) => a.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to reject request");
    } finally {
      setActing(null);
    }
  }

  if (loading) return <p style={{ color: "#94a3b8" }}>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem" }}>
        <h2 style={{ margin: 0, fontSize: "1.125rem" }}>Pending Approvals</h2>
        <button
          type="button"
          onClick={loadApprovals}
          style={{
            background: "transparent",
            border: "1px solid #334155",
            color: "#94a3b8",
            padding: "0.4rem 0.75rem",
            borderRadius: "6px",
            cursor: "pointer",
            fontSize: "0.875rem",
          }}
        >
          Refresh
        </button>
      </div>
      {error && <p style={{ color: "#f87171", marginBottom: "1rem" }}>{error}</p>}
      {approvals.length === 0 && (
        <p style={{ color: "#64748b", textAlign: "center", marginTop: "2rem" }}>
          No pending approval requests.
        </p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        {approvals.map((approval) => (
          <div
            key={approval.id}
            style={{
              background: "#1e293b",
              border: "1px solid #334155",
              borderRadius: "8px",
              padding: "1.25rem",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.75rem" }}>
              <div>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "1rem",
                    color: "#e2e8f0",
                    fontWeight: 600,
                  }}
                >
                  {approval.tool_name}
                </span>
                <span style={{ marginLeft: "1rem", fontSize: "0.8rem", color: "#94a3b8" }}>
                  requested by <strong style={{ color: "#cbd5e1" }}>{approval.requested_by}</strong>
                </span>
              </div>
              <span style={{ fontSize: "0.75rem", color: "#64748b" }}>
                {new Date(approval.created_at).toLocaleString()}
              </span>
            </div>
            {Object.keys(approval.parameters).length > 0 && (
              <pre
                style={{
                  background: "#0f172a",
                  border: "1px solid #1e293b",
                  borderRadius: "4px",
                  padding: "0.75rem",
                  fontSize: "0.8rem",
                  color: "#94a3b8",
                  overflowX: "auto",
                  margin: "0 0 0.75rem",
                }}
              >
                {JSON.stringify(approval.parameters, null, 2)}
              </pre>
            )}
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button
                type="button"
                disabled={acting === approval.id}
                onClick={() => handleApprove(approval.id)}
                style={{
                  background: "#166534",
                  color: "#e2e8f0",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.5rem 1rem",
                  cursor: acting === approval.id ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                Approve
              </button>
              <button
                type="button"
                disabled={acting === approval.id}
                onClick={() => handleReject(approval.id)}
                style={{
                  background: "#7f1d1d",
                  color: "#e2e8f0",
                  border: "none",
                  borderRadius: "6px",
                  padding: "0.5rem 1rem",
                  cursor: acting === approval.id ? "not-allowed" : "pointer",
                  fontWeight: 600,
                  fontSize: "0.875rem",
                }}
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
