// Tiny markdown-ish renderer shared by the chat widget and the insights panel:
// **bold**, and `- ` / `* ` bullet lines. Intentionally minimal — the assistant
// and the insight generator only emit this subset.
export function renderText(text) {
  if (!text) return null;
  const lines = text.split('\n');
  const out = [];
  let bullets = null;
  const flush = () => {
    if (bullets) {
      out.push(
        <ul key={'ul' + out.length}>
          {bullets.map((b, i) => (
            <li key={i}>{inline(b)}</li>
          ))}
        </ul>
      );
      bullets = null;
    }
  };
  lines.forEach((ln, i) => {
    const m = ln.match(/^\s*[-*]\s+(.*)$/);
    if (m) {
      (bullets ||= []).push(m[1]);
    } else {
      flush();
      if (ln.trim()) out.push(<p key={'p' + i}>{inline(ln)}</p>);
    }
  });
  flush();
  return out;
}

export function inline(s) {
  return s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}
