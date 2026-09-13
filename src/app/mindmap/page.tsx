import Link from "next/link";

export default function MindMapPage() {
  return (
    <main className="mindmap-page">
      <header className="mindmap-header">
        <div>
          <h1>Cognee Mind Map</h1>
          <p className="tagline">Full graph view of the Yap2Graph local brain.</p>
        </div>
        <Link className="text-link" href="/">
          Back to app
        </Link>
      </header>
      <iframe
        className="mindmap-frame"
        src="/api/cognee/visualize"
        title="Cognee mind map"
      />
    </main>
  );
}
