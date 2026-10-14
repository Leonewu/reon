// Everything is static; the worker only folds www into the apex domain.
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    if (url.hostname === "www.reon.day") {
      url.hostname = "reon.day";
      return Response.redirect(url.href, 301);
    }
    return env.ASSETS.fetch(request);
  },
};
