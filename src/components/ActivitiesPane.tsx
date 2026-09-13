type SourcePreview = {
  documentId: string | null;
  excerpt: string;
};

type ActivitiesPaneProps = {
  sources?: readonly SourcePreview[];
  isLoading?: boolean;
};

export function ActivitiesPane({ sources = [], isLoading = false }: ActivitiesPaneProps) {
  return (
    <section className="pane" aria-labelledby="sources-heading">
      <h2 id="sources-heading">Sources used</h2>
      {isLoading ? <p className="pane-placeholder">Loading sources...</p> : null}
      {!isLoading && sources.length === 0 ? (
        <p className="pane-placeholder">
          Cognee snippets used for the draft will appear here.
        </p>
      ) : null}
      {sources.length > 0 ? (
        <ol className="source-list">
          {sources.map((source, index) => (
            <li key={`${source.documentId ?? "unknown"}-${index}`}>
              <span className="source-id">{source.documentId ?? "Unmapped source"}</span>
              <p>{source.excerpt}</p>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
