// Send every visitor and crawler to one address: https://www.makeachangehomes.ca
// http:// and the bare domain (makeachangehomes.ca) get a single 301 straight there,
// so Google never sees a chain of redirects or two copies of the same page.
// *.pages.dev preview addresses are left alone.
const CANONICAL_HOST = "www.makeachangehomes.ca";
const REDIRECT_HOSTS = new Set(["makeachangehomes.ca", "www.makeachangehomes.ca"]);

function visitorScheme(request, url) {
  // Cloudflare reports the scheme the visitor actually used in cf-visitor.
  try {
    const v = JSON.parse(request.headers.get("cf-visitor") || "{}");
    if (v.scheme === "http" || v.scheme === "https") return v.scheme;
  } catch (e) {}
  const xfp = request.headers.get("x-forwarded-proto");
  if (xfp === "http" || xfp === "https") return xfp;
  return url.protocol.replace(":", "");
}

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (REDIRECT_HOSTS.has(host)) {
    const scheme = visitorScheme(request, url);
    if (host !== CANONICAL_HOST || scheme !== "https") {
      const target = "https://" + CANONICAL_HOST + url.pathname + url.search;
      return new Response(null, { status: 301, headers: { Location: target } });
    }
  }
  return context.next();
}
