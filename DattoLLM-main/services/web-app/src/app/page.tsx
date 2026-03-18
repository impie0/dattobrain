"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    const match = document.cookie.match(/token=([^;]+)/);
    if (match) router.replace("/chat");
    else router.replace("/login");
  }, [router]);
  return (
    <div style={{ padding: "2rem", textAlign: "center" }}>
      Redirecting…
    </div>
  );
}
