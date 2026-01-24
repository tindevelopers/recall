export function toPgVectorLiteral(value) {
  if (!Array.isArray(value) || value.length === 0) return null;

  const numbers = [];
  for (const v of value) {
    const num = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(num)) {
      return null;
    }
    numbers.push(num);
  }

  return `[${numbers.join(",")}]`;
}

export function normalizeEmbeddingInput(value) {
  // Accept arrays or existing vector literal strings; otherwise return null
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      return trimmed;
    }
    return null;
  }

  return toPgVectorLiteral(value);
}

