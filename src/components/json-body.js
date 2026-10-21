// A pre-compressed .json.gz can arrive still gzipped or already decoded,
// depending on which Content-Encoding the host or CDN added on the way.
// Decide from the bytes: gzip always starts with 1f 8b, JSON text never does.
export async function readJSONBody(response) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b)
    return new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).json();
  return JSON.parse(new TextDecoder().decode(bytes));
}
