function searchable(value = "") {
  return String(value).normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, " ").trim();
}

// Keep notebook and item order. Searching never changes learning data or playback queues.
export function searchEntries(assignments, query, scope = "all") {
  const terms = searchable(query).split(" ").filter(Boolean);
  if (!terms.length) return [];
  return assignments.flatMap((assignment) => {
    if (scope !== "all" && assignment.id !== scope) return [];
    return assignment.items.flatMap((item, index) => {
      const text = searchable([assignment.title, item.prompt, item.answer, item.note].filter(Boolean).join("\n"));
      return terms.every((term) => text.includes(term)) ? [{ assignment, item, index }] : [];
    });
  });
}
