// Records a task event on the local benchmark server. The harness checks success only from these events.
window.report = function report(name, data) {
  return fetch("/__event", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, data: data || {} }),
    keepalive: true,
  }).catch(() => undefined);
};
