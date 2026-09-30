// Resolve Next entry points for route handlers imported outside Next.
const shim = new URL('./next-headers-shim.mjs', import.meta.url).href;
export function resolve(specifier, context, nextResolve) {
  if (specifier === 'next/headers') return { url: shim, shortCircuit: true };
  if (/^next\/(server|cache|navigation)$/.test(specifier)) return nextResolve(`${specifier}.js`, context);
  return nextResolve(specifier, context);
}
