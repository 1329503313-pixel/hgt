const LEGACY_PUBLIC_HOSTS = new Set(["47.239.5.69"]);
function hostnameWithoutPort(host) {
    return host.trim().toLowerCase().replace(/:\d+$/, "");
}
export function legacyHostRedirectTarget(nodeEnv, publicSiteUrl, requestHost, originalUrl) {
    if (nodeEnv !== "production" || !requestHost)
        return null;
    if (!LEGACY_PUBLIC_HOSTS.has(hostnameWithoutPort(requestHost)))
        return null;
    try {
        const canonicalOrigin = new URL(publicSiteUrl).origin;
        const requestTarget = originalUrl.startsWith("/") ? originalUrl : `/${originalUrl}`;
        return `${canonicalOrigin}${requestTarget}`;
    }
    catch {
        return null;
    }
}
export function createLegacyHostRedirect(nodeEnv, publicSiteUrl) {
    return (req, res, next) => {
        const target = legacyHostRedirectTarget(nodeEnv, publicSiteUrl, req.get("host"), req.originalUrl);
        if (!target)
            return next();
        return res.redirect(301, target);
    };
}
