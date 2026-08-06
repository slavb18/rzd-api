export const runtime = "nodejs";

export default {
  fetch(): Response {
    return Response.json({ status: "ok", service: "rzd-api", version: "4.0.0" });
  },
};
