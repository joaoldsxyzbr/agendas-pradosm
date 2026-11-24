// Preferências de apresentação: nunca concedem acesso a um módulo.
const PREFIX = "agenda-prado-menu-order-v1:";

export function normalizeMenuOrder(saved: unknown, defaults: readonly string[]): string[] {
  const allowed = new Set(defaults);
  const ordered = Array.isArray(saved)
    ? [...new Set(saved.filter((path): path is string => typeof path === "string" && allowed.has(path)))]
    : [];
  return [...ordered, ...defaults.filter(path => !ordered.includes(path))];
}

export function readMenuOrder(userId: string, defaults: readonly string[]): string[] {
  try {
    return normalizeMenuOrder(JSON.parse(window.localStorage.getItem(PREFIX + userId) ?? "null"), defaults);
  } catch {
    return [...defaults];
  }
}

export function writeMenuOrder(userId: string, order: readonly string[]): boolean {
  try {
    window.localStorage.setItem(PREFIX + userId, JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

// Reordena apenas os módulos visíveis, preservando os demais.
export function moveVisibleMenuItem(order: readonly string[], visible: readonly string[], from: string, to: string): string[] {
  const reordered = [...visible];
  const start = reordered.indexOf(from);
  const end = reordered.indexOf(to);
  if (start < 0 || end < 0 || start === end) return [...order];
  reordered.splice(start, 1);
  reordered.splice(end, 0, from);
  const allowed = new Set(visible);
  let index = 0;
  return order.map(path => allowed.has(path) ? reordered[index++] : path);
}
