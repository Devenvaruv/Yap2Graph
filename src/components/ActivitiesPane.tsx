export function ActivitiesPane() {
  return (
    <section className="pane" aria-labelledby="activities-heading">
      <h2 id="activities-heading">Activities used</h2>
      <p className="pane-placeholder">
        Activities selected for this intent will appear here with their relevance scores.
      </p>
    </section>
  );
}
