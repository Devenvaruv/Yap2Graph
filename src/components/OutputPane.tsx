export function OutputPane() {
  return (
    <section className="pane" aria-labelledby="output-heading">
      <h2 id="output-heading">Output</h2>
      <p className="pane-placeholder">
        No output yet. Generated output for the selected intent and time range will appear here.
      </p>
    </section>
  );
}
