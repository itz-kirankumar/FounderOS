import Link from "next/link";

export default function NotFound() {
  return (
    <main className="error-page">
      <div className="error-card">
        <span className="error-kicker">404 · NOT FOUND</span>
        <h1>This page moved.</h1>
        <p>The page you’re looking for isn’t available at this address.</p>
        <Link className="primary-button" href="/">
          Back to FounderOS
        </Link>
      </div>
    </main>
  );
}
