"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("FounderOS route error", error.digest || error.name);
  }, [error]);

  return (
    <main className="error-page">
      <div className="error-card">
        <span className="error-kicker">FOUNDEROS</span>
        <h1>We hit a snag.</h1>
        <p>Your workspace is safe. Try loading this page again.</p>
        <button className="primary-button" onClick={retry}>
          Try again
        </button>
        {error.digest && <small>Reference: {error.digest}</small>}
      </div>
    </main>
  );
}
