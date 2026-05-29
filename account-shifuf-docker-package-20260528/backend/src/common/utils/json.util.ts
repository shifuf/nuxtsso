export function toJsonString(value: unknown) {
  return JSON.stringify(value);
}

export function parseStringArray(value: string | null | undefined) {
  if (!value) {
    return [] as string[];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function uniqueStringArray(value: string[]) {
  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}
