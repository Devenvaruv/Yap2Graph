type OutputPaneProps = {
  title?: string;
  markdown?: string;
  isLoading?: boolean;
  error?: string | null;
  onCopy?: () => void;
};

export function OutputPane({
  title,
  markdown,
  isLoading = false,
  error = null,
  onCopy,
}: OutputPaneProps) {
  return (
    <section className="pane" aria-labelledby="output-heading">
      <div className="pane-heading">
        <h2 id="output-heading">Draft</h2>
        {markdown ? (
          <button type="button" className="small-button" onClick={onCopy}>
            Copy
          </button>
        ) : null}
      </div>
      {isLoading ? <p className="pane-placeholder">Searching Cognee and drafting...</p> : null}
      {error ? <p className="error-message">{error}</p> : null}
      {!isLoading && !error && !markdown ? (
        <p className="pane-placeholder">
          Pick a profile, choose a time range, and generate a draft from your Cognee brain.
        </p>
      ) : null}
      {markdown ? (
        <article className="draft-output">
          {title ? <h3>{title}</h3> : null}
          <pre>{markdown}</pre>
        </article>
      ) : null}
    </section>
  );
}
