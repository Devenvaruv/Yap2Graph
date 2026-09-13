const DEFAULT_COGNEE_API_URL = "http://localhost:8010";

export async function GET(): Promise<Response> {
  const apiUrl = process.env.COGNEE_API_URL ?? DEFAULT_COGNEE_API_URL;
  const response = await fetch(
    `${apiUrl.replace(/\/+$/, "")}/api/v1/visualize?dataset=main_dataset&full=true&max_nodes=5000`,
    { cache: "no-store" },
  );

  const body = await response.text();
  return new Response(body, {
    status: response.status,
    headers: {
      "content-type": response.headers.get("content-type") ?? "text/html; charset=utf-8",
    },
  });
}
